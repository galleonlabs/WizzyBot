import { describe, expect, it } from "vitest";
import { pureEthSendPolicyError } from "../app/lib/privy-call-policy.js";

const recipient = "0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42";

describe("Privy native ETH send policy", () => {
  it("allows one value-bearing native ETH transfer to a user-selected address", () => {
    expect(pureEthSendPolicyError([{ to: recipient, data: "0x", value: "0x10" }])).toBeNull();
  });

  it("rejects calldata, batching, zero-value sends, and the zero address", () => {
    expect(pureEthSendPolicyError([{ to: recipient, data: "0x1234", value: "0x10" }])?.message).toContain("cannot include contract calldata");
    expect(pureEthSendPolicyError([
      { to: recipient, data: "0x", value: "0x10" },
      { to: recipient, data: "0x", value: "0x10" },
    ])?.message).toContain("exactly one transfer");
    expect(pureEthSendPolicyError([{ to: recipient, data: "0x", value: "0x0" }])?.message).toContain("greater than zero");
    expect(pureEthSendPolicyError([{ to: "0x0000000000000000000000000000000000000000", data: "0x", value: "0x10" }])?.message).toContain("zero address");
  });
});
