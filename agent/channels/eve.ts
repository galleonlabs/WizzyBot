import { eveChannel } from "eve/channels/eve";
import { localDev, none, vercelOidc, type AuthFn } from "eve/channels/auth";
import { createPrivyClient } from "../../src/signer/privy.js";

function privyAuth(): AuthFn<Request> {
  return async (request) => {
    const header = request.headers.get("authorization");
    if (!header?.toLowerCase().startsWith("bearer ")) return null;
    const token = header.slice(7).trim();
    if (!token) return null;
    const client = createPrivyClient();
    if (!client) return null;
    try {
      const claims = await client.verifyAuthToken(token);
      return {
        authenticator: "privy",
        principalId: claims.userId,
        principalType: "user",
        issuer: "privy",
        attributes: {},
      };
    } catch {
      return null;
    }
  };
}

const auth: AuthFn<Request>[] = [privyAuth(), vercelOidc(), localDev()];
if (process.env.EVE_ALLOW_ANON === "1") auth.push(none());

export default eveChannel({ auth });
