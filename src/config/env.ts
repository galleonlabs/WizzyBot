import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";
import { BASE_RPC_DEFAULT, TREASURY } from "../constants.js";

/** Load cwd .env into a map. Never log values. process.env wins. */
export function readDotEnv(path = join(process.cwd(), ".env")): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function mergedEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const file = readDotEnv();
  return { ...file, ...source };
}

const hexKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "UNABOT_PRIVATE_KEY must be 0x + 32-byte hex")
  .optional();

const address = z
  .string()
  .refine((v) => isAddress(v), "invalid address")
  .optional();

export const EnvSchema = z.object({
  BASE_RPC_URL: z.string().url().default(BASE_RPC_DEFAULT),
  UNISWAP_API_KEY: z.string().optional().default(""),
  UNABOT_PRIVATE_KEY: hexKey,
  UNABOT_TREASURY: address,
  UNABOT_ETH_USD: z.coerce.number().positive().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
});

export type Env = {
  rpcUrl: string;
  uniswapApiKey: string | undefined;
  privateKey: Hex | undefined;
  treasury: Address;
  ethUsd: number | undefined;
  telegramBotToken: string | undefined;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = mergedEnv(source);
  const parsed = EnvSchema.parse({
    BASE_RPC_URL: env.BASE_RPC_URL ?? BASE_RPC_DEFAULT,
    UNISWAP_API_KEY: env.UNISWAP_API_KEY ?? "",
    UNABOT_PRIVATE_KEY: env.UNABOT_PRIVATE_KEY || undefined,
    UNABOT_TREASURY: env.UNABOT_TREASURY || undefined,
    UNABOT_ETH_USD: env.UNABOT_ETH_USD || undefined,
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN ?? "",
  });
  return {
    rpcUrl: parsed.BASE_RPC_URL,
    uniswapApiKey: parsed.UNISWAP_API_KEY || undefined,
    privateKey: parsed.UNABOT_PRIVATE_KEY as Hex | undefined,
    treasury: (parsed.UNABOT_TREASURY as Address | undefined) ?? TREASURY,
    ethUsd: parsed.UNABOT_ETH_USD,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN || undefined,
  };
}

export function hasWriteKey(env: Env): boolean {
  return Boolean(env.uniswapApiKey);
}
