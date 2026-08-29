/** Product copy. CLI, MCP, chat, and Telegram all use this. No org name. */
export const PRODUCT_NAME = "Una";
export const PRODUCT_HANDLE = "unabot";
export const PRODUCT_LINE = "Liquidity, as an agent.";
export const PRODUCT_SUPPORT = "v2, v3, and v4. You hold the NFT.";
export const PRODUCT_CONFIRM = "Dry-run first. Confirm to go live.";

export const PRODUCT_BLURB = `${PRODUCT_LINE} ${PRODUCT_SUPPORT}`;

export const PRODUCT_VERBS = ["list", "status", "mint", "compound", "range", "exit", "simulate"] as const;

export type ProductVerb = (typeof PRODUCT_VERBS)[number];

export const PRODUCT_HELP = [
  `${PRODUCT_NAME}. ${PRODUCT_LINE}`,
  PRODUCT_SUPPORT,
  "list | status | mint | compound | range | exit | simulate",
  "--protocol v2|v3|v4 (default v3).",
  PRODUCT_CONFIRM,
].join("\n");
