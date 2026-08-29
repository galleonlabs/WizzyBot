import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDRESSES, TREASURY } from "../src/constants.js";
import { isPlaceholderTx, sendPlannedTx } from "../src/signer/broadcast.js";
import type { PlannedTx } from "../src/types.js";

const account = privateKeyToAccount(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);

const nfpmTx: PlannedTx = {
  to: ADDRESSES.nfpm,
  data: "0x1234",
  value: 0n,
  description: "NFPM.collect",
};

const placeholder: PlannedTx = {
  to: ADDRESSES.universalRouter,
  data: "0x",
  value: 0n,
  description: "optional swap leftover",
};

describe("broadcast safety", () => {
  it("defaults to dry-run and does not send", async () => {
    const sent = await sendPlannedTx({
      rpcUrl: "https://mainnet.base.org",
      account,
      tx: nfpmTx,
      extraAllow: [],
    });
    expect(sent.dryRun).toBe(true);
    expect("hash" in sent && sent.hash).toBeFalsy();
  });

  it("refuses empty calldata even when live", async () => {
    expect(isPlaceholderTx(placeholder)).toBe(true);
    await expect(
      sendPlannedTx({
        rpcUrl: "https://mainnet.base.org",
        account,
        tx: placeholder,
        extraAllow: [],
        live: true,
      }),
    ).rejects.toThrow(/empty calldata/);
  });

  it("refuses an off-allowlist target before any send", async () => {
    await expect(
      sendPlannedTx({
        rpcUrl: "https://mainnet.base.org",
        account,
        tx: { ...nfpmTx, to: getAddress("0x2222222222222222222222222222222222222222") },
        extraAllow: [],
        live: true,
      }),
    ).rejects.toThrow(/Refusing send/);
  });

  it("treats treasury as an allowed destination", async () => {
    const sent = await sendPlannedTx({
      rpcUrl: "https://mainnet.base.org",
      account,
      tx: { ...nfpmTx, to: TREASURY },
      extraAllow: [],
      live: false,
    });
    expect(sent.dryRun).toBe(true);
  });
});
