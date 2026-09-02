import { createRequire } from "node:module";
import type { ChainSlug } from "./chains";

type EvmProtocol = "V2" | "V3" | "V4";

/**
 * Server-only loader. Same CJS path eve tools use.
 * Do not import this from client components.
 */
export type HostedSurface = {
  listPositions: (owner?: string, chain?: ChainSlug) => Promise<{
    owner?: string;
    count?: number;
    positions?: unknown[];
    chain?: string;
    ethUsd?: number;
  }>;
  statusPosition: (tokenId: string, chain?: ChainSlug, protocol?: EvmProtocol, positionManager?: string) => Promise<unknown>;
};

function loadHosted(): HostedSurface {
  const require = createRequire(import.meta.url);
  try {
    return require("../../vendor/hosted-cjs/index.cjs") as HostedSurface;
  } catch {
    return require("unabot-hosted-cjs") as HostedSurface;
  }
}

const hosted = loadHosted();

export function missingOwnerPayload(chain: ChainSlug = "base") {
  return {
    owner: undefined as string | undefined,
    chain,
    count: 0,
    positions: [] as unknown[],
    error: "Connect a wallet to load positions.",
  };
}

export async function fetchPositionList(owner?: string, chain: ChainSlug = "base") {
  if (!owner) return missingOwnerPayload(chain);
  try {
    const result = await hosted.listPositions(owner, chain);
    const positions = Array.isArray(result.positions) ? result.positions : [];
    return {
      owner: typeof result.owner === "string" ? result.owner : owner,
      chain,
      count: typeof result.count === "number" ? result.count : positions.length,
      positions,
      ethUsd: typeof result.ethUsd === "number" && result.ethUsd > 0 ? result.ethUsd : undefined,
    };
  } catch (err) {
    console.error("[wizzy-position-list-error]", err instanceof Error ? err.name : "UnknownError");
    return {
      owner,
      chain,
      count: 0,
      positions: [] as unknown[],
      error: "Could not read wallet positions",
    };
  }
}

export async function fetchPositionStatus(
  tokenId: string,
  chain: ChainSlug = "base",
  protocol: EvmProtocol = "V3",
  positionManager?: string,
) {
  if (!tokenId.trim()) {
    throw new Error("tokenId is required");
  }
  return hosted.statusPosition(tokenId.trim(), chain, protocol, positionManager);
}
