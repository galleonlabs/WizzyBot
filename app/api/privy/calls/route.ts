import { NextResponse } from "next/server";
import { z } from "zod";
import { getRobinhoodIndexState } from "../../../lib/portfolio-server";
import { ApiRequestError, apiErrorResponse, readApiJson } from "../../../lib/api-request-server";
import { DEFAULT_PRIVY_APP_ID } from "../../../lib/privy-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Identifier = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Hex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).max(300_002);
const Call = z.object({
  to: Address,
  data: Hex,
  value: z.string().regex(/^0x[0-9a-fA-F]+$/).max(66),
}).strict();
const PrivyBody = z.object({
  method: z.literal("wallet_sendCalls"),
  caip2: z.literal("eip155:4663"),
  chain_type: z.literal("ethereum"),
  sponsor: z.literal(true),
  params: z.object({ calls: z.array(Call).min(1).max(40) }).strict(),
}).strict();
const SubmitBody = z.object({
  walletId: Identifier,
  body: PrivyBody,
  signature: z.string().min(16).max(8_192),
}).strict();

const ROBINHOOD_CONTRACTS = [
  "0x73991a25c818bf1f1128deaab1492d45638de0d3", // Uniswap v3 position manager
  "0xcaf681a66d020601342297493863e78c959e5cb2", // Uniswap swap router
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", // WETH
  "0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42", // Wizzy treasury
] as const;
const MAX_TOTAL_VALUE_WEI = 1_000n * 10n ** 18n;

export async function POST(request: Request) {
  try {
    const parsed = SubmitBody.parse(await readApiJson(request, 1_500_000));
    await assertAllowedCalls(parsed.body.params.calls);
    const credentials = privyCredentials();
    const response = await fetch(`https://api.privy.io/v1/wallets/${encodeURIComponent(parsed.walletId)}/rpc`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString("base64")}`,
        "content-type": "application/json",
        "privy-app-id": credentials.appId,
        "privy-authorization-signature": parsed.signature,
      },
      body: JSON.stringify(parsed.body),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      console.error("[wizzy-privy-submit]", response.status, safePrivyError(payload));
      return NextResponse.json({ error: safePrivyError(payload) }, { status: response.status >= 500 ? 502 : 400, headers: noStoreHeaders() });
    }
    return NextResponse.json(payload, { headers: noStoreHeaders() });
  } catch (error) {
    return apiErrorResponse(error, "Privy could not submit this atomic batch");
  }
}

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const transactionId = Identifier.parse(new URL(request.url).searchParams.get("transactionId"));
    const credentials = privyCredentials();
    const response = await fetch(`https://api.privy.io/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString("base64")}`,
        "privy-app-id": credentials.appId,
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) return NextResponse.json({ error: safePrivyError(payload) }, { status: response.status >= 500 ? 502 : 400, headers: noStoreHeaders() });
    return NextResponse.json(payload, { headers: noStoreHeaders() });
  } catch (error) {
    return apiErrorResponse(error, "Could not check the Privy transaction");
  }
}

async function assertAllowedCalls(calls: z.infer<typeof Call>[]) {
  const state = await getRobinhoodIndexState();
  const allowed = new Set(ROBINHOOD_CONTRACTS.map((address) => address.toLowerCase()));
  collectAddresses(state, allowed);
  let totalValue = 0n;
  for (const call of calls) {
    if (!allowed.has(call.to.toLowerCase())) throw new ApiRequestError("transaction target is not part of the curated Robinhood index", 403);
    totalValue += BigInt(call.value);
  }
  if (totalValue > MAX_TOTAL_VALUE_WEI) throw new ApiRequestError("transaction value is above the launch limit", 400);
}

function collectAddresses(value: unknown, result: Set<string>, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) result.add(value.toLowerCase());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAddresses(item, result, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectAddresses(item, result, depth + 1);
  }
}

function privyCredentials() {
  const appId = process.env.PRIVY_APP_ID?.trim() || process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || DEFAULT_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appSecret) throw new ApiRequestError("Privy production signing is not configured", 503);
  return { appId, appSecret };
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || (!origin && fetchSite !== "same-origin")) {
    throw new ApiRequestError("same-origin request required", 403);
  }
}

function safePrivyError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Privy could not process the wallet request";
  const record = payload as Record<string, unknown>;
  const candidate = record.message ?? record.error;
  return typeof candidate === "string" && candidate.length <= 300 ? candidate : "Privy could not process the wallet request";
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store" };
}
