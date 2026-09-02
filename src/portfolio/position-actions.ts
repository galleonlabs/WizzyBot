import { getAddress, isAddress, type Address } from "viem";
import { addressesFor, chainOf, type ChainSlug } from "../chains.js";
import { adapterFor } from "../core/protocols.js";
import { AerodromeSlipstreamAdapter } from "../aerodrome/positions.js";
import { AERODROME_DEPLOYMENTS, type AerodromeDeployment } from "../aerodrome/deployments.js";
import { collectSlipstreamTx } from "../aerodrome/calldata.js";
import { loadEnv } from "../config/env.js";
import type { CuratedMarket } from "../markets/catalog.js";
import { makePublicClient } from "../signer/broadcast.js";
import type { PlannedTx, PositionSnapshot, Protocol } from "../types.js";
import { collectCalldata, decreaseCalldata } from "../uniswap/calldata.js";
import { v4BurnTx, v4ClaimFeesTx, v4DecreaseTx } from "../uniswap/v4-calldata.js";
import { WALLET_PLAN_DEADLINE_SEC } from "../constants.js";

/**
 * Wizzy only prepares actions that settle in ONE wallet transaction: collect
 * fees, remove part of a position, or close it and receive both tokens.
 * Anything that needs a swap or several signatures is handed to the venue's
 * own interface, after an optional Relay step.
 */

const PLAN_TTL_MS = 8 * 60_000;
const SLIPPAGE_BPS = 150;

export type PositionActionKind = "collect" | "decrease" | "withdraw";

export type SerializableTx = {
  to: Address;
  data: `0x${string}`;
  value: string;
  description: string;
};

export type PositionActionPlan = {
  kind: PositionActionKind;
  owner: Address;
  chain: ChainSlug;
  chainId: number;
  tokenId: string;
  pair: string;
  execution: "wallet_transactions";
  atomic: true;
  expectedConfirmations: 1;
  serviceFeeBps: 0;
  removal?: { percent: number; amount0: string; amount1: string; burn: boolean };
  tokens: { symbol0: string; decimals0: number; address0: Address; symbol1: string; decimals1: number; address1: Address };
  transactions: SerializableTx[];
  allowedTargets: Address[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export type PositionActionInput = {
  owner: string;
  chain: ChainSlug;
  tokenId: bigint;
  action: PositionActionKind;
  percent?: number;
  protocol?: Protocol;
  venue?: "uniswap-v3" | "aerodrome-slipstream";
  positionManager?: string;
};

export async function planPositionAction(input: PositionActionInput): Promise<PositionActionPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const chain = chainOf(input.chain);
  const env = loadEnv();
  const client = makePublicClient(env.rpcByChain[input.chain], chain.viem);
  let snapshot: PositionSnapshot;
  if (input.venue === "aerodrome-slipstream") {
    if (input.chain !== "base" || !input.positionManager || !isAddress(input.positionManager)) {
      throw new Error("Aerodrome position manager is missing or invalid");
    }
    const deployment = aerodromeDeploymentFor(input.positionManager);
    if (!deployment) throw new Error("This Aerodrome position manager is not supported");
    snapshot = await new AerodromeSlipstreamAdapter(client, deployment.id).readPosition(input.tokenId);
  } else {
    const adapter = adapterFor(input.protocol ?? "V3", client);
    adapter.bindOwner?.(owner);
    snapshot = await adapter.readPosition(input.tokenId);
  }
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");
  if (input.action === "decrease") return buildDecreasePositionActionPlan(snapshot, owner, input.chain, input.percent ?? 0);
  return buildPositionActionPlan(snapshot, owner, input.chain, input.action);
}

export function aerodromeDeploymentFor(positionManager: string): AerodromeDeployment | undefined {
  return Object.values(AERODROME_DEPLOYMENTS)
    .find((candidate) => candidate.positionManager.toLowerCase() === positionManager.toLowerCase());
}

/** Which single-transaction actions a position supports; the rest belong to the venue's interface. */
export function atomicActionsFor(snapshot: Pick<PositionSnapshot, "ref" | "venue" | "liquidity" | "uncollected0" | "uncollected1">): PositionActionKind[] {
  const actions: PositionActionKind[] = [];
  if (snapshot.ref.protocol === "V2") return actions;
  if (snapshot.uncollected0 > 0n || snapshot.uncollected1 > 0n) actions.push("collect");
  if (snapshot.liquidity <= 0n || snapshot.venue === "aerodrome-slipstream") return actions;
  actions.push("decrease", "withdraw");
  return actions;
}

export function positionPoolIsConfigured(
  snapshot: PositionSnapshot,
  markets: readonly CuratedMarket[],
): boolean {
  return markets.some((market) => {
    const tokens = new Set([snapshot.token0.address.toLowerCase(), snapshot.token1.address.toLowerCase()]);
    const pairMatches = tokens.has(market.token.toLowerCase()) && tokens.has(market.quoteToken.toLowerCase());
    if (snapshot.ref.protocol === "V2" || snapshot.ref.protocol === "V4") return pairMatches;
    return market.pool.toLowerCase() === snapshot.pool.toLowerCase()
      && (snapshot.venue === "aerodrome-slipstream") === (market.protocol === "AERODROME_SLIPSTREAM");
  });
}

export function buildPositionActionPlan(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  action: "collect" | "withdraw",
): PositionActionPlan {
  if (snapshot.ref.chainId !== chainOf(chain).id) throw new Error("position chain mismatch");
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");
  if (snapshot.ref.protocol === "V2") throw new Error("Uniswap V2 positions are managed on Uniswap");
  const manager = managerFor(snapshot, chain);
  let transaction: PlannedTx;
  if (action === "collect") {
    if (snapshot.uncollected0 <= 0n && snapshot.uncollected1 <= 0n) throw new Error("No fees are ready to collect");
    transaction = snapshot.ref.protocol === "V4"
      ? v4ClaimFeesTx(snapshot, owner)
      : snapshot.venue === "aerodrome-slipstream"
        ? collectSlipstreamTx(manager, snapshot.ref.tokenId, owner)
        : collectCalldata(snapshot, owner);
  } else {
    if (snapshot.liquidity <= 0n) throw new Error("This position is already closed");
    if (snapshot.venue === "aerodrome-slipstream") throw new Error("Aerodrome exits take three steps; finish on aerodrome.finance");
    transaction = snapshot.ref.protocol === "V4"
      ? v4BurnTx(snapshot, owner, SLIPPAGE_BPS)
      : decreaseCalldata(snapshot, 100, owner, SLIPPAGE_BPS, WALLET_PLAN_DEADLINE_SEC, true);
  }
  return finishPlan(snapshot, owner, chain, action, transaction, manager, action === "withdraw"
    ? { percent: 100, amount0: snapshot.amount0.toString(), amount1: snapshot.amount1.toString(), burn: true }
    : undefined, action === "collect"
    ? [
        "All claimable fees return to your wallet in one transaction. Wizzy charges nothing.",
        "Your liquidity and price range stay unchanged.",
      ]
    : [
        "The whole position is removed and the empty NFT burned in one transaction. You receive both pool tokens.",
        "Turning the tokens back into ETH is a separate Relay step so no hidden swap is taken.",
      ]);
}

/** Remove part of a position in one transaction. Fees owed come out with it. */
export function buildDecreasePositionActionPlan(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  percent: number,
): PositionActionPlan {
  if (snapshot.ref.chainId !== chainOf(chain).id) throw new Error("position chain mismatch");
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) throw new Error("Choose between 1% and 99% to remove, or exit the position instead");
  if (snapshot.liquidity <= 0n) throw new Error("This position is already closed");
  if (snapshot.ref.protocol === "V2") throw new Error("Uniswap V2 positions are managed on Uniswap");
  if (snapshot.venue === "aerodrome-slipstream") throw new Error("Aerodrome removals take two steps; finish on aerodrome.finance");
  const share = BigInt(percent);
  const liquidity = (snapshot.liquidity * share) / 100n;
  if (liquidity <= 0n) throw new Error("This share is too small to remove");
  const amount0 = (snapshot.amount0 * share) / 100n;
  const amount1 = (snapshot.amount1 * share) / 100n;
  const manager = managerFor(snapshot, chain);
  const transaction = snapshot.ref.protocol === "V4"
    ? v4DecreaseTx({ ...snapshot, amount0, amount1 }, liquidity, owner, SLIPPAGE_BPS)
    : decreaseCalldata(snapshot, percent, owner, SLIPPAGE_BPS, WALLET_PLAN_DEADLINE_SEC, false);
  return finishPlan(snapshot, owner, chain, "decrease", transaction, manager, { percent, amount0: amount0.toString(), amount1: amount1.toString(), burn: false }, [
    `${percent}% of the liquidity returns to your wallet as both pool tokens, together with any fees owed, in one transaction.`,
    "The range and the remaining liquidity stay exactly as they are. Wizzy charges nothing.",
  ]);
}

