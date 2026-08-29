import { defineTool } from "eve/tools";
import { z } from "zod";
import { listPositions } from "../lib/hosted.js";

export default defineTool({
  description: "List Uniswap LP positions (v2, v3, v4) for a wallet on Base.",
  inputSchema: z.object({
    owner: z.string().optional().describe("Wallet to inspect. Defaults to the Privy hosted wallet."),
  }),
  async execute({ owner }) {
    return listPositions(owner);
  },
});
