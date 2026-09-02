import type { Address } from "viem";
import { loadEnv } from "../config/env.js";

/** Basis points Wizzy adds to every Relay quote it prepares. Paid to the treasury by Relay. */
export const WIZZY_APP_FEE_BPS = 30;

export function appFeeRecipient(): Address {
  return loadEnv().treasury;
}

export function appFeeBps(): number {
  const raw = process.env.WIZZY_APP_FEE_BPS?.trim();
  if (!raw) return WIZZY_APP_FEE_BPS;
  const override = Number(raw);
  return Number.isInteger(override) && override >= 0 && override <= 500 ? override : WIZZY_APP_FEE_BPS;
}
