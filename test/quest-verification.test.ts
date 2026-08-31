import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, zeroAddress, type Hex } from "viem";
import {
  deriveQuestObservation,
  evmWalletAddresses,
  ROBINHOOD_POSITION_MANAGER,
  verifyQuestActionReceipt,
  WIZZY_TREASURY,
  type QuestReceipt,
} from "../app/lib/quest-verification.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const STRANGER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"ab".repeat(32)}` as Hex;
const increaseEvent = parseAbiItem("event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)");
const decreaseEvent = parseAbiItem("event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)");
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const erc20TransferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

describe("authoritative quest verification", () => {
  it("derives only live curated Robinhood position and fee progress", () => {
    const result = deriveQuestObservation([{ positions: [
      { tokenId: "1", view: { tokenId: "1", pool: "0xpool-a", closed: false, feesUsd: 3.25 } },
      { tokenId: "2", view: { tokenId: "2", pool: "0xpool-b", closed: false, feesUsd: 7 } },
      { tokenId: "3", view: { tokenId: "3", pool: "0xnot-curated", closed: false, feesUsd: 999 } },
      { tokenId: "4", view: { tokenId: "4", pool: "0xpool-a", closed: true, feesUsd: 999 } },
      { tokenId: "5", view: { tokenId: "5", pool: "0xpool-a", closed: false } },
    ] }], new Set(["0xpool-a", "0xpool-b"]));
    expect(result).toEqual({
      positionCount: 3,
      marketCount: 2,
      feesUsd: 10.25,
      positions: [
        { key: "1", feesUsd: 3.25 },
        { key: "2", feesUsd: 7 },
      ],
    });
  });

  it("accepts only wallets actually linked to the authenticated Privy user", () => {
    expect(evmWalletAddresses({
      wallet: { address: OWNER, chainType: "ethereum" },
      linkedAccounts: [
        { type: "wallet", address: OWNER.toUpperCase().replace("0X", "0x"), chainType: "ethereum" },
        { type: "wallet", address: STRANGER, chainType: "solana" },
      ],
    })).toEqual([OWNER]);
  });

  it("proves a compound from a successful IncreaseLiquidity receipt owned by the user", () => {
    expect(() => verifyQuestActionReceipt({
      action: "compound",
      tokenId: "941",
      walletAddresses: [OWNER],
      receipt: receipt(OWNER, [increase(941n), payment(OWNER)]),
    })).not.toThrow();
    expect(() => verifyQuestActionReceipt({
      action: "compound",
      tokenId: "941",
      walletAddresses: [OWNER],
      receipt: receipt(STRANGER, [increase(941n), payment(STRANGER)]),
    })).toThrow(/not sent by this Privy user/);
  });

  it("proves a rebalance only when the old NFT decreases and a new NFT is minted", () => {
    expect(() => verifyQuestActionReceipt({
      action: "rebalance",
      tokenId: "941",
      walletAddresses: [OWNER],
      receipt: receipt(OWNER, [decrease(941n), transfer(zeroAddress, OWNER, 942n), increase(942n), payment(OWNER)]),
    })).not.toThrow();
    expect(() => verifyQuestActionReceipt({
      action: "rebalance",
      tokenId: "941",
      walletAddresses: [OWNER],
      receipt: receipt(OWNER, [decrease(941n), increase(941n), payment(OWNER)]),
    })).toThrow(/did not rebalance/);
  });

  it("rejects an unrelated liquidity increase that did not pay Wizzy's disclosed fee", () => {
    expect(() => verifyQuestActionReceipt({
      action: "compound",
      tokenId: "941",
      walletAddresses: [OWNER],
      receipt: receipt(OWNER, [increase(941n)]),
    })).toThrow(/disclosed fee/);
  });
});

function receipt(from: string, logs: QuestReceipt["logs"]): QuestReceipt {
  return { status: "success", from, transactionHash: HASH, logs };
}

function increase(tokenId: bigint): QuestReceipt["logs"][number] {
  return {
    address: ROBINHOOD_POSITION_MANAGER,
    topics: encodeEventTopics({ abi: [increaseEvent], eventName: "IncreaseLiquidity", args: { tokenId } }).flat().filter((topic): topic is Hex => topic !== null),
    data: encodeAbiParameters(
      [{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
      [1n, 2n, 3n],
    ),
  };
}

function decrease(tokenId: bigint): QuestReceipt["logs"][number] {
  return {
    address: ROBINHOOD_POSITION_MANAGER,
    topics: encodeEventTopics({ abi: [decreaseEvent], eventName: "DecreaseLiquidity", args: { tokenId } }).flat().filter((topic): topic is Hex => topic !== null),
    data: encodeAbiParameters(
      [{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
      [1n, 2n, 3n],
    ),
  };
}

function transfer(from: string, to: string, tokenId: bigint): QuestReceipt["logs"][number] {
  return {
    address: ROBINHOOD_POSITION_MANAGER,
    topics: encodeEventTopics({ abi: [transferEvent], eventName: "Transfer", args: { from: from as Hex, to: to as Hex, tokenId } }).flat().filter((topic): topic is Hex => topic !== null),
    data: "0x",
  };
}

function payment(from: string): QuestReceipt["logs"][number] {
  return {
    address: TOKEN,
    topics: encodeEventTopics({ abi: [erc20TransferEvent], eventName: "Transfer", args: { from: from as Hex, to: WIZZY_TREASURY } }).flat().filter((topic): topic is Hex => topic !== null),
    data: encodeAbiParameters([{ type: "uint256" }], [1n]),
  };
}
