import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { ROBINHOOD_RPC_DEFAULT, robinhoodChain } from "../../lib/chains";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "A valid wallet address is required" }, { status: 400 });
  }

  try {
    const client = createPublicClient({
      chain: robinhoodChain,
      transport: http(process.env.ROBINHOOD_RPC_URL || ROBINHOOD_RPC_DEFAULT),
    });
    const balance = await client.getBalance({ address });
    return NextResponse.json({ balanceWei: balance.toString() }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not read the Robinhood Chain balance" }, {
      status: 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
