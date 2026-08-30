import { encodeRegistryPublish, initialRobinhoodRegistryMarkets } from "../src/index/publish.js";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.split("=");
  return [key, rest.join("=")];
}));
const evidenceHash = args.get("--evidence-hash") as `0x${string}` | undefined;
if (!evidenceHash) throw new Error("Use --evidence-hash=0x... with the curator report bytes32 hash");
const expectedVersion = BigInt(args.get("--expected-version") ?? "0");
const evidenceURI = args.get("--evidence-uri") ?? "";
const markets = initialRobinhoodRegistryMarkets();
const data = encodeRegistryPublish({ expectedVersion, evidenceHash, evidenceURI, markets });

process.stdout.write(`${JSON.stringify({ expectedVersion: expectedVersion.toString(), evidenceHash, evidenceURI, markets, data }, null, 2)}\n`);

