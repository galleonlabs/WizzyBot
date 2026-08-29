import { getAddress, type Address } from "viem";

export type AerodromeDeploymentId = "legacy" | "min-unstake";

export type AerodromeDeployment = {
  id: AerodromeDeploymentId;
  factory: Address;
  positionManager: Address;
  quoter: Address;
  swapRouter: Address;
};

/**
 * Official Base Slipstream deployments. Pools are tied to one factory family,
 * so every configured market must resolve through the matching periphery set.
 */
export const AERODROME_DEPLOYMENTS: Record<AerodromeDeploymentId, AerodromeDeployment> = {
  legacy: {
    id: "legacy",
    factory: getAddress("0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A"),
    positionManager: getAddress("0x827922686190790b37229fd06084350E74485b72"),
    quoter: getAddress("0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0"),
    swapRouter: getAddress("0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5"),
  },
  "min-unstake": {
    id: "min-unstake",
    factory: getAddress("0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef"),
    positionManager: getAddress("0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53"),
    quoter: getAddress("0x514c8B5f54112481E28028F1166Bd78501089259"),
    swapRouter: getAddress("0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F"),
  },
};

export function aerodromeDeployment(id: AerodromeDeploymentId): AerodromeDeployment {
  return AERODROME_DEPLOYMENTS[id];
}
