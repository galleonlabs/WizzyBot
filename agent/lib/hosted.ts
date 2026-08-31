/**
 * Eve evaluates agent/* as ESM. Uniswap SDK ESM is extensionless, so tools
 * must not import those packages directly. Import the pre-bundled CJS
 * statically so the hosted build inlines it into the function output; a
 * dynamic require would leave the file untraced and crash on Vercel.
 */
import hostedCjs from "../../vendor/hosted-cjs/index.cjs";

export type HostedSurface = {
  listPositions: (owner?: string, chain?: string) => Promise<unknown>;
  statusPosition: (tokenId: string, chain?: string) => Promise<unknown>;
  scoutMarkets: (chain?: string) => Promise<unknown>;
  compoundPosition: (input: {
    tokenId: string;
    owner?: string;
    live?: boolean;
    confirm?: boolean;
    noFee?: boolean;
    feeSource?: "fees" | "notional";
    chain?: string;
  }) => Promise<unknown>;
  rangePosition: (input: {
    tokenId: string;
    owner?: string;
    live?: boolean;
    confirm?: boolean;
    noFee?: boolean;
    feeSource?: "fees" | "notional";
    chain?: string;
    oorPercent?: number;
  }) => Promise<unknown>;
  exitPosition: (input: {
    tokenId: string;
    owner?: string;
    live?: boolean;
    confirm?: boolean;
    noFee?: boolean;
    feeSource?: "fees" | "notional";
    chain?: string;
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
    chain?: string;
  }) => Promise<unknown>;
  runKeeperScan: (input?: { owner?: string; live?: boolean; chain?: string }) => Promise<{
    owner?: unknown;
    decisions?: unknown;
  }>;
  keeperLiveEnabled: (source?: NodeJS.ProcessEnv) => boolean;
  jsonSafe: <T>(value: T) => T;
  assertWriteAllowed: (flags: { live?: boolean; confirm?: boolean }) => boolean;
};

const hosted = hostedCjs as HostedSurface;

export const listPositions = hosted.listPositions;
export const statusPosition = hosted.statusPosition;
export const scoutMarkets = hosted.scoutMarkets;
export const compoundPosition = hosted.compoundPosition;
export const rangePosition = hosted.rangePosition;
export const exitPosition = hosted.exitPosition;
export const mintPosition = hosted.mintPosition;
export const runKeeperScan = hosted.runKeeperScan;
export const keeperLiveEnabled = hosted.keeperLiveEnabled;
export const jsonSafe = hosted.jsonSafe;
export const assertWriteAllowed = hosted.assertWriteAllowed;
