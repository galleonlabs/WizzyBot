import { NextResponse } from "next/server";
import { createPublicClient, getAddress, http, isAddress, type Chain } from "viem";
import { arbitrum, mainnet, optimism } from "viem/chains";
import { base, parseChainSlug, ROBINHOOD_RPC_DEFAULT, robinhoodChain } from "../../lib/chains";

export const runtime = "nodejs";

const ERC20_BALANCE_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

/** Every network a wallet can pay from. Server-side RPCs keep credentials and rate limits off the client. */
function chainFor(params: URLSearchParams): { chain: Chain; slug: string; rpcUrls: string[] } | null {
  const chainId = Number(params.get("chainId") ?? "");
  if (chainId === 1) return { chain: mainnet, slug: "ethereum", rpcUrls: [process.env.ETHEREUM_RPC_URL || "https://eth.merkle.io", "https://ethereum-rpc.publicnode.com"] };
  if (chainId === 42161) return { chain: arbitrum, slug: "arbitrum", rpcUrls: [process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"] };
  if (chainId === 10) return { chain: optimism, slug: "optimism", rpcUrls: [process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"] };
  let slug: "base" | "robinhood";
  try {
    slug = chainId === 8453 ? "base" : chainId === 4663 ? "robinhood" : parseChainSlug(params.get("chain"));
  } catch {
    return null;
  }
  // Public RPCs can rate-limit shared serverless egress. Each chain gets an
  // independent fallback before the balance is treated as unavailable.
  return slug === "robinhood"
    ? { chain: robinhoodChain, slug, rpcUrls: [...new Set([process.env.ROBINHOOD_RPC_URL || ROBINHOOD_RPC_DEFAULT, "https://robinhood-rpc.publicnode.com"])] }
    : { chain: base, slug, rpcUrls: [...new Set([process.env.BASE_RPC_URL || base.rpcUrls.default.http[0], "https://base-rpc.publicnode.com"])] };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const address = params.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "A valid wallet address is required" }, { status: 400 });
  }
  const target = chainFor(params);
  if (!target) return NextResponse.json({ error: "Use chain=base|robinhood or a supported chainId" }, { status: 400 });
  const tokenParam = params.get("token");
  if (tokenParam && !isAddress(tokenParam)) return NextResponse.json({ error: "token must be an address" }, { status: 400 });
  const token = tokenParam ? getAddress(tokenParam) : null;

  for (const [index, rpcUrl] of target.rpcUrls.entries()) {
    try {
      const client = createPublicClient({ chain: target.chain, transport: http(rpcUrl, { timeout: 8_000 }) });
      const balance = token
        ? await client.readContract({ address: token, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [address] })
        : await client.getBalance({ address });
      return NextResponse.json({ balanceWei: balance.toString(), chain: target.slug, chainId: target.chain.id, token: token ?? null }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch {
      if (index === target.rpcUrls.length - 1) break;
    }
  }
  return NextResponse.json({ error: `Could not read the ${target.chain.name} balance` }, {
    status: 502,
    headers: { "Cache-Control": "private, no-store" },
  });
}
