import { defineTool } from "eve/tools";
import { z } from "zod";
import { rangePosition } from "../../src/surfaces/hosted.js";

export default defineTool({
  description: "Same-width recenter when out of range (or near-edge). Dry-run by default.",
  inputSchema: z.object({
    tokenId: z.string().min(1),
    oorPercent: z.number().min(0).max(100).optional(),
    live: z.boolean().optional().default(false).describe("Broadcast on Base. Default dry-run."),
    confirm: z.boolean().optional().default(false).describe("Required true before any live write."),
    owner: z.string().optional().describe("Wallet that holds the NFT. Defaults to the Privy hosted wallet."),
    noFee: z.boolean().optional(),
    feeSource: z.enum(["fees", "notional"]).optional(),
  }),
  approval: ({ toolInput }) => Boolean(toolInput && typeof toolInput === "object" && "live" in toolInput && (toolInput as { live?: boolean }).live),
  async execute(input) {
    return rangePosition(input);
  },
});
