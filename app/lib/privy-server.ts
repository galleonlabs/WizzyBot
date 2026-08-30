import "server-only";
import { PrivyClient } from "@privy-io/server-auth";
import { PRIVY_APP_ID } from "./privy-config";

export function createAppPrivyClient(): PrivyClient | null {
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appSecret) return null;
  return new PrivyClient(PRIVY_APP_ID, appSecret);
}
