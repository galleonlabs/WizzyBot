import { defineTool } from "eve/tools";
import { z } from "zod";
import { statusPosition } from "../lib/hosted.js";

export default defineTool({
  description: "Position card: range, amounts, fees, APR, HOLD, divergence.",
  inputSchema: z.object({
    tokenId: z.string().min(1).describe("NFPM token id"),
  }),
  async execute({ tokenId }) {
    return statusPosition(tokenId);
  },
});
