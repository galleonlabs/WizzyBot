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
export { planAllocation } from "./portfolio/allocation.js";
export { planPositionAction } from "./portfolio/position-actions.js";
export { readLiquidityProfile } from "./portfolio/liquidity-profile.js";
export { quoteBaseToRobinhoodEth, quoteBaseToSolanaSol, quoteEthToRobinhood, relayIntentStatus } from "./relay/client.js";
export { ETH_FUNDING_CHAINS } from "./relay/origins.js";
