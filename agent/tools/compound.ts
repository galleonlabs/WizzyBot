import { defineTool } from "eve/tools";
import { z } from "zod";
import { compoundPosition } from "../lib/hosted.js";

export default defineTool({
  description: "Collect fees, optional swap to ratio, increase liquidity. Skips if uneconomic. Dry-run by default.",
  inputSchema: z.object({
    tokenId: z.string().min(1),
    live: z.boolean().optional().default(false).describe("Broadcast on Base. Default dry-run."),
    confirm: z.boolean().optional().default(false).describe("Required true before any live write."),
    owner: z.string().optional().describe("Wallet that holds the NFT. Defaults to the Privy hosted wallet."),
    noFee: z.boolean().optional(),
    feeSource: z.enum(["fees", "notional"]).optional(),
  }),
  approval: ({ toolInput }) => Boolean(toolInput && typeof toolInput === "object" && "live" in toolInput && (toolInput as { live?: boolean }).live),
  async execute(input) {
    return compoundPosition(input);
  },
});
