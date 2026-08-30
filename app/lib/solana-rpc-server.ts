import "server-only";

import { Connection } from "@solana/web3.js";

const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

let connection: Connection | undefined;

export function getSolanaConnection(): Connection {
  connection ??= new Connection(process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC, "confirmed");
  return connection;
}
