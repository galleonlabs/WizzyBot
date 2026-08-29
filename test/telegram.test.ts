import { describe, expect, it } from "vitest";
import {
  TELEGRAM_TOKEN_HELP,
  planTelegramReply,
  telegramBootMessage,
  telegramRequiresConfirm,
} from "../src/surfaces/telegram.js";

describe("telegram dry-path", () => {
  it("starts without a token and explains how to set one", () => {
    const msg = telegramBootMessage(undefined);
    expect(msg).toContain("TELEGRAM_BOT_TOKEN");
    expect(msg).toContain("@BotFather");
    expect(msg).toBeTruthy();
    expect(TELEGRAM_TOKEN_HELP).toMatch(/unabot telegram/);
    expect(telegramBootMessage("x:y")).toMatch(/autopilot|yes/);
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
});
