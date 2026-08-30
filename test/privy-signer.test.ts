import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIVY_APP_ID,
  PRIVY_STUB_MESSAGE,
  createPrivyClient,
  loadPrivyEnv,
  privyConfigured,
  requirePrivyClient,
} from "../src/signer/privy.js";
import { assertWriteAllowed } from "../src/surfaces/hosted.js";

const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

describe("Privy hosted signer", () => {
  it("defaults the public app id and stays stubbed without a secret", () => {
    const env = loadPrivyEnv({});
    expect(DEFAULT_PRIVY_APP_ID).toBe("cmtft1kti01cf0dl73c3zpuem");
    expect(env.appId).toBe(DEFAULT_PRIVY_APP_ID);
    expect(privyConfigured(env)).toBe(false);
    expect(createPrivyClient(env)).toBeNull();
    expect(() => requirePrivyClient(env)).toThrow(PRIVY_STUB_MESSAGE);
  });

  it("reads app id from either public or server env names", () => {
    expect(loadPrivyEnv({ NEXT_PUBLIC_PRIVY_APP_ID: "app_public" }).appId).toBe("app_public");
    expect(loadPrivyEnv({ PRIVY_APP_ID: "app_server" }).appId).toBe("app_server");
  });

  it("keeps developer setup on the one paid Privy app", () => {
    expect(envExample).toContain(`PRIVY_APP_ID=${DEFAULT_PRIVY_APP_ID}`);
    expect(envExample).toContain(`NEXT_PUBLIC_PRIVY_APP_ID=${DEFAULT_PRIVY_APP_ID}`);
  });
});

describe("hosted write gate", () => {
  it("defaults to dry-run and requires confirm before live", () => {
    expect(assertWriteAllowed({})).toBe(false);
    expect(assertWriteAllowed({ live: false })).toBe(false);
    expect(() => assertWriteAllowed({ live: true })).toThrow(/confirm=true/);
    expect(assertWriteAllowed({ live: true, confirm: true })).toBe(true);
  });
});
