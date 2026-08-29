import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { ADDRESSES } from "../src/constants.js";
import { DEFAULT_POLICY } from "../src/config/policy.js";
import { classifySkip, SKIP_REASONS } from "../src/keeper/skip.js";
import { safeExecute } from "../src/keeper/execute.js";
import { decideForPosition, runOnce } from "../src/keeper/loop.js";
import {
  createAlertSink,
  formatLog,
  redactSecrets,
  StdoutSink,
  WebhookSink,
  alert,
} from "../src/keeper/alerts.js";
import type { ActionReceipt, AlertEvent, PlannedTx, PositionSnapshot, UnaBotConfig } from "../src/types.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");

function snap(over: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    ref: { protocol: "V3", chainId: 8453, tokenId: 42n },
    owner,
    token0: { address: ADDRESSES.weth, symbol: "WETH", decimals: 18 },
    token1: { address: ADDRESSES.usdc, symbol: "USDC", decimals: 6 },
    fee: 500,
    tickSpacing: 10,
    tickLower: -200,
    tickUpper: 200,
    tickCurrent: 0,
    sqrtPriceX96: 2n ** 96n,
    liquidity: 1_000_000n,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    uncollected0: 1_000_000_000_000_000n,
    uncollected1: 5_000_000n,
    amount0: 1_000_000_000_000_000_000n,
    amount1: 3_000_000_000n,
    inRange: true,
    percentThroughRange: 50,
    pool: getAddress("0x2222222222222222222222222222222222222222"),
    ...over,
  };
}

function cfg(over: Partial<UnaBotConfig["defaults"]> = {}, position: Record<string, unknown> = {}): UnaBotConfig {
  return {
    defaults: { ...DEFAULT_POLICY, compound: true, autoRange: false, autoExit: false, cooldownSec: 0, ...over },
    positions: Object.keys(position).length ? { "42": { tokenId: "42", ...position } } : {},
  };
}

function sink() {
  const lines: string[] = [];
  return {
    lines,
    sink: new StdoutSink((line) => lines.push(line)),
  };
}

const goodPrices = async () => ({
  feesUsd: 25,
  notionalUsd: 4000,
  gasUsd: 0.2,
  price: 1,
});

describe("keeper skip reasons", () => {
  it("covers the production skip codes", () => {
    expect(SKIP_REASONS).toEqual(
      expect.arrayContaining(["uneconomic", "cooldown", "missing_key", "placeholder_calldata"]),
    );
    expect(classifySkip("uneconomic: net $0.10 after gas")).toBe("uneconomic");
    expect(classifySkip("cooldown: 3600s")).toBe("cooldown");
    expect(classifySkip("missing_key: signer required for --live")).toBe("missing_key");
    expect(classifySkip("placeholder_calldata: refusing empty calldata")).toBe("placeholder_calldata");
  });

  it("skips cooldown", async () => {
    const { sink: alerts, lines } = sink();
    const out = await decideForPosition(snap(), {
      owner,
      live: false,
      sink: alerts,
      config: cfg({ cooldownSec: 3600 }, { lastRunAt: Date.now() / 1000 }),
      prices: goodPrices,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.skipped).toBe(true);
    expect(out[0]?.skipReason).toBe("cooldown");
    expect(out[0]?.reason).toMatch(/cooldown/);
    const log = JSON.parse(lines[0] ?? "{}");
    expect(log.kind).toBe("skip");
    expect(log.skipReason).toBe("cooldown");
  });

  it("skips uneconomic compounds", async () => {
    const { sink: alerts } = sink();
    const out = await decideForPosition(snap(), {
      owner,
      live: false,
      sink: alerts,
      config: cfg({ minFeeUsd: 10 }),
      prices: async () => ({ feesUsd: 2, notionalUsd: 4000, gasUsd: 1.5, price: 1 }),
    });
    expect(out[0]?.skipped).toBe(true);
    expect(out[0]?.skipReason).toBe("uneconomic");
    expect(out[0]?.reason).toMatch(/uneconomic|no uncollected|size floor/);
  });

  it("skips missing key on live", async () => {
    const { sink: alerts } = sink();
    const out = await decideForPosition(snap(), {
      owner,
      live: true,
      hasSigner: false,
      sink: alerts,
      config: cfg(),
      prices: goodPrices,
    });
    expect(out[0]?.skipped).toBe(true);
    expect(out[0]?.skipReason).toBe("missing_key");
    expect(out[0]?.reason).toMatch(/missing_key/);
  });

  it("skips placeholder calldata and never sends it", async () => {
    const sent: PlannedTx[] = [];
    const receipt: ActionReceipt = {
      action: "compound",
      dryRun: false,
      skipped: false,
      tokenId: 42n,
      from: owner,
      to: [ADDRESSES.nfpm],
      actions: [],
      treasuryFee: null,
      txs: [
        { to: ADDRESSES.nfpm, data: "0x", value: 0n, description: "NFPM.collect" },
        { to: ADDRESSES.universalRouter, data: "0x0", value: 0n, description: "optional swap" },
      ],
    };
    const executed = await safeExecute(receipt, snap(), {
      live: true,
      hasSigner: true,
      hydrate: (r) => r,
      send: async (tx) => {
        sent.push(tx);
        return { hash: "0xabc" };
      },
    });
    expect(executed.skipped).toBe(true);
    expect(executed.skipReason).toBe("placeholder_calldata");
    expect(executed.reason).toMatch(/placeholder_calldata|empty calldata/);
    expect(sent).toHaveLength(0);
  });

  it("sends only filled txs when some calldata is empty", async () => {
    const sent: PlannedTx[] = [];
    const receipt: ActionReceipt = {
      action: "compound",
      dryRun: false,
      skipped: false,
      tokenId: 42n,
      from: owner,
      to: [ADDRESSES.nfpm],
      actions: [],
      treasuryFee: null,
      txs: [
        { to: ADDRESSES.nfpm, data: "0x1234", value: 0n, description: "NFPM.collect" },
        { to: ADDRESSES.universalRouter, data: "0x", value: 0n, description: "optional swap" },
      ],
    };
    const executed = await safeExecute(receipt, snap(), {
      live: true,
      hasSigner: true,
      hydrate: (r) => r,
      send: async (tx) => {
        sent.push(tx);
        return { hash: "0xabc" };
      },
    });
    expect(executed.skipped).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.data).toBe("0x1234");
  });

  it("skips spend cap", async () => {
    const { sink: alerts } = sink();
    const out = await decideForPosition(snap(), {
      owner,
      live: false,
      sink: alerts,
      config: cfg({ spendCapUsd: 100 }),
      prices: async () => ({ feesUsd: 25, notionalUsd: 4000, gasUsd: 0.2, price: 1 }),
    });
    expect(out[0]?.skipReason).toBe("spend_cap");
  });

  it("skips max price impact", async () => {
    const { sink: alerts } = sink();
    const out = await decideForPosition(snap(), {
      owner,
      live: false,
      sink: alerts,
      config: cfg({ maxPriceImpactBps: 50 }),
      prices: async () => ({ feesUsd: 25, notionalUsd: 4000, gasUsd: 0.2, price: 1, priceImpactBps: 200 }),
    });
    expect(out[0]?.skipReason).toBe("price_impact");
  });
});

