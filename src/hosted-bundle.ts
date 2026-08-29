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
  statusPosition,
} from "./surfaces/hosted.js";
