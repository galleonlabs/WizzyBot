import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { FeeSource, PolicyDefaults, PolicyProtocol, PositionPolicy, UnaBotConfig } from "../types.js";
import {
  DEFAULT_COOLDOWN_SEC,
  DEFAULT_MAX_PRICE_IMPACT_BPS,
  DEFAULT_MIN_FEE_USD,
  DEFAULT_MIN_POSITION_USD,
} from "../constants.js";

const feeSource = z.enum(["fees", "notional"]);
const protocol = z
  .enum(["v2", "v3", "v4", "V2", "V3", "V4"])
  .transform((v): PolicyProtocol => v.toLowerCase() as PolicyProtocol);

const defaultsSchema = z.object({
  minFeeUsd: z.number().nonnegative().default(DEFAULT_MIN_FEE_USD),
  minPositionUsd: z.number().nonnegative().default(DEFAULT_MIN_POSITION_USD),
  maxPriceImpactBps: z.number().int().nonnegative().default(DEFAULT_MAX_PRICE_IMPACT_BPS),
  cooldownSec: z.number().int().nonnegative().default(DEFAULT_COOLDOWN_SEC),
  spendCapUsd: z.number().nonnegative().default(10_000),
  oorPercent: z.number().min(0).max(100).default(0),
  compound: z.boolean().default(true),
  autoRange: z.boolean().default(true),
  autoExit: z.boolean().default(false),
  feeSource: feeSource.default("fees"),
  noFee: z.boolean().default(false),
  exitPrice: z.number().positive().optional(),
  exitToken: z.string().optional(),
  protocol: protocol.optional(),
});

const positionSchema = defaultsSchema.partial().extend({
  tokenId: z.string(),
  lastRunAt: z.number().optional(),
  spentUsd: z.number().nonnegative().optional(),
});

const fileSchema = z.object({
  defaults: defaultsSchema.default({}),
  positions: z.record(z.string(), positionSchema.partial()).default({}),
});

export const DEFAULT_POLICY: PolicyDefaults = {
  minFeeUsd: DEFAULT_MIN_FEE_USD,
  minPositionUsd: DEFAULT_MIN_POSITION_USD,
  maxPriceImpactBps: DEFAULT_MAX_PRICE_IMPACT_BPS,
  cooldownSec: DEFAULT_COOLDOWN_SEC,
  spendCapUsd: 10_000,
  oorPercent: 0,
  compound: true,
  autoRange: true,
  autoExit: false,
  feeSource: "fees" as FeeSource,
  noFee: false,
};

export function homeConfigPath(): string {
  return join(homedir(), ".unabot", "config.json");
}

export function cwdConfigPath(): string {
  return join(process.cwd(), "unabot.config.json");
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function merge(
  base: UnaBotConfig,
  overlay: z.infer<typeof fileSchema>,
): UnaBotConfig {
  const positions: Record<string, PositionPolicy> = { ...base.positions };
  for (const [id, raw] of Object.entries(overlay.positions ?? {})) {
    positions[id] = {
      ...positions[id],
      ...raw,
      tokenId: raw.tokenId ?? id,
    };
  }
  return {
    defaults: { ...base.defaults, ...overlay.defaults },
    positions,
  };
}

export function loadConfig(explicitPath?: string): UnaBotConfig {
  let cfg: UnaBotConfig = { defaults: { ...DEFAULT_POLICY }, positions: {} };
  cfg = merge(cfg, fileSchema.parse(readJson(homeConfigPath())));
  cfg = merge(cfg, fileSchema.parse(readJson(cwdConfigPath())));
  if (explicitPath) {
    cfg = merge(cfg, fileSchema.parse(readJson(explicitPath)));
  }
  return cfg;
}

export function policyFor(cfg: UnaBotConfig, tokenId: bigint | string): PolicyDefaults & PositionPolicy {
  const id = String(tokenId);
  const overlay = cfg.positions[id] ?? { tokenId: id };
  return { ...cfg.defaults, ...overlay, tokenId: id };
}

export function saveConfig(cfg: UnaBotConfig, path = cwdConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
}

export function copyPolicyToNewToken(
  cfg: UnaBotConfig,
  fromId: string,
  toId: string,
): UnaBotConfig {
  const prev = cfg.positions[fromId] ?? { tokenId: fromId };
  return {
    ...cfg,
    positions: {
      ...cfg.positions,
      [toId]: { ...prev, tokenId: toId, lastRunAt: undefined },
    },
  };
}

export function markRun(cfg: UnaBotConfig, tokenId: string, at = Date.now() / 1000, spendUsd = 0): UnaBotConfig {
  const prev = cfg.positions[tokenId] ?? { tokenId };
  return {
    ...cfg,
    positions: {
      ...cfg.positions,
      [tokenId]: {
        ...prev,
        tokenId,
        lastRunAt: at,
        spentUsd: (prev.spentUsd ?? 0) + spendUsd,
      },
    },
  };
}
