import { defineTool } from "eve/tools";
import { z } from "zod";
import { mintPosition } from "../lib/hosted.js";

export default defineTool({
  description: "Mint a Uniswap LP position. NFT stays in the user wallet. Dry-run by default.",
  inputSchema: z.object({
    token0: z.string().min(1),
    token1: z.string().min(1),
    fee: z.number().int().positive(),
    widthPct: z.number().positive().optional(),
    tickLower: z.number().int().optional(),
    tickUpper: z.number().int().optional(),
    amount0: z.string().optional(),
    amount1: z.string().optional(),
    live: z.boolean().optional().default(false).describe("Broadcast on Base. Default dry-run."),
    confirm: z.boolean().optional().default(false).describe("Required true before any live write."),
    owner: z.string().optional().describe("Wallet that holds the NFT. Defaults to the Privy hosted wallet."),
    noFee: z.boolean().optional(),
    feeSource: z.enum(["fees", "notional"]).optional(),
  }),
  approval: ({ toolInput }) => Boolean(toolInput && typeof toolInput === "object" && "live" in toolInput && (toolInput as { live?: boolean }).live),
  async execute(input) {
    return mintPosition(input);
  },
});
