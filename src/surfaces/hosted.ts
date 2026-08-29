import { getAddress, isAddress, type Address } from "viem";
import { loadEnv } from "../config/env.js";
import { loadConfig, policyFor } from "../config/policy.js";
import { makePublicClient } from "../signer/broadcast.js";
import { V3Adapter } from "../chain/positions.js";
import { snapshotUsd, usdPricesForPosition } from "../chain/prices.js";
import { adapterFor } from "../core/protocols.js";
import { formatReceipt, planCompound, planExit, planRerange, type PlanContext } from "../core/actions.js";
import { COMPOUND_FEE_BPS, RANGE_EXIT_FEE_BPS } from "../core/fees.js";
import { buildCard, formatCard } from "../core/card.js";
import { formatHoldNote, getHold, holdAmounts } from "../core/hold.js";
import { readHoldBaseline } from "../chain/mint-history.js";
import { runMintFlow } from "../core/mint-flow.js";
import { hydrateCalldata } from "../core/hydrate.js";
import { decideForPosition, runOnce } from "../keeper/loop.js";
import { StdoutSink } from "../keeper/alerts.js";
import type { ActionReceipt, PositionSnapshot } from "../types.js";
import { recenterSameWidth } from "../core/ticks.js";
import {
  confirmFromMint,
  confirmFromPosition,
  serializeLiveView,
  serializeMintView,
  serializeProjectedRange,
} from "../core/view.js";
import {
  getPrivyAccount,
  loadPrivyEnv,
  privyConfigured,
} from "../signer/privy.js";
import { parseChainSlug, viemChainFor, type ChainSlug } from "../chains.js";
import { scoutMarkets as getMarketScout } from "../markets/scout.js";

export type WriteFlags = {
  live?: boolean;
  confirm?: boolean;
};

export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}

export async function scoutMarkets(chain?: ChainSlug | string) {
  return jsonSafe(await getMarketScout(chain ? slugOf(chain) : undefined));
}

export function assertWriteAllowed(flags: WriteFlags): boolean {
  const live = Boolean(flags.live);
  if (live && !flags.confirm) {
    throw new Error("Live writes require confirm=true. Dry-run is the default.");
  }
  return live;
}

function slugOf(chain?: string | ChainSlug): ChainSlug {
  return parseChainSlug(chain ?? "base");
}

export function connectRead(chain: ChainSlug | string = "base") {
  const slug = slugOf(chain);
  const env = loadEnv();
  const client = makePublicClient(env.rpcByChain[slug], viemChainFor(slug));
  return { env, client, adapter: new V3Adapter(client), chain: slug };
}

export async function connectHosted(ownerArg?: string, chain: ChainSlug | string = "base") {
  const { env, client, adapter, chain: slug } = connectRead(chain);
  let owner: Address | undefined;
  if (ownerArg && isAddress(ownerArg)) owner = getAddress(ownerArg);
  if (!owner) {
    throw new Error("Pass the connected user's wallet address.");
  }
  return { env, client, owner, adapter, chain: slug };
}

async function liveViewFor(snap: PositionSnapshot, client: ReturnType<typeof makePublicClient>, ethUsd?: number) {
  const prices = await usdPricesForPosition(client, snap, ethUsd);
  const rec = await readHoldBaseline(client, snap.ref.tokenId, { amount0: snap.amount0, amount1: snap.amount1 });
  const card = buildCard(snap, prices, holdAmounts(rec), rec.createdAt, undefined, {
    source: rec.source,
    note: formatHoldNote(rec),
  });
  return { card, view: serializeLiveView(card) };
}

