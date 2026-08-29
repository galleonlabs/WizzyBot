import { createRequire } from "node:module";

/**
 * Eve evaluates agent/* as ESM and leaves package deps external.
 * Uniswap SDK ESM is extensionless, so tools must not import those packages.
 * Load the pre-bundled CJS via a relative path so eve does not need the
 * file: workspace package. Package-name require is a fallback after the
 * bundle script copies into node_modules.
 */
const require = createRequire(import.meta.url);

export type HostedSurface = {
  listPositions: (owner?: string) => Promise<unknown>;
  statusPosition: (tokenId: string) => Promise<unknown>;
  compoundPosition: (input: {
    tokenId: string;
    owner?: string;
    live?: boolean;
    confirm?: boolean;
    noFee?: boolean;
    feeSource?: "fees" | "notional";
  }) => Promise<unknown>;
  rangePosition: (input: {
    tokenId: string;
    owner?: string;
    live?: boolean;
    confirm?: boolean;
    noFee?: boolean;
    feeSource?: "fees" | "notional";
    oorPercent?: number;
  }) => Promise<unknown>;
  exitPosition: (input: {
    tokenId: string;
    owner?: string;
    live?: boolean;
    confirm?: boolean;
    noFee?: boolean;
    feeSource?: "fees" | "notional";
    exitPrice?: number;
    swapTo?: string;
  }) => Promise<unknown>;
  mintPosition: (input: {
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
  }) => Promise<unknown>;
  runKeeperScan: (input?: { owner?: string; live?: boolean }) => Promise<{
    owner?: unknown;
    decisions?: unknown;
  }>;
  keeperLiveEnabled: (source?: NodeJS.ProcessEnv) => boolean;
  jsonSafe: <T>(value: T) => T;
  assertWriteAllowed: (flags: { live?: boolean; confirm?: boolean }) => boolean;
};

function loadHosted(): HostedSurface {
  try {
    return require("../../vendor/hosted-cjs/index.cjs") as HostedSurface;
  } catch {
    return require("unabot-hosted-cjs") as HostedSurface;
  }
}

const hosted = loadHosted();

export const listPositions = hosted.listPositions;
export const statusPosition = hosted.statusPosition;
export const compoundPosition = hosted.compoundPosition;
export const rangePosition = hosted.rangePosition;
export const exitPosition = hosted.exitPosition;
export const mintPosition = hosted.mintPosition;
export const runKeeperScan = hosted.runKeeperScan;
export const keeperLiveEnabled = hosted.keeperLiveEnabled;
export const jsonSafe = hosted.jsonSafe;
export const assertWriteAllowed = hosted.assertWriteAllowed;
