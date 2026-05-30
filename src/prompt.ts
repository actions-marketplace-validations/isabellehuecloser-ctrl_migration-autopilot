import type { Finding } from "./types";

export const SYSTEM_PROMPT = `You are Migration Autopilot, a database-migration safety expert (DBA-grade). A deterministic rule engine has already detected potentially unsafe migration statements. Your ONLY job is to write a short, plain-English explanation for each finding so the developer understands the risk and the fix.

Rules:
- Do NOT invent new issues. Only explain the findings you are given.
- Keep each explanation to 1-2 sentences. Concrete, no fluff, no praise.
- Reference the specific lock/data-loss/runtime risk and why it matters in production.
- If a safe rewrite is provided, restate it briefly in your own words.
- Output strict JSON: {"explanations": [{"ruleId": "...", "file": "...", "line": N, "text": "..."}]}.`;

export function buildEnrichmentPrompt(findings: Finding[]): string {
  const items = findings.map((f) => ({
    ruleId: f.ruleId,
    file: f.file,
    line: f.line,
    title: f.title,
    message: f.message,
    safeRewrite: f.safeRewrite,
  }));
  return `Write a plain-English explanation for each of these migration findings:\n\n${JSON.stringify(
    items,
    null,
    2
  )}`;
}
