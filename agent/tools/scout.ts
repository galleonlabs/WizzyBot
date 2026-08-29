import { defineTool } from "eve/tools";
import { z } from "zod";
import { scoutMarkets } from "../lib/hosted.js";

export default defineTool({
  description: "Explain why curated meme LP markets are included, using current liquidity, volume, fee pace, and explicit risk warnings. Advisory only.",
  inputSchema: z.object({
    chain: z.enum(["base", "robinhood"]).optional().describe("Optional chain filter."),
  }),
  async execute({ chain }) {
    return scoutMarkets(chain);
  },
});
