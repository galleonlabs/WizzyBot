import { describe, expect, it } from "vitest";
import {
  TELEGRAM_TOKEN_HELP,
  planTelegramReply,
  telegramBootMessage,
  telegramRequiresConfirm,
} from "../src/surfaces/telegram.js";
import { PRODUCT_LINE, PRODUCT_HELP, PRODUCT_VERBS } from "../src/copy.js";

describe("telegram dry-path", () => {
  it("starts without a token and explains how to set one", () => {
    const msg = telegramBootMessage(undefined);
    expect(msg).toContain("TELEGRAM_BOT_TOKEN");
    expect(msg).toContain("@BotFather");
    expect(msg).toBeTruthy();
    expect(TELEGRAM_TOKEN_HELP).toMatch(/unabot telegram/);
    expect(telegramBootMessage("x:y")).toMatch(/agent|yes/);
  });

  it("does not require confirm on dry-run writes", () => {
    expect(telegramRequiresConfirm("compound 12345", false)).toBe(false);
    expect(telegramRequiresConfirm("compound 12345", true)).toBe(true);
    expect(telegramRequiresConfirm("status 12345", true)).toBe(false);
  });

  it("previews mint and asks yes only when live", () => {
    const dry = planTelegramReply("mint WETH/USDC 0.05% width 10", false);
    expect(dry.awaitConfirm).toBe(false);
    expect(dry.text).toMatch(/dry-run mint/);
    const live = planTelegramReply("mint WETH/USDC 0.05% width 10", true);
    expect(live.awaitConfirm).toBe(true);
    expect(live.text).toMatch(/yes/i);
  });

  it("help strings use the same product copy and verbs", () => {
    const help = planTelegramReply("help", false);
    expect(help.awaitConfirm).toBe(false);
    expect(help.text).toBe(PRODUCT_HELP);
    expect(help.text).toContain(PRODUCT_LINE);
    expect(help.text).not.toMatch(/galleon/i);
    for (const verb of PRODUCT_VERBS) {
      expect(help.text).toContain(verb);
    }
    const boot = telegramBootMessage("x:y");
    expect(boot).toContain(PRODUCT_LINE);
    expect(telegramBootMessage(undefined)).toContain(PRODUCT_LINE);
  });

  it("previews range and simulate without confirm on dry-run", () => {
    const range = planTelegramReply("range 12345", false);
    expect(range.awaitConfirm).toBe(false);
    expect(range.text).toMatch(/range tokenId=12345/);
    const sim = planTelegramReply("simulate compound 12345", false);
    expect(sim.awaitConfirm).toBe(false);
    expect(sim.text).toMatch(/simulate compound/);
  });

  it("accepts --protocol v2|v3|v4 and defaults to v3", () => {
    const def = planTelegramReply("compound 12345", false);
    expect(def.awaitConfirm).toBe(false);
    expect(def.text).toMatch(/protocol=v3/);
    const v4 = planTelegramReply("compound 12345 --protocol v4", false);
    expect(v4.text).toMatch(/protocol=v4/);
    const slash = planTelegramReply("/range 12345 --protocol v2", false);
    expect(slash.text).toMatch(/range tokenId=12345/);
    expect(slash.text).toMatch(/protocol=v2/);
    const mint = planTelegramReply("mint WETH/USDC 0.05% width 10 --protocol v4", false);
    expect(mint.text).toMatch(/protocol=v4/);
    const sim = planTelegramReply("simulate exit 12345 --protocol v2", false);
    expect(sim.text).toMatch(/protocol=v2/);
    const help = planTelegramReply("help", false);
    expect(help.text).toMatch(/--protocol v2\|v3\|v4/);
  });
});
