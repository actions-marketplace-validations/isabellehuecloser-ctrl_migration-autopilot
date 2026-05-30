import type { Finding, Migration, Severity } from "./types";

const FOOTER =
  "\n\n---\n🪄 Reviewed by [Migration Autopilot](https://migration.useautopilot.dev?ref=pr-footer) · Free · Prisma · Drizzle · Rails · SQL";

function severityEmoji(severity: Severity): string {
  switch (severity) {
    case "high":
      return "🔴";
    case "medium":
      return "🟡";
    case "low":
      return "🔵";
  }
}

/** Escape markdown control chars in rule-engine text that becomes link/format syntax. */
function esc(s: string): string {
  return s.replace(/[\\`*_[\]()]/g, (c) => "\\" + c);
}

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

export function renderBody(findings: Finding[], migrations: Migration[]): string {
  const fileCount = migrations.length;
  if (findings.length === 0) {
    return `🪄 **Migration Autopilot** checked ${fileCount} migration file(s) and found no unsafe operations. ✅${FOOTER}`;
  }

  const sorted = [...findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;

  const summary = [
    counts.high ? `🔴 ${counts.high} high` : "",
    counts.medium ? `🟡 ${counts.medium} medium` : "",
    counts.low ? `🔵 ${counts.low} low` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const blocks = sorted.map((f) => {
    const loc = f.line ? `\`${esc(f.file)}:${f.line}\`` : `\`${esc(f.file)}\``;
    const lines = [
      `${severityEmoji(f.severity)} **${f.severity.toUpperCase()} — ${esc(f.title)}** ${loc}`,
      esc(f.message),
    ];
    if (f.enrichment) lines.push(`> ${esc(f.enrichment)}`);
    if (f.safeRewrite) lines.push(`**Safe rewrite:** ${esc(f.safeRewrite)}`);
    lines.push(`<sub>rule: \`${f.ruleId}\`</sub>`);
    return lines.join("\n\n");
  });

  return `🪄 **Migration Autopilot** found ${findings.length} risk(s) in ${fileCount} migration file(s): ${summary}\n\n${blocks.join(
    "\n\n---\n\n"
  )}${FOOTER}`;
}

export async function postReview(
  octokit: ReturnType<typeof import("@actions/github").getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  findings: Finding[],
  migrations: Migration[]
): Promise<void> {
  const body = renderBody(findings, migrations);
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}
