import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { base } from "viem/chains";
import { readStablePositions, getStableCatalog } from "../../../lib/portfolio-server";

export const runtime = "nodejs";

const erc20BalanceAbi = [{
  type: "function", name: "balanceOf", stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }],
}] as const;

export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner");
  if (!owner || !isAddress(owner)) {
    return NextResponse.json({ error: "A valid wallet address is required" }, { status: 400 });
  }
  try {
    const catalog = getStableCatalog() as { asset: { address: `0x${string}` } };
    const client = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
    });
    const [positions, walletUnits] = await Promise.all([
      readStablePositions({ owner }),
      client.readContract({ address: catalog.asset.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [owner] }),
    ]);
    return NextResponse.json({ positions, walletUnits: walletUnits.toString() }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not read yield positions" }, {
      status: 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
