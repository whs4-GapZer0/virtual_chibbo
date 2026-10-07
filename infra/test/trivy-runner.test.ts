import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Runs the runner's own validation blocks.  The fixtures came from the
// scanner's pinned Trivy 0.75: a report (npm incl. a scoped and an uppercase
// legacy name, plus a Maven jar) and its `trivy convert --format cyclonedx`.
const script = readFileSync(fileURLToPath(new URL("../scripts/run-trivy-chibbo-platform.sh", import.meta.url)), "utf8");
const [reportCheck, sbomCheck] = [...script.matchAll(/<<'PY'\n([\s\S]*?)\nPY\n/g)].map((match) => match[1]);
const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const report = JSON.parse(readFileSync(fixture("trivy-report.json"), "utf8"));
const run = (code: string, ...args: string[]): { ok: boolean; output: string } => {
  try {
    execFileSync("python3", ["-", ...args], { input: code, stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, output: "" };
  } catch (error) {
    return { ok: false, output: String((error as { stderr?: Buffer }).stderr ?? "") };
  }
};

describe("platform-image Trivy runner validation", () => {
  it("has exactly the report and SBOM checks", () => {
    expect(reportCheck).toContain("does not identify the running image digest");
    expect(sbomCheck).toContain("missing application packages");
  });

  it("accepts the running digest and rejects any other artifact", () => {
    expect(run(reportCheck, fixture("trivy-report.json"), report.ArtifactName).ok).toBe(true);
    expect(run(reportCheck, fixture("trivy-report.json"), "chibbo-platform-dev:latest").ok).toBe(false);
  });

  it("matches scoped, uppercase npm and Maven packages to the converted SBOM", () => {
    expect(run(sbomCheck, fixture("trivy-report.json"), fixture("trivy-sbom.cdx.json"))).toEqual({ ok: true, output: "" });
  });

  it("rejects an SBOM missing an application package or of another image", () => {
    const dir = mkdtempSync(join(tmpdir(), "chibbo-sbom-"));
    const sbom = JSON.parse(readFileSync(fixture("trivy-sbom.cdx.json"), "utf8"));
    const missing = join(dir, "missing.json");
    writeFileSync(missing, JSON.stringify({ ...sbom, components: sbom.components.filter((component: { name: string }) => component.name !== "slf4j-api") }));
    const result = run(sbomCheck, fixture("trivy-report.json"), missing);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("org.slf4j:slf4j-api");
    const other = join(dir, "other.json");
    writeFileSync(other, JSON.stringify({ ...sbom, metadata: { ...sbom.metadata, component: { ...sbom.metadata.component, name: "other@sha256:0" } } }));
    expect(run(sbomCheck, fixture("trivy-report.json"), other).ok).toBe(false);
  });

  it("publishes the report even when the SBOM fails, then exits non-zero", () => {
    expect(script).toContain("/output/report.json || sbom_ok=0");
    expect(script).toMatch(/if \[ "\$sbom_ok" = 1 \]; then\n  for object_key in "\$SBOM_ARCHIVE_KEY"/);
    expect(script.indexOf('for object_key in "$ARCHIVE_KEY" "$LATEST_KEY"; do')).toBeGreaterThan(script.indexOf('"$SBOM_LATEST_KEY"; do'));
    expect(script).toMatch(/if \[ "\$sbom_ok" != 1 \]; then[\s\S]*exit 1/);
  });
});
