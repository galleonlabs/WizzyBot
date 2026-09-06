import catalogFile from "../catalog/skills.json";
import { parseCatalog } from "../src/core.ts";
import { listUpstreamTags, reportCatalog } from "../src/catalog-freshness.ts";

const args = process.argv.slice(2);
try {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--verify")) throw new Error("Usage: bun scripts/catalog-freshness.ts [--verify]");
  const mode = args[0] === "--verify" ? "verify" : "freshness";
  const result = reportCatalog(parseCatalog(catalogFile), await listUpstreamTags(), mode);
  console.log(result.text);
  process.exit(result.exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
