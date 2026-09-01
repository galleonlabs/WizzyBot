import { defineTool } from "eve/tools";
import { z } from "zod";
import { listPositions } from "../lib/hosted.js";

export default defineTool({
  description: "List Uniswap LP positions (v2, v3, v4) for a wallet. Chain base|robinhood (default base).",
  inputSchema: z.object({
    owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("EOA to inspect."),
    chain: z.enum(["base", "robinhood"]).optional().default("base").describe("base | robinhood (default base)."),
  }),
  async execute({ owner, chain }) {
    return listPositions(owner, chain ?? "base");
  },
});
