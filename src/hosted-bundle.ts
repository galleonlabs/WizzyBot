/** CJS bundle entry for eve. Do not import from agent/ as ESM. */
export {
  assertWriteAllowed,
  compoundPosition,
  exitPosition,
  jsonSafe,
  keeperLiveEnabled,
  listPositions,
  mintPosition,
  rangePosition,
  runKeeperScan,
  scoutMarkets,
  statusPosition,
} from "./surfaces/hosted.js";
export { getMarketCatalog } from "./markets/catalog.js";
export { fetchMarketStats } from "./markets/stats.js";
export { getSolanaMarketCatalog } from "./markets/solana-catalog.js";
export { fetchSolanaMarketStats } from "./markets/solana-stats.js";
export { planAllocation } from "./portfolio/allocation.js";
export { planDualChainAllocation } from "./portfolio/dual-chain.js";
export { planMemeIndex, planRobinhoodIndex } from "./portfolio/index-plan.js";
export { getRobinhoodIndexBreadthPolicy } from "./portfolio/index-selection.js";
export { getMemeIndexBreadthPolicy } from "./portfolio/index-selection.js";
export { planPositionAction } from "./portfolio/position-actions.js";
export { quoteBaseToRobinhoodEth, quoteBaseToSolanaSol, quoteEthToRobinhood, relayIntentStatus } from "./relay/client.js";
export { ETH_FUNDING_CHAINS } from "./relay/origins.js";
