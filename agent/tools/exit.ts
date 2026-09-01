import { defineTool } from "eve/tools";
import { z } from "zod";
import { exitPosition } from "../lib/hosted.js";

export default defineTool({
  description: "Fully exit a position, optional swap to one token. Dry-run by default.",
  inputSchema: z.object({
    tokenId: z.string().min(1),
    exitPrice: z.number().positive().optional(),
    swapTo: z.string().optional(),
    live: z.boolean().optional().default(false).describe("Prepare the connected EOA transaction plan. Default dry-run."),
    confirm: z.boolean().optional().default(false).describe("Required true before preparing a wallet transaction plan."),
    owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Connected EOA that owns and approves the position."),
    chain: z.enum(["base", "robinhood"]).optional().default("base").describe("base | robinhood (default base)."),
    noFee: z.boolean().optional(),
    feeSource: z.enum(["fees", "notional"]).optional(),
  }),
  approval: ({ toolInput }) => Boolean(toolInput && typeof toolInput === "object" && "live" in toolInput && (toolInput as { live?: boolean }).live),
  async execute(input) {
    return exitPosition(input);
  },
});
