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
export { planAllocation } from "./portfolio/allocation.js";
export { planDualChainAllocation } from "./portfolio/dual-chain.js";
export { planPositionAction } from "./portfolio/position-actions.js";
export { quoteBaseToRobinhoodEth, relayIntentStatus } from "./relay/client.js";
