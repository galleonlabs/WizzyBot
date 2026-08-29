import { getAddress, type Address, type Hex } from "viem";

/** Base mainnet. */
export const CHAIN_ID = 8453 as const;

// Base's publicnode endpoint has materially higher public read capacity than
// the rate-limited mainnet.base.org endpoint. Operators should still provide a
// dedicated RPC URL in production.
export const BASE_RPC_DEFAULT = "https://base-rpc.publicnode.com";

export const LP_API_URL = "https://liquidity.api.uniswap.org";
export const TRADE_API_URL = "https://trade-api.gateway.uniswap.org/v1";

/** All product fees. Do not change without an explicit treasury rotation. */
export const TREASURY: Address = getAddress(
  "0xC141Cbe4f4a9CAbc3cc78159a9268a4e008922CD",
);

export const ADDRESSES = {
  factory: getAddress("0x33128a8fC17869897dcE68Ed026d694621f6FDfD"),
  nfpm: getAddress("0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"),
  swapRouter02: getAddress("0x2626664c2603336E57B271c5C0b26F421741e481"),
  quoterV2: getAddress("0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a"),
  permit2: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
  universalRouter: getAddress("0x6fF5693b99212Da76ad316178A184AB56D299b43"),
  weth: getAddress("0x4200000000000000000000000000000000000006"),
  nativeEth: getAddress("0x0000000000000000000000000000000000000000"),
  usdc: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  /** Bridged USDbC. Never treat as USDC. */
  usdBc: getAddress("0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA"),
  v2Factory: getAddress("0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6"),
  v2Router: getAddress("0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24"),
  /** Official Uniswap v4 on Base. */
  v4PoolManager: getAddress("0x498581fF718922c3f8e6A244956aF099B2652b2b"),
  v4PositionManager: getAddress("0x7C5f5A4bBd8fD63184577525326123B519429bDc"),
  v4StateView: getAddress("0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71"),
  v4Quoter: getAddress("0x0d5e0F971ED27FBfF6c2837bf31316121532048d"),
} as const;

/** Static signer allowlist. Position tokens may be added per-action. */
export const SIGNER_ALLOWLIST: readonly Address[] = [
  ADDRESSES.nfpm,
  ADDRESSES.permit2,
  ADDRESSES.universalRouter,
  ADDRESSES.v2Router,
  ADDRESSES.v4PositionManager,
  TREASURY,
];

export const FEE_TIER = {
  compoundBps: 200, // 2% of compounded fees
  rangeExitFeeBps: 200, // 2% of uncollected fees
  notionalBps: 15, // 0.15% of position notional
} as const;

export const BPS_DENOMINATOR = 10_000n;

export const Q128 = 1n << 128n;
export const Q96 = 1n << 96n;

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

export const FEE_AMOUNT_TICK_SPACING: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

export const ZERO_ADDR: Address = ADDRESSES.nativeEth;
export const EMPTY_HEX: Hex = "0x";

export const DEFAULT_DEADLINE_SEC = 600;
export const DEFAULT_SLIPPAGE_BPS = 50;
export const DEFAULT_MIN_POSITION_USD = 50;
export const DEFAULT_MIN_FEE_USD = 1;
export const DEFAULT_MAX_PRICE_IMPACT_BPS = 50;
export const DEFAULT_COOLDOWN_SEC = 3600;
