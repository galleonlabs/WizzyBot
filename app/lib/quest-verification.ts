import { decodeEventLog, getAddress, isAddress, zeroAddress, type Hex } from "viem";
import type { AchievementAction } from "./achievements.js";

export const ROBINHOOD_POSITION_MANAGER = getAddress("0x73991a25c818bf1f1128deaab1492d45638de0d3");
export const WIZZY_TREASURY = getAddress("0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42");

const positionManagerEvents = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "IncreaseLiquidity",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DecreaseLiquidity",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
  },
] as const;

const erc20TransferEvent = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

export type QuestReceipt = {
  status: "success" | "reverted";
  from: string;
  transactionHash: Hex;
  logs: readonly {
    address: string;
    data: Hex;
    topics: readonly Hex[];
  }[];
};

export function verifyQuestActionReceipt(input: {
  action: AchievementAction;
  tokenId: string;
  walletAddresses: readonly string[];
  receipt: QuestReceipt;
}): { positionTokenId: string } {
  if (input.receipt.status !== "success") throw new Error("quest transaction reverted");
  if (!isAddress(input.receipt.from) || !input.walletAddresses.some((address) => sameAddress(address, input.receipt.from))) {
    throw new Error("quest transaction was not sent by this Privy user");
  }
  const expectedTokenId = BigInt(input.tokenId);
  const events = input.receipt.logs.flatMap((log) => {
    if (!sameAddress(log.address, ROBINHOOD_POSITION_MANAGER)) return [];
    try {
      return [decodeEventLog({ abi: positionManagerEvents, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] })];
    } catch {
      return [];
    }
  });
  const increases = events.filter((event) => event.eventName === "IncreaseLiquidity");
  const decreases = events.filter((event) => event.eventName === "DecreaseLiquidity");
  const transfers = events.filter((event) => event.eventName === "Transfer");
  const increasedExpected = increases.some((event) => event.args.tokenId === expectedTokenId);
  const paidWizzy = input.receipt.logs.some((log) => {
    if (sameAddress(log.address, ROBINHOOD_POSITION_MANAGER)) return false;
    try {
      const event = decodeEventLog({ abi: erc20TransferEvent, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] });
      return event.eventName === "Transfer" && event.args.value > 0n &&
        sameAddress(event.args.to, WIZZY_TREASURY) &&
        input.walletAddresses.some((address) => sameAddress(address, event.args.from));
    } catch {
      return false;
    }
  });
  if (!paidWizzy) throw new Error("transaction did not include Wizzy's disclosed fee");

  if (input.action === "compound") {
    if (!increasedExpected || decreases.some((event) => event.args.tokenId === expectedTokenId)) {
      throw new Error("transaction did not compound the claimed position");
    }
    return { positionTokenId: input.tokenId };
  }

  const decreasedExpected = decreases.some((event) => event.args.tokenId === expectedTokenId);
  const mintedToOwner = transfers.find((event) => (
    sameAddress(event.args.from, zeroAddress) &&
    input.walletAddresses.some((address) => sameAddress(address, event.args.to)) &&
    event.args.tokenId !== expectedTokenId &&
    increases.some((increase) => increase.args.tokenId === event.args.tokenId)
  ));
  if (!decreasedExpected || !mintedToOwner) throw new Error("transaction did not rebalance the claimed position");
  return { positionTokenId: mintedToOwner.args.tokenId.toString() };
}

export function evmWalletAddresses(user: unknown): `0x${string}`[] {
  if (!user || typeof user !== "object" || Array.isArray(user)) return [];
  const source = user as Record<string, unknown>;
  const candidates: unknown[] = [source.wallet, source.smartWallet];
  if (Array.isArray(source.linkedAccounts)) candidates.push(...source.linkedAccounts);
  const addresses = new Map<string, `0x${string}`>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const account = candidate as Record<string, unknown>;
    if (account.chainType !== undefined && account.chainType !== "ethereum") continue;
    if (typeof account.address !== "string" || !isAddress(account.address)) continue;
    const address = getAddress(account.address);
    addresses.set(address.toLowerCase(), address);
  }
  return [...addresses.values()];
}

export function deriveQuestObservation(
  payloads: readonly unknown[],
  activePools: ReadonlySet<string>,
): { positionCount: number; marketCount: number; feesUsd: number; positions: Array<{ key: string; feesUsd: number }> } {
  const positions = new Map<string, { pool: string; feesUsd?: number }>();
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const rows = (payload as Record<string, unknown>).positions;
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const view = row.view && typeof row.view === "object" && !Array.isArray(row.view)
        ? row.view as Record<string, unknown>
        : row;
      if (view.closed === true || row.closed === true) continue;
      const pool = typeof view.pool === "string" ? view.pool.toLowerCase() : typeof row.pool === "string" ? row.pool.toLowerCase() : "";
      const tokenId = typeof view.tokenId === "string" ? view.tokenId : row.tokenId == null ? "" : String(row.tokenId);
      if (!activePools.has(pool) || !/^\d+$/.test(tokenId)) continue;
      const feesUsd = finiteAmount(view.feesUsd ?? row.feesUsd);
      positions.set(tokenId, { pool, ...(feesUsd === undefined ? {} : { feesUsd }) });
    }
  }
  return {
    positionCount: positions.size,
    marketCount: new Set([...positions.values()].map((position) => position.pool)).size,
    feesUsd: [...positions.values()].reduce((total, position) => total + (position.feesUsd ?? 0), 0),
    positions: [...positions.entries()].flatMap(([key, position]) => position.feesUsd === undefined ? [] : [{ key, feesUsd: position.feesUsd }]),
  };
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function finiteAmount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