describe("keeper log shape", () => {
  it("emits structured JSON with required fields and no secrets", () => {
    const lines: string[] = [];
    const alerts = new StdoutSink((line) => lines.push(line));
    const key = `0x${"ab".repeat(32)}`;
    alert(alerts, "info", "skip", `cooldown: 3600s key=${key}`, "42", {
      action: "compound",
      skipped: true,
      skipReason: "cooldown",
      dryRun: true,
    });
    expect(lines).toHaveLength(1);
    const log = JSON.parse(lines[0] ?? "");
    expect(log).toMatchObject({
      level: "info",
      kind: "skip",
      skipReason: "cooldown",
      tokenId: "42",
      skipped: true,
      dryRun: true,
      action: "compound",
    });
    expect(log.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(log.message).toMatch(/cooldown/);
    expect(JSON.stringify(log)).not.toContain("abab");
    expect(JSON.stringify(log)).not.toContain(key);
    expect(log.message).toContain("<redacted>");
  });

  it("redacts secret field names", () => {
    const redacted = redactSecrets({
      UNABOT_PRIVATE_KEY: "0x" + "11".repeat(32),
      UNISWAP_API_KEY: "secret-api",
      note: "ok",
    }) as Record<string, string>;
    expect(redacted.UNABOT_PRIVATE_KEY).toBe("<redacted>");
    expect(redacted.UNISWAP_API_KEY).toBe("<redacted>");
    expect(redacted.note).toBe("ok");
  });

  it("formatLog always includes ts, level, kind, message", () => {
    const event: AlertEvent = {
      level: "warn",
      kind: "execute",
      message: "compound",
      at: "2026-08-29T11:00:00.000Z",
      dryRun: true,
    };
    const log = formatLog(event);
    expect(Object.keys(log)).toEqual(expect.arrayContaining(["ts", "level", "kind", "message"]));
    expect(log.ts).toBe(event.at);
  });

  it("stdout + optional webhook AlertSink", async () => {
    const lines: string[] = [];
    const posts: string[] = [];
    const sink = createAlertSink({
      webhookUrl: "https://example.com/hook",
      write: (line) => lines.push(line),
      fetch: (async (_url, init) => {
        posts.push(String(init && typeof init === "object" && "body" in init ? init.body : ""));
        return new Response("ok");
      }) as typeof fetch,
    });
    alert(sink, "info", "skip", "uneconomic: net $0.10", "7", { skipReason: "uneconomic", skipped: true, dryRun: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(lines[0] ?? "{}").skipReason).toBe("uneconomic");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0] ?? "{}").kind).toBe("skip");
    expect(posts[0]).not.toMatch(/0x[0-9a-fA-F]{64}/);
  });

  it("webhook sink posts the same JSON shape", async () => {
    const posts: { url: string; body: string }[] = [];
    const hook = new WebhookSink("https://example.com/alerts", (async (url, init) => {
      posts.push({ url: String(url), body: String(init && typeof init === "object" && "body" in init ? init.body : "") });
      return new Response("ok");
    }) as typeof fetch);
    const event: AlertEvent = {
      level: "info",
      kind: "skip",
      message: "missing_key: signer required for --live",
      at: "2026-08-29T11:00:00.000Z",
      skipReason: "missing_key",
      skipped: true,
      tokenId: "42",
    };
    await hook.emit(event);
    expect(posts[0]?.url).toBe("https://example.com/alerts");
    const body = JSON.parse(posts[0]?.body ?? "{}");
    expect(body).toMatchObject({
      ts: event.at,
      level: "info",
      kind: "skip",
      skipReason: "missing_key",
      tokenId: "42",
    });
  });
});

describe("keeper runOnce dry-run default", () => {
  it("does not execute when dry-run", async () => {
    let executed = 0;
    const { sink: alerts } = sink();
    const receipts = await runOnce({
      list: async () => [snap()],
      owner,
      live: false,
      intervalMs: 0,
      sink: alerts,
      config: cfg(),
      prices: goodPrices,
      execute: async (receipt) => {
        executed += 1;
        return receipt;
      },
    });
    expect(executed).toBe(0);
    expect(receipts.some((r) => r.dryRun)).toBe(true);
  });
});
