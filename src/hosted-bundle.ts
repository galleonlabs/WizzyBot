/** CJS bundle entry for eve. Do not import from agent/ as ESM. */
export {
  assertWriteAllowed,
  compoundPosition,
  exitPosition,
  jsonSafe,
  listPositions,
  mintPosition,
  rangePosition,
  runKeeperScan,
  scoutMarkets,
  statusPosition,
} from "./surfaces/hosted.js";
export { getMarketCatalog } from "./markets/catalog.js";
export { fetchMarketStats } from "./markets/stats.js";
export { fetchRecentPoolActivity, mergePoolActivityItems } from "./markets/activity.js";
export { getSolanaMarketCatalog } from "./markets/solana-catalog.js";
export { fetchSolanaMarketStats } from "./markets/solana-stats.js";
export { planPositionAction } from "./portfolio/position-actions.js";
export { readLiquidityProfile } from "./portfolio/liquidity-profile.js";
export { quoteRelaySwap, relayIntentStatus } from "./relay/client.js";
export { RELAY_CHAINS } from "./relay/origins.js";
export { catalogFallbackSnapshot, fetchCuratedPools, mergeSnapshots } from "./markets/discovery.js";