export async function listPositions(ownerArg?: string, chain: ChainSlug | string = "base") {
  const slug = slugOf(chain);
  const { client, owner, env } = await connectHosted(ownerArg, slug);
  const out: Record<string, unknown>[] = [];
  for (const protocol of ["V2", "V3", "V4"] as const) {
    const adapter = adapterFor(protocol, client);
    let refs: { protocol: string; tokenId: bigint }[] = [];
    try {
      refs = await adapter.listPositions(owner);
    } catch {
      refs = [];
    }
    for (const ref of refs) {
      try {
        const snap = await adapter.readPosition(ref.tokenId);
        const row: Record<string, unknown> = {
          protocol: ref.protocol,
          tokenId: ref.tokenId.toString(),
          pair: `${snap.token0.symbol}/${snap.token1.symbol}`,
          fee: snap.fee,
          inRange: snap.inRange,
          owner,
          chain: slug,
          chainId: snap.ref.chainId,
        };
        try {
          const { view } = await liveViewFor(snap, client, env.ethUsd);
          row.view = view;
          row.positionUsd = view.positionUsd;
          row.feesUsd = view.feesUsd;
          row.feeApr = view.feeApr;
          row.totalApr = view.totalApr;
          row.holdUsd = view.holdUsd;
          row.feeLabel = view.feeLabel;
          row.status = view.status;
          row.closed = view.closed;
          row.fullRange = view.fullRange;
          row.lpUsd = view.lpUsd;
          row.holdDeltaPct = view.holdDeltaPct;
        } catch {
          // Light row still useful if prices / HOLD fail.
        }
        out.push(row);
      } catch (err) {
        out.push({
          protocol: ref.protocol,
          tokenId: ref.tokenId.toString(),
          chain: slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return jsonSafe({ owner, chain: slug, count: out.length, positions: out });
}

export async function statusPosition(tokenId: string, chain: ChainSlug | string = "base") {
  const slug = slugOf(chain);
  const { adapter, client, env } = connectRead(slug);
  const id = BigInt(tokenId);
  const snap = await adapter.readPosition(id);
  const { card, view } = await liveViewFor(snap, client, env.ethUsd);
  return jsonSafe({ card: formatCard(card), view, tokenId, owner: snap.owner, chain: slug, chainId: snap.ref.chainId });
}

async function planContext(
  snap: PositionSnapshot,
  owner: Address,
  live: boolean,
  action: "compound" | "rerange" | "exit",
  flags: { noFee?: boolean; feeSource?: "fees" | "notional"; chain?: ChainSlug | string },
): Promise<PlanContext> {
  const slug = slugOf(flags.chain);
  const env = loadEnv();
  const client = makePublicClient(env.rpcByChain[slug], viemChainFor(slug));
  const px = await usdPricesForPosition(client, snap, env.ethUsd);
  const usd = snapshotUsd(snap, px.price0Usd, px.price1Usd);
  const policy = policyFor(loadConfig(), snap.ref.tokenId);
  return {
    owner,
    dryRun: !live,
    noFee: Boolean(flags.noFee),
    feeSource: flags.feeSource ?? policy.feeSource,
    minFeeUsd: policy.minFeeUsd,
    minPositionUsd: policy.minPositionUsd,
    feesUsd: usd.feesUsd,
    notionalUsd: usd.positionUsd,
    gasUsd: 0.15,
    takeBps: action === "compound" ? COMPOUND_FEE_BPS : RANGE_EXIT_FEE_BPS,
  };
}

async function maybeBroadcast(
  receipt: ActionReceipt,
  snap: PositionSnapshot,
  owner: Address,
  live: boolean,
  chain: ChainSlug = "base",
): Promise<ActionReceipt & { hashes?: string[]; stubbed?: boolean }> {
  if (receipt.skipped || !live) {
    return { ...receipt, dryRun: !live };
  }
  const filled = hydrateCalldata(receipt, snap, owner);
  void chain;
  return {
    ...filled,
    dryRun: true,
    reason: "Prepared for the connected user wallet. Hosted chat never signs consumer transactions.",
    stubbed: true,
  };
}

export async function compoundPosition(input: {
  tokenId: string;
  owner?: string;
  live?: boolean;
  confirm?: boolean;
  noFee?: boolean;
  feeSource?: "fees" | "notional";
  chain?: ChainSlug | string;
}) {
  const live = assertWriteAllowed(input);
  const slug = slugOf(input.chain);
  const { adapter, owner } = await connectHosted(input.owner, slug);
  const snap = await adapter.readPosition(BigInt(input.tokenId));
  const ctx = await planContext(snap, owner, live, "compound", { ...input, chain: slug });
  const receipt = planCompound(snap, ctx);
  const executed = await maybeBroadcast(receipt, snap, owner, live, slug);
  return jsonSafe({
    text: formatReceipt(executed),
    receipt: executed,
    chain: slug,
    confirm: confirmFromPosition("compound", snap, executed, { feesUsd: ctx.feesUsd, gasUsd: ctx.gasUsd }),
  });
}

export async function rangePosition(input: {
  tokenId: string;
  owner?: string;
  live?: boolean;
  confirm?: boolean;
  noFee?: boolean;
  feeSource?: "fees" | "notional";
  oorPercent?: number;
  chain?: ChainSlug | string;
}) {
  const live = assertWriteAllowed(input);
  const slug = slugOf(input.chain);
  const { adapter, owner } = await connectHosted(input.owner, slug);
  const snap = await adapter.readPosition(BigInt(input.tokenId));
  const policy = policyFor(loadConfig(), snap.ref.tokenId);
  const ctx = await planContext(snap, owner, live, "rerange", { ...input, chain: slug });
  const receipt = planRerange(snap, ctx, { oorPercent: input.oorPercent ?? policy.oorPercent });
  const executed = await maybeBroadcast(receipt, snap, owner, live, slug);
  let projection;
  try {
    if (snap.ref.protocol !== "V2") {
      projection = serializeProjectedRange(
        snap,
        recenterSameWidth(snap.tickLower, snap.tickUpper, snap.tickCurrent, snap.tickSpacing),
      );
    }
  } catch {
    projection = undefined;
  }
  return jsonSafe({
    text: formatReceipt(executed),
    receipt: executed,
    projection,
    chain: slug,
    confirm: confirmFromPosition("range", snap, executed, {
      feesUsd: ctx.feesUsd,
      gasUsd: ctx.gasUsd,
      projection,
    }),
  });
}

export async function exitPosition(input: {
  tokenId: string;
  owner?: string;
  live?: boolean;
  confirm?: boolean;
  noFee?: boolean;
  feeSource?: "fees" | "notional";
  exitPrice?: number;
  swapTo?: string;
  chain?: ChainSlug | string;
}) {
  const live = assertWriteAllowed(input);
  const slug = slugOf(input.chain);
  const { adapter, owner } = await connectHosted(input.owner, slug);
  const snap = await adapter.readPosition(BigInt(input.tokenId));
  const policy = policyFor(loadConfig(), snap.ref.tokenId);
  const ctx = await planContext(snap, owner, live, "exit", { ...input, chain: slug });
  const receipt = planExit(snap, ctx, {
    exitPrice: input.exitPrice ?? policy.exitPrice,
    currentPrice: input.exitPrice !== undefined ? (Number(snap.sqrtPriceX96) / 2 ** 96) ** 2 : undefined,
    swapTo:
      input.swapTo && isAddress(input.swapTo)
        ? getAddress(input.swapTo)
        : policy.exitToken && isAddress(policy.exitToken)
          ? getAddress(policy.exitToken)
          : undefined,
  });
  const executed = await maybeBroadcast(receipt, snap, owner, live, slug);
  return jsonSafe({
    text: formatReceipt(executed),
    receipt: executed,
    chain: slug,
    confirm: confirmFromPosition("exit", snap, executed, { feesUsd: ctx.feesUsd, gasUsd: ctx.gasUsd }),
  });
}

export async function mintPosition(input: {
  token0: string;
  token1: string;
  fee: number;
  owner?: string;
  live?: boolean;
  confirm?: boolean;
  widthPct?: number;
  tickLower?: number;
  tickUpper?: number;
  amount0?: string;
  amount1?: string;
  chain?: ChainSlug | string;
}) {
  const live = assertWriteAllowed(input);
  const slug = slugOf(input.chain);
  const { client, owner, env } = await connectHosted(input.owner, slug);
  const result = await runMintFlow({
    client,
    owner,
    token0: input.token0,
    token1: input.token1,
    fee: input.fee,
    widthPct: input.widthPct,
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    amount0: input.amount0 ? BigInt(input.amount0) : undefined,
    amount1: input.amount1 ? BigInt(input.amount1) : undefined,
    dryRun: true,
    apiKey: env.uniswapApiKey,
  });
  if (!live) {
    const view = serializeMintView(result.quote);
    return jsonSafe({
      card: result.card,
      text: formatReceipt(result.receipt),
      receipt: result.receipt,
      view,
      projection: view,
      chain: slug,
      confirm: confirmFromMint(result.quote, result.receipt),
      usedLpApi: result.usedLpApi,
      simulation: result.simulation,
      note: "dry-run: no broadcast. Set live=true and confirm=true to mint. NFT stays in your wallet.",
    });
  }
  const view = serializeMintView(result.quote);
  return jsonSafe({
    card: result.card,
    text: formatReceipt(result.receipt),
    receipt: result.receipt,
    view,
    projection: view,
    chain: slug,
    confirm: confirmFromMint(result.quote, result.receipt),
    stubbed: true,
    note: "Prepared for the connected user wallet. Hosted chat never signs consumer transactions.",
  });
}

export function keeperLiveEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  return source.KEEPER_LIVE === "1" || source.UNABOT_KEEPER_LIVE === "1";
}

export async function runKeeperScan(input: { owner?: string; live?: boolean; chain?: ChainSlug | string } = {}) {
  const live = Boolean(input.live) && keeperLiveEnabled();
  const slug = slugOf(input.chain);
  const { adapter, owner, client, env } = await connectHosted(input.owner, slug);
  const sink = new StdoutSink();
  const receipts = await runOnce({
    list: async (who: Address) => {
      const refs = await adapter.listPositions(who);
      return Promise.all(refs.map((r) => adapter.readPosition(r.tokenId)));
    },
    owner,
    live,
    intervalMs: 0,
    sink,
    execute: live
      ? async (receipt, snap) => {
          if (receipt.tokenId === undefined) return receipt;
          return maybeBroadcast(receipt, snap, owner, true, slug);
        }
      : undefined,
    prices: async (p: PositionSnapshot) => {
      const px = await usdPricesForPosition(client, p, env.ethUsd);
      const usd = snapshotUsd(p, px.price0Usd, px.price1Usd);
      return {
        feesUsd: usd.feesUsd,
        notionalUsd: usd.positionUsd,
        gasUsd: 0.15,
        price: Number(p.sqrtPriceX96) > 0 ? (Number(p.sqrtPriceX96) / 2 ** 96) ** 2 : 0,
      };
    },
  });
  return jsonSafe({
    owner,
    chain: slug,
    live,
    dryRun: !live,
    privy: privyConfigured() ? "ready" : "stubbed",
    decisions: receipts.map((r) => ({
      action: r.action,
      tokenId: r.tokenId !== undefined ? String(r.tokenId) : undefined,
      skipped: r.skipped,
      reason: r.reason,
      dryRun: r.dryRun,
      text: formatReceipt(r),
    })),
  });
}

export { decideForPosition, formatReceipt, getPrivyAccount, loadPrivyEnv };
