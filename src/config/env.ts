import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";
import { BASE_RPC_DEFAULT, TREASURY } from "../constants.js";

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
});

export type Env = {
  rpcUrl: string;
  uniswapApiKey: string | undefined;
  privateKey: Hex | undefined;
  treasury: Address;
  ethUsd: number | undefined;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.parse({
    BASE_RPC_URL: source.BASE_RPC_URL ?? BASE_RPC_DEFAULT,
    UNISWAP_API_KEY: source.UNISWAP_API_KEY ?? "",
    UNABOT_PRIVATE_KEY: source.UNABOT_PRIVATE_KEY || undefined,
    UNABOT_TREASURY: source.UNABOT_TREASURY || undefined,
    UNABOT_ETH_USD: source.UNABOT_ETH_USD || undefined,
  });
  return {
    rpcUrl: parsed.BASE_RPC_URL,
    uniswapApiKey: parsed.UNISWAP_API_KEY || undefined,
    privateKey: parsed.UNABOT_PRIVATE_KEY as Hex | undefined,
    treasury: (parsed.UNABOT_TREASURY as Address | undefined) ?? TREASURY,
    ethUsd: parsed.UNABOT_ETH_USD,
  };
}

export function hasWriteKey(env: Env): boolean {
  return Boolean(env.uniswapApiKey);
}
