import { type Catalog } from "./core.ts";

export type ReleaseTag = { package: string; version: string; revision: string };
export type PackReport = {
  id: string;
  package: string;
  pinnedVersion: string;
  pinnedRevision: string;
  taggedRevision: string | undefined;
  latestVersion: string | undefined;
  latestRevision: string | undefined;
  authenticity: "ok" | "missing-tag" | "revision-mismatch";
  freshness: "current" | "behind" | "unknown";
};
const TAG = /^([0-9a-f]{40})\trefs\/tags\/(galleon-[a-z0-9-]+-skills)@(\d+\.\d+\.\d+)(\^\{\})?$/;
const SOURCE = "https://github.com/galleonlabs/crypto-defi-skills.git";
const LISTING_REF = "refs/tags/galleon-*-skills@*";

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}

export function parseTagListing(output: string): ReleaseTag[] {
  const lines = output.replace(/\r\n/g, "\n").trim().split("\n").filter(line => line.length > 0);
  if (!lines.length) throw new Error("Unable to parse upstream release tags; catalog freshness was not verified.");
  const byKey = new Map<string, { package: string; version: string; revision: string; peeled: boolean }>();
  for (const line of lines) {
    const match = line.match(TAG);
    if (!match) throw new Error("Unable to parse upstream release tags; catalog freshness was not verified.");
    const [, revision, pkg, version, peeled] = match;
    const key = `${pkg}@${version}`;
    const existing = byKey.get(key);
    if (existing) {
      if (peeled) {
        existing.revision = revision!;
        existing.peeled = true;
      } else if (existing.peeled) continue;
      else if (existing.revision !== revision) throw new Error("Unable to parse upstream release tags; catalog freshness was not verified.");
    } else byKey.set(key, { package: pkg!, version: version!, revision: revision!, peeled: Boolean(peeled) });
  }
  return [...byKey.values()].map(({ package: pkg, version, revision }) => ({ package: pkg, version, revision }));
}

export async function listUpstreamTags(run: (args: string[]) => Promise<string> = gitLsRemote): Promise<ReleaseTag[]> {
  let output: string;
  try {
    output = await run(["ls-remote", "--tags", SOURCE, LISTING_REF]);
  } catch {
    throw new Error("Unable to list upstream release tags; catalog freshness was not verified.");
  }
  return parseTagListing(output);
}

async function gitLsRemote(args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (status !== 0) throw new Error(stderr.trim() || "git ls-remote failed");
  return stdout;
}

export function evaluateCatalog(catalog: Catalog, tags: ReleaseTag[]): PackReport[] {
  const byPackage = new Map<string, ReleaseTag[]>();
  for (const tag of tags) {
    const list = byPackage.get(tag.package) ?? [];
    list.push(tag);
    byPackage.set(tag.package, list);
  }
  return catalog.packs.map(pack => {
    const packTags = byPackage.get(pack.package) ?? [];
    const matching = packTags.find(tag => tag.version === pack.version);
    const latest = packTags.slice().sort((a, b) => compareVersions(b.version, a.version))[0];
    const authenticity = !matching ? "missing-tag" : matching.revision === pack.revision ? "ok" : "revision-mismatch";
    const freshness = !latest ? "unknown" : compareVersions(latest.version, pack.version) > 0 ? "behind" : "current";
    return {
      id: pack.id,
      package: pack.package,
      pinnedVersion: pack.version,
      pinnedRevision: pack.revision,
      taggedRevision: matching?.revision,
      latestVersion: latest?.version,
      latestRevision: latest?.revision,
      authenticity,
      freshness,
    };
  });
}

export function reportCatalog(catalog: Catalog, tags: ReleaseTag[], mode: "verify" | "freshness"): { text: string; exitCode: number; failures: string[] } {
  const reports = evaluateCatalog(catalog, tags);
  const lines = reports.map(report => {
    const latest = report.latestVersion ? `${report.latestVersion} ${report.latestRevision}` : "none";
    const status = report.authenticity === "ok" ? report.freshness : report.authenticity;
    return `${report.id}: pinned ${report.pinnedVersion} ${report.pinnedRevision}; latest ${latest}; ${status}`;
  });
  const failures: string[] = [];
  for (const report of reports) {
    if (report.authenticity === "missing-tag") failures.push(`Pinned ${report.package}@${report.pinnedVersion} has no matching upstream release tag.`);
    else if (report.authenticity === "revision-mismatch") failures.push(`Pinned ${report.package}@${report.pinnedVersion} revision ${report.pinnedRevision} does not match upstream tag ${report.taggedRevision}.`);
    else if (mode === "freshness" && report.freshness === "behind") failures.push(`${report.package} is behind: pinned ${report.pinnedVersion}, latest release ${report.latestVersion} (${report.latestRevision}).`);
  }
  const summary = failures.length
    ? (mode === "verify" ? "Catalog pin(s) are not published upstream release tags." : "Catalog is behind or not a published upstream release.")
    : (mode === "verify" ? `Catalog matches published upstream release tags (${reports.length} packs).` : `Catalog matches the latest upstream release tags (${reports.length} packs).`);
  return { text: [...lines, summary, ...failures].join("\n"), exitCode: failures.length ? 1 : 0, failures };
}
