import { describe, expect, it } from "vitest";
import { sendValidationError } from "../app/lib/send-eth.js";

const owner = "0xB599704A030b4e4e6A54749eEaDE8cACD4600c5B";
const recipient = "0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42";

describe("Send ETH form validation", () => {
  it("accepts a funded Robinhood transfer to another valid address", () => {
    expect(sendValidationError({ owner, recipient, amountWei: 20n, balanceWei: "20" })).toBeNull();
  });

  it("blocks invalid recipients, self-sends, empty balances, and overspending", () => {
    expect(sendValidationError({ owner, recipient: "0xnope", amountWei: 1n, balanceWei: "20" })).toBe("Enter a valid recipient address.");
    expect(sendValidationError({ owner, recipient: owner.toLowerCase(), amountWei: 1n, balanceWei: "20" })).toBe("Choose an address other than this Wizzy wallet.");
    expect(sendValidationError({ owner, recipient, amountWei: 0n, balanceWei: "20" })).toBe("Enter an ETH amount greater than zero.");
    expect(sendValidationError({ owner, recipient, amountWei: 21n, balanceWei: "20" })).toBe("This amount is above your available balance.");
  });
});
