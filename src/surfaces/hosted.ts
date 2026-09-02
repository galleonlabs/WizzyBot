import { getAddress, isAddress, type Address } from "viem";
import { loadEnv } from "../config/env.js";
import { loadConfig, policyFor } from "../config/policy.js";
import { makePublicClient } from "../signer/broadcast.js";
import { AerodromeSlipstreamAdapter } from "../aerodrome/positions.js";
import { AERODROME_DEPLOYMENTS } from "../aerodrome/deployments.js";
import { snapshotUsd, tokenUsd, usdPricesForPosition } from "../chain/prices.js";
import { adapterFor } from "../core/protocols.js";
import { formatReceipt, planCompound, planExit, planRerange, type PlanContext } from "../core/actions.js";
import { buildCard, formatCard } from "../core/card.js";
import { formatHoldNote, getHold, holdAmounts, type HoldRecord } from "../core/hold.js";
import { readHoldBaseline } from "../chain/mint-history.js";
import { runMintFlow } from "../core/mint-flow.js";
import { hydrateCalldata } from "../core/hydrate.js";
import { decideForPosition, runOnce } from "../keeper/loop.js";
import { StdoutSink } from "../keeper/alerts.js";
import type { ActionReceipt, PositionSnapshot, Protocol, ProtocolAdapter } from "../types.js";
import { recenterSameWidth } from "../core/ticks.js";
import {
  confirmFromMint,
  confirmFromPosition,
  serializeLiveView,
  serializeMintView,
  serializeProjectedRange,
} from "../core/view.js";
import { addressesFor, parseChainSlug, viemChainFor, type ChainSlug } from "../chains.js";
import { scoutMarkets as getMarketScout } from "../markets/scout.js";
import { readLiquidityProfile } from "../portfolio/liquidity-profile.js";
import { chainCatalog } from "../markets/catalog.js";
import { positionPoolIsConfigured } from "../portfolio/position-actions.js";

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
    throw new Error("Transaction-plan preparation requires confirm=true. The connected EOA must still approve it in the wallet.");
  }
  return live;
}

function slugOf(chain?: string | ChainSlug): ChainSlug {
  return parseChainSlug(chain ?? "base");
}

type PositionSelector = {
  protocol?: Protocol;
  positionManager?: string;
};

function positionAdapter(
  client: ReturnType<typeof makePublicClient>,
  chain: ChainSlug,
  selector: PositionSelector = {},
): ProtocolAdapter {
  const protocol = selector.protocol ?? "V3";
  if (protocol !== "V3" || !selector.positionManager) return adapterFor(protocol, client);
  if (!isAddress(selector.positionManager)) throw new Error("positionManager must be a valid address");
  const manager = getAddress(selector.positionManager);
  if (chain === "base") {
    const deployment = Object.values(AERODROME_DEPLOYMENTS)
      .find((candidate) => candidate.positionManager.toLowerCase() === manager.toLowerCase());
    if (deployment) return new AerodromeSlipstreamAdapter(client, deployment.id);
  }
  const expectedManager = addressesFor(chain).nfpm;
  if (manager.toLowerCase() !== expectedManager.toLowerCase()) {
    throw new Error("position manager is not supported on this chain");
  }
  return adapterFor("V3", client);
}

export function connectRead(chain: ChainSlug | string = "base", selector: PositionSelector = {}) {
  const slug = slugOf(chain);
  const env = loadEnv();
  const client = makePublicClient(env.rpcByChain[slug], viemChainFor(slug));
  const historyClient = makePublicClient(env.rpcByChain[slug], viemChainFor(slug), { retryCount: 0, timeoutMs: 3_500 });
  return { env, client, historyClient, adapter: positionAdapter(client, slug, selector), chain: slug };
}

export async function connectHosted(ownerArg?: string, chain: ChainSlug | string = "base", selector: PositionSelector = {}) {
  const { env, client, adapter, chain: slug } = connectRead(chain, selector);
  let owner: Address | undefined;
  if (ownerArg && isAddress(ownerArg)) owner = getAddress(ownerArg);
  if (!owner) {
    throw new Error("Pass the connected user's wallet address.");
  }
  return { env, client, owner, adapter, chain: slug };
}

