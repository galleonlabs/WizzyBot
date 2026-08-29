import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";
import { BASE_RPC_DEFAULT, TREASURY } from "../constants.js";
import { ROBINHOOD_RPC_DEFAULT, type ChainSlug } from "../chains.js";

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
  ROBINHOOD_RPC_URL: z.string().url().default(ROBINHOOD_RPC_DEFAULT),
  UNISWAP_API_KEY: z.string().optional().default(""),
  UNABOT_PRIVATE_KEY: hexKey,
  UNABOT_TREASURY: address,
  UNABOT_ETH_USD: z.coerce.number().positive().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  UNABOT_ALERT_WEBHOOK: z.string().optional().default(""),
});

export type Env = {
  rpcUrl: string;
  rpcByChain: Record<ChainSlug, string>;
  uniswapApiKey: string | undefined;
  privateKey: Hex | undefined;
  treasury: Address;
  ethUsd: number | undefined;
  telegramBotToken: string | undefined;
  alertWebhook: string | undefined;
};

const SECRET_ENV_KEYS = new Set([
  "UNABOT_PRIVATE_KEY",
  "UNISWAP_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "UNABOT_ALERT_WEBHOOK",
]);

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = mergedEnv(source);
  let parsed: z.infer<typeof EnvSchema>;
  try {
    parsed = EnvSchema.parse({
      BASE_RPC_URL: env.BASE_RPC_URL ?? BASE_RPC_DEFAULT,
      ROBINHOOD_RPC_URL: env.ROBINHOOD_RPC_URL ?? ROBINHOOD_RPC_DEFAULT,
      UNISWAP_API_KEY: env.UNISWAP_API_KEY ?? "",
      UNABOT_PRIVATE_KEY: env.UNABOT_PRIVATE_KEY || undefined,
      UNABOT_TREASURY: env.UNABOT_TREASURY || undefined,
      UNABOT_ETH_USD: env.UNABOT_ETH_USD || undefined,
      TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN ?? "",
      UNABOT_ALERT_WEBHOOK: env.UNABOT_ALERT_WEBHOOK ?? "",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const msgs = err.issues.map((i) => {
        const key = String(i.path[0] ?? "env");
        return SECRET_ENV_KEYS.has(key) ? `${key}: ${i.message}` : `${key}: ${i.message}`;
      });
      throw new Error(`Invalid env: ${msgs.join("; ")}`);
    }
    throw err;
  }
  if (parsed.UNABOT_ALERT_WEBHOOK) {
    const url = z.string().url().safeParse(parsed.UNABOT_ALERT_WEBHOOK);
    if (!url.success) throw new Error("Invalid env: UNABOT_ALERT_WEBHOOK: invalid url");
  }

  return {
    rpcUrl: parsed.BASE_RPC_URL,
    rpcByChain: { base: parsed.BASE_RPC_URL, robinhood: parsed.ROBINHOOD_RPC_URL },
    uniswapApiKey: parsed.UNISWAP_API_KEY || undefined,
    privateKey: parsed.UNABOT_PRIVATE_KEY as Hex | undefined,
    treasury: (parsed.UNABOT_TREASURY as Address | undefined) ?? TREASURY,
    ethUsd: parsed.UNABOT_ETH_USD,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN || undefined,
    alertWebhook: parsed.UNABOT_ALERT_WEBHOOK || undefined,
  };
}

export function hasWriteKey(env: Env): boolean {
  return Boolean(env.uniswapApiKey);
}
