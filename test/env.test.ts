import { describe, expect, it } from "vitest";
import { TREASURY } from "../src/constants.js";
import { loadEnv } from "../src/config/env.js";
import { redactKey } from "../src/signer/account.js";

describe("env + secret hygiene", () => {
  it("defaults treasury to the unlabeled product address", () => {
    const env = loadEnv({ BASE_RPC_URL: "https://mainnet.base.org" });
    expect(env.treasury).toBe(TREASURY);
    expect(env.privateKey).toBeUndefined();
  });

  it("does not leak a bad private key in the thrown error", () => {
    const leak = "0x" + "ab".repeat(31) + "zz";
    try {
      loadEnv({ UNABOT_PRIVATE_KEY: leak });
      throw new Error("expected loadEnv to throw");
    } catch (err) {
      const msg = String(err);
      expect(msg).toMatch(/UNABOT_PRIVATE_KEY/);
      expect(msg).not.toContain("abab");
      expect(msg).not.toContain(leak);
    }
  });

  it("redacts keys and never echoes them", () => {
    expect(redactKey("0x1111111111111111111111111111111111111111111111111111111111111111")).toBe(
      "<redacted>",
    );
  });
});
