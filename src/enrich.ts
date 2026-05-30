import OpenAI from "openai";
import type { Finding } from "./types";
import { SYSTEM_PROMPT, buildEnrichmentPrompt } from "./prompt";

/**
 * Optional: attach AI-written plain-English explanations to findings.
 * The rule engine is fully functional WITHOUT this — enrichment only runs when
 * an api-key is provided. Failures are swallowed (findings still post).
 */
export async function enrichFindings(
  apiKey: string,
  model: string,
  findings: Finding[]
): Promise<Finding[]> {
  if (findings.length === 0) return findings;
  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildEnrichmentPrompt(findings) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed: { explanations?: { ruleId: string; file: string; line?: number; text: string }[] } =
      JSON.parse(raw);
    const map = new Map<string, string>();
    for (const e of parsed.explanations ?? []) {
      map.set(`${e.ruleId}@${e.file}@${e.line ?? 0}`, e.text);
    }
    return findings.map((f) => {
      const text = map.get(`${f.ruleId}@${f.file}@${f.line ?? 0}`);
      return text ? { ...f, enrichment: text } : f;
    });
  } catch {
    return findings; // never block the review on enrichment failure
  }
}