function firstSeenBaseline(snap: PositionSnapshot): HoldRecord {
  return {
    tokenId: snap.ref.tokenId.toString(),
    hold0: snap.amount0.toString(),
    hold1: snap.amount1.toString(),
    createdAt: 0,
    source: "first-seen-import",
    note: "Historical mint data was unavailable. HOLD comparisons use current first-seen inventory and are not historical PnL.",
  };
}

async function within<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([promise.catch(() => fallback), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function liveViewFor(
  snap: PositionSnapshot,
  client: ReturnType<typeof makePublicClient>,
  ethUsd?: number,
  options: { historyClient?: ReturnType<typeof makePublicClient>; readHistory?: boolean; timeoutMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 4_000;
  const baseline = firstSeenBaseline(snap);
  const pricesPromise = within(usdPricesForPosition(client, snap, ethUsd), timeoutMs, { price0Usd: 0, price1Usd: 0 });
  const profilePromise = within(readLiquidityProfile(client, snap), timeoutMs, undefined);
  const holdPromise = options.readHistory
    ? within(readHoldBaseline(options.historyClient ?? client, snap.ref.tokenId, { amount0: snap.amount0, amount1: snap.amount1 }, {
        positionManager: snap.positionManager,
      }), timeoutMs, baseline)
    : Promise.resolve(baseline);
  const [prices, rec, liquidityProfile] = await Promise.all([pricesPromise, holdPromise, profilePromise]);
  const card = buildCard(snap, prices, holdAmounts(rec), rec.createdAt, undefined, {
    source: rec.source,
    note: formatHoldNote(rec),
  });
  return { card, view: serializeLiveView(card), liquidityProfile };
}

export async function listPositions(ownerArg?: string, chain: ChainSlug | string = "base") {
  const slug = slugOf(chain);
  const { client, owner, env } = await connectHosted(ownerArg, slug);
  const adapters: Array<{ adapter: ReturnType<typeof adapterFor> | AerodromeSlipstreamAdapter; venue?: "aerodrome-slipstream" }> = [
    ...(["V2", "V3", "V4"] as const).map((protocol) => ({ adapter: adapterFor(protocol, client) })),
  ];
  if (slug === "base") {
    for (const deployment of Object.keys(AERODROME_DEPLOYMENTS) as Array<keyof typeof AERODROME_DEPLOYMENTS>) {
      adapters.push({ adapter: new AerodromeSlipstreamAdapter(client, deployment), venue: "aerodrome-slipstream" });
    }
  }
  const ethUsdPromise = within(tokenUsd(client, addressesFor(slug).weth, 18, env.ethUsd), 3_500, env.ethUsd ?? 0);
  const discovered = await Promise.all(adapters.map(async (descriptor) => ({
    descriptor,
    refs: await descriptor.adapter.listPositions(owner).catch(() => []),
  })));
  const catalogMarkets = chainCatalog(slug).markets;
  const out = await Promise.all(discovered.flatMap(({ descriptor, refs }) => refs.map(async (ref): Promise<Record<string, unknown>> => {
    const { adapter } = descriptor;
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
          venue: snap.venue ?? snap.ref.venue,
          venueLabel: (snap.venue ?? snap.ref.venue) === "aerodrome-slipstream" ? "Aerodrome" : undefined,
          positionManager: snap.positionManager ?? snap.ref.positionManager,
          marketId: catalogMarkets.find((market) => positionPoolIsConfigured(snap, [market]))?.id,
        };
        try {
          const { view, liquidityProfile } = await liveViewFor(snap, client, env.ethUsd, { readHistory: false, timeoutMs: 3_500 });
          row.view = view;
          row.positionUsd = view.positionUsd;
          row.feesUsd = view.feesUsd;
          row.feeApr = view.feeApr;
          row.totalApr = view.totalApr;
          row.holdUsd = view.holdUsd;
          row.feeLabel = view.feeLabel;
          row.status = view.status;
          row.liquidityProfile = liquidityProfile;
          row.closed = view.closed;
          row.fullRange = view.fullRange;
          row.lpUsd = view.lpUsd;
          row.holdDeltaPct = view.holdDeltaPct;
        } catch {
          // Light row still useful if prices / HOLD fail.
        }
        return row;
      } catch (err) {
        return {
          protocol: ref.protocol,
          tokenId: ref.tokenId.toString(),
          chain: slug,
          error: err instanceof Error ? err.message : String(err),
        };
      }
  })));
  const ethUsd = await ethUsdPromise;
  return jsonSafe({ owner, chain: slug, count: out.length, positions: out, ethUsd: ethUsd > 0 ? ethUsd : undefined });
}

export async function statusPosition(
  tokenId: string,
  chain: ChainSlug | string = "base",
  protocol: Protocol = "V3",
  positionManager?: string,
) {
  const slug = slugOf(chain);
  const { adapter, client, historyClient, env } = connectRead(slug, { protocol, positionManager });
  const id = BigInt(tokenId);
  const snap = await adapter.readPosition(id);
  const { card, view, liquidityProfile } = await liveViewFor(snap, client, env.ethUsd, { historyClient, readHistory: true });
  return jsonSafe({
    card: formatCard(card),
    view,
    tokenId,
    owner: snap.owner,
    chain: slug,
    chainId: snap.ref.chainId,
    protocol: snap.ref.protocol,
    venue: snap.venue ?? snap.ref.venue,
    positionManager: snap.positionManager ?? snap.ref.positionManager,
    liquidityProfile,
  });
}

async function planContext(
  snap: PositionSnapshot,
  owner: Address,
  live: boolean,
  flags: { chain?: ChainSlug | string },
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
    noFee: true,
    feeSource: "fees",
    minFeeUsd: policy.minFeeUsd,
    minPositionUsd: policy.minPositionUsd,
    feesUsd: usd.feesUsd,
    notionalUsd: usd.positionUsd,
    gasUsd: 0.15,
    takeBps: 0,
  };
}

