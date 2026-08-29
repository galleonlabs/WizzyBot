/** Product line. CLI, MCP, chat, and Telegram all use this. No org name. */
export const PRODUCT_LINE = "Liquidity, as an agent. v2, v3, and v4. You hold the NFT.";

export const PRODUCT_VERBS = ["list", "status", "mint", "compound", "range", "exit", "simulate"] as const;

export type ProductVerb = (typeof PRODUCT_VERBS)[number];

export const PRODUCT_HELP = [
  `Una. Base and Robinhood. ${PRODUCT_LINE}`,
  "list | status | mint | compound | range | exit | simulate",
  "--protocol v2|v3|v4 (default v3). --chain base|robinhood (default base).",
  "Dry-run default. --live and yes to broadcast.",
].join("\n");