function finishPlan(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  kind: PositionActionKind,
  transaction: PlannedTx,
  manager: Address,
  removal: PositionActionPlan["removal"],
  notices: string[],
): PositionActionPlan {
  if (transaction.to.toLowerCase() !== manager.toLowerCase()) throw new Error(`Refuse unapproved transaction target ${transaction.to}`);
  if (transaction.data === "0x" && transaction.value === 0n) throw new Error(`Refuse empty transaction to ${transaction.to}`);
  const now = new Date();
  return {
    kind,
    owner,
    chain,
    chainId: snapshot.ref.chainId,
    tokenId: snapshot.ref.tokenId.toString(),
    pair: `${snapshot.token0.symbol}/${snapshot.token1.symbol}`,
    execution: "wallet_transactions",
    atomic: true,
    expectedConfirmations: 1,
    serviceFeeBps: 0,
    ...(removal ? { removal } : {}),
    tokens: {
      symbol0: snapshot.token0.symbol,
      decimals0: snapshot.token0.decimals,
      address0: getAddress(snapshot.token0.address),
      symbol1: snapshot.token1.symbol,
      decimals1: snapshot.token1.decimals,
      address1: getAddress(snapshot.token1.address),
    },
    transactions: [{ ...transaction, value: transaction.value.toString() }],
    allowedTargets: [getAddress(manager)],
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    notices,
  };
}

function managerFor(snapshot: PositionSnapshot, chain: ChainSlug): Address {
  if (snapshot.venue === "aerodrome-slipstream") {
    if (!snapshot.positionManager) throw new Error("Aerodrome position manager is missing");
    return snapshot.positionManager;
  }
  if (snapshot.ref.protocol === "V4") return addressesFor(chain).v4PositionManager;
  return addressesFor(chain).nfpm;
}
