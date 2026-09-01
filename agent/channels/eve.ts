import { eveChannel } from "eve/channels/eve";
import { localDev, none, vercelOidc, type AuthFn } from "eve/channels/auth";

// Hosted agent access is operator infrastructure, not consumer wallet auth.
// Consumer actions are prepared for an external EOA and signed in the dapp.
const auth: AuthFn<Request>[] = [vercelOidc(), localDev()];
if (process.env.EVE_ALLOW_ANON === "1") auth.push(none());

export default eveChannel({ auth });
