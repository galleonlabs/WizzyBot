/**
 * Deep links into the venues that finish what Wizzy starts. Uniswap prefills
 * its create page from currencyA/currencyB/chain/feeTier (verified on Base and
 * Robinhood Chain); Aerodrome's deposit page takes token0/token1/type.
 */
// @ts-ignore NodeNext test resolution requires .js while Turbopack requires the source path.
import type { ChainSlug } from "./chains";

export type LinkVenue = "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "aerodrome-slipstream";

const UNISWAP = "https://app.uniswap.org";
const AERODROME = "https://aerodrome.finance";
const NATIVE = "NATIVE";

export function chainSlugForUniswap(chain: ChainSlug): string {
  return chain === "robinhood" ? "robinhood" : "base";
}

export function venueLabelFor(venue: LinkVenue): string {
  if (venue === "aerodrome-slipstream") return "Aerodrome";
  return "Uniswap";
}

/** Create page for a new position in this pool. ETH is passed as NATIVE so Uniswap wraps it. */
export function createPositionUrl(input: {
  venue: LinkVenue;
  chain: ChainSlug;
  token: string;
  quote?: string;
  fee?: number | null;
  tickSpacing?: number | null;
}): string {
  if (input.venue === "aerodrome-slipstream") {
    const params = new URLSearchParams({ token0: input.quote ?? "eth", token1: input.token });
    if (input.tickSpacing) params.set("type", String(input.tickSpacing));
    return `${AERODROME}/deposit?${params.toString()}`;
  }
  const version = input.venue === "uniswap-v2" ? "v2" : input.venue === "uniswap-v4" ? "v4" : "v3";
  const params = new URLSearchParams({ currencyA: NATIVE, currencyB: input.token, chain: chainSlugForUniswap(input.chain) });
  if (version !== "v2" && input.fee) params.set("feeTier", String(input.fee));
  return `${UNISWAP}/positions/create/${version}?${params.toString()}`;
}

/** The venue page that manages an existing position: add, remove, migrate. */
export function managePositionUrl(input: {
  venue: LinkVenue;
  chain: ChainSlug;
  tokenId?: string;
  pool?: string;
}): string {
  if (input.venue === "aerodrome-slipstream") return `${AERODROME}/dash`;
  const chain = chainSlugForUniswap(input.chain);
  if (input.venue === "uniswap-v2") return input.pool ? `${UNISWAP}/positions/v2/${chain}/${input.pool}` : `${UNISWAP}/positions`;
  const version = input.venue === "uniswap-v4" ? "v4" : "v3";
  return input.tokenId ? `${UNISWAP}/positions/${version}/${chain}/${input.tokenId}` : `${UNISWAP}/positions`;
}

export function fomoTokenUrl(chain: ChainSlug, token: string): string {
  return `https://fomo.family/tokens/${chain}/${token.toLowerCase()}?r=makemememarkets`;
}

export function explorerTokenUrl(chain: ChainSlug, token: string): string {
  return chain === "robinhood" ? `https://robinhoodchain.blockscout.com/token/${token}` : `https://basescan.org/token/${token}`;
}
