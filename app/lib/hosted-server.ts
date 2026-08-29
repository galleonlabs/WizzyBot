import { createRequire } from "node:module";

/**
 * Server-only loader. Same CJS path eve tools use.
 * Do not import this from client components.
 */
export type HostedSurface = {
  listPositions: (owner?: string) => Promise<{
    owner?: string;
    count?: number;
    positions?: unknown[];
  }>;
  statusPosition: (tokenId: string) => Promise<unknown>;
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

export function missingOwnerPayload() {
  return {
    owner: undefined as string | undefined,
    count: 0,
    positions: [] as unknown[],
    error: "Connect a wallet to load positions.",
  };
}

export async function fetchPositionList(owner?: string) {
  if (!owner) return missingOwnerPayload();
  try {
    const result = await hosted.listPositions(owner);
    return {
      owner: typeof result.owner === "string" ? result.owner : owner,
      count: typeof result.count === "number" ? result.count : (result.positions?.length ?? 0),
      positions: Array.isArray(result.positions) ? result.positions : [],
    };
  } catch (err) {
    return {
      owner,
      count: 0,
      positions: [] as unknown[],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchPositionStatus(tokenId: string) {
  if (!tokenId.trim()) {
    throw new Error("tokenId is required");
  }
  return hosted.statusPosition(tokenId.trim());
}