async function maybeBroadcast(
  receipt: ActionReceipt,
  snap: PositionSnapshot,
  owner: Address,
  live: boolean,
  chain: ChainSlug = "base",
): Promise<ActionReceipt & { hashes?: string[]; requiresWalletApproval?: boolean }> {
  if (receipt.skipped || !live) {
    return { ...receipt, dryRun: !live };
  }
  const filled = hydrateCalldata(receipt, snap, owner);
  void chain;
  return {
    ...filled,
    dryRun: true,
    reason: "Prepared for the connected EOA. Hosted services never sign consumer transactions.",
    requiresWalletApproval: true,
  };
}

export async function compoundPosition(input: {
  tokenId: string;
  owner?: string;
  live?: boolean;
  confirm?: boolean;
  chain?: ChainSlug | string;
  protocol?: Protocol;
}) {
  const live = assertWriteAllowed(input);
  const slug = slugOf(input.chain);
  const { adapter, owner } = await connectHosted(input.owner, slug, { protocol: input.protocol });
  const snap = await adapter.readPosition(BigInt(input.tokenId));
  const ctx = await planContext(snap, owner, live, { chain: slug });
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
  oorPercent?: number;
  chain?: ChainSlug | string;
  protocol?: Protocol;
}) {
  const live = assertWriteAllowed(input);
  const slug = slugOf(input.chain);
  const { adapter, owner } = await connectHosted(input.owner, slug, { protocol: input.protocol });
  const snap = await adapter.readPosition(BigInt(input.tokenId));
  const policy = policyFor(loadConfig(), snap.ref.tokenId);
  const ctx = await planContext(snap, owner, live, { chain: slug });
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
  exitPrice?: number;
  swapTo?: string;
  chain?: ChainSlug | string;
  protocol?: Protocol;
}) {
  const live = assertWriteAllowed(input);
  const slug = slugOf(input.chain);
  const { adapter, owner } = await connectHosted(input.owner, slug, { protocol: input.protocol });
  const snap = await adapter.readPosition(BigInt(input.tokenId));
  const policy = policyFor(loadConfig(), snap.ref.tokenId);
  const ctx = await planContext(snap, owner, live, { chain: slug });
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
  protocol?: Protocol;
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
    protocol: input.protocol,
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
      note: "Dry-run only. Request a wallet plan to mint; the NFT stays in your EOA.",
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
    requiresWalletApproval: true,
    note: "Prepared for the connected EOA. Hosted services never sign consumer transactions.",
  });
}

export async function runKeeperScan(input: { owner?: string; live?: boolean; chain?: ChainSlug | string } = {}) {
  if (input.live) {
    throw new Error("Hosted keeper execution is disabled. A connected EOA must review and approve every transaction plan.");
  }
  const live = false;
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
    live: false,
    dryRun: true,
    execution: "observe-only",
    wallet: "external-eoa",
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

export { decideForPosition, formatReceipt };
