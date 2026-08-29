import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { lightRowToView } from "../app/lib/cards.js";
import { deriveSolanaTreasury, mergeTransactionsWhenFits } from "../app/lib/solana-plan-utils.js";

describe("Solana self-custodial portfolio", () => {
  it("requires an explicit public Solana fee recipient", () => {
    expect(() => deriveSolanaTreasury({})).toThrow(/SOLANA_TREASURY/);
  });

  it("accepts a valid dedicated Solana treasury", () => {
    const explicit = Keypair.generate().publicKey;
    expect(deriveSolanaTreasury({ explicitAddress: explicit.toBase58() }).equals(explicit)).toBe(true);
    expect(() => deriveSolanaTreasury({ explicitAddress: "not-base58" })).toThrow();
  });

  it("normalizes a Meteora position without pretending it is a Uniswap NFT", () => {
    const pool = Keypair.generate().publicKey.toBase58();
    const position = Keypair.generate().publicKey.toBase58();
    const view = lightRowToView({
      kind: "live",
      protocol: "DLMM",
      chain: "solana",
      chainLabel: "Solana",
      venue: "meteora-dlmm",
      venueLabel: "Meteora",
      positionManager: pool,
      tokenId: position,
      marketId: "solana-fartcoin",
      pair: "FARTCOIN/SOL",
      fee: 2_000,
      tickLower: 100,
      tickUpper: 168,
      tickCurrent: 134,
      inRange: true,
      amount0: "100",
      amount1: "0.5",
      uncollected0: "1",
      uncollected1: "0.01",
    });
    expect(view).toMatchObject({
      protocol: "DLMM",
      chain: "solana",
      venue: "meteora-dlmm",
      marketId: "solana-fartcoin",
      tokenId: position,
      fullRange: false,
    });
    expect(() => new PublicKey(view!.positionManager!)).not.toThrow();
  });

  it("folds a fee into the wallet action only while the Solana transaction still fits", () => {
    const owner = Keypair.generate().publicKey;
    const target = new Transaction();
    target.feePayer = owner;
    target.recentBlockhash = Keypair.generate().publicKey.toBase58();
    target.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: Keypair.generate().publicKey, lamports: 1n }));
    const fee = new Transaction().add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: Keypair.generate().publicKey, lamports: 1n }));
    expect(mergeTransactionsWhenFits(target, fee, owner)?.instructions).toHaveLength(2);

    const oversized = new Transaction().add(new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [],
      data: Buffer.alloc(1_200),
    }));
    expect(mergeTransactionsWhenFits(target, oversized, owner)).toBeNull();
  });

  it("keeps Solana reads and writes on curated, owner-checked routes", () => {
    const server = readFileSync("app/lib/solana-position-server.ts", "utf8");
    const zapServer = readFileSync("app/lib/solana-zap-server.ts", "utf8");
    const client = readFileSync("app/portfolio-app.tsx", "utf8");
    expect(server).toContain("getPositionsByUserAndLbPair(owner)");
    expect(server).toContain("Position is not held by this Solana wallet");
    expect(server).toContain("Solana action contains an unreviewed program");
    expect(server).toContain("shouldClaimAndClose: true");
    expect(server).toContain("toPubkey: lamportRecipient");
    expect(server).not.toContain("toPubkey: treasury");
    expect(server).not.toContain('status !== "watch"');
    expect(zapServer).toContain("Solana allocation contains an unreviewed program");
    expect(zapServer).toContain("Solana allocation requests an unexpected signer");
    expect(client).toContain("/api/portfolio/solana/positions");
    expect(client).toContain("/api/portfolio/solana/action");
  });
});
