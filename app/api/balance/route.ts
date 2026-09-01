import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { base, parseChainSlug, ROBINHOOD_RPC_DEFAULT, robinhoodChain } from "../../lib/chains";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const address = params.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "A valid wallet address is required" }, { status: 400 });
  }

  let chainSlug: "base" | "robinhood";
  try {
    chainSlug = parseChainSlug(params.get("chain"));
  } catch {
    return NextResponse.json({ error: "Use chain=base or chain=robinhood" }, { status: 400 });
  }

  const chain = chainSlug === "robinhood" ? robinhoodChain : base;
  // Public RPCs can rate-limit shared serverless egress. Each chain gets an
  // independent fallback before the balance is treated as unavailable.
  const rpcUrls = chainSlug === "robinhood"
    ? [...new Set([process.env.ROBINHOOD_RPC_URL || ROBINHOOD_RPC_DEFAULT, "https://robinhood-rpc.publicnode.com"])]
    : [...new Set([process.env.BASE_RPC_URL || base.rpcUrls.default.http[0], "https://base-rpc.publicnode.com"])];
  for (const [index, rpcUrl] of rpcUrls.entries()) {
    try {
      const client = createPublicClient({ chain, transport: http(rpcUrl) });
      const balance = await client.getBalance({ address });
      return NextResponse.json({ balanceWei: balance.toString(), chain: chainSlug, chainId: chain.id }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch {
      if (index === rpcUrls.length - 1) break;
    }
  }
  return NextResponse.json({ error: `Could not read the ${chainSlug === "robinhood" ? "Robinhood Chain" : "Base"} balance` }, {
    status: 502,
    headers: { "Cache-Control": "private, no-store" },
  });
}
