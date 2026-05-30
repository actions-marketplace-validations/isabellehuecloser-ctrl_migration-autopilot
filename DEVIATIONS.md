# DEVIATIONS.md — migration-autopilot

Per the founder principle (DEFAULT vs DÉCIDÉ): the svelte/i18n playbook default is "LLM reads the diff
and returns findings." Document every deviation here; revisit in 3 months and revert if it didn't pay.

## Deviation 1 — Deterministic rule engine first, LLM optional

**Default:** the Action calls OpenAI on every run (api-key required), the model produces the findings.

**Decision:** migration-autopilot detects with a deterministic rule corpus; the OpenAI key is **optional**
and only enriches findings with plain-English text.

**Why:**
- Migration footguns are deterministically detectable (parse SQL/DSL, apply DBA lock/data-loss rules).
  An LLM here adds hallucination risk and false positives — fatal for a *merge-gating* tool.
- Zero-API-key = zero marginal cost on the free tier and a lower install barrier (no secret to set).
- Unit economics: OpenAI cost per Pro user drops to ~$0.10-1.00/mo (enrichment only), the cheapest
  token profile of the candidate products (see discovery/RESEARCH-2026-05-30.md §6).
- The moat becomes the *rule corpus* (hard to copy, grounded in real incidents), not a prompt.

**Revisit:** if users ask for nuance the rules can't express (e.g. "is this lock actually a problem for
*my* table size?"), add an LLM "deep analysis" mode as a Pro feature — without making the free tier
depend on a key.

## Deviation 2 — `fail-on` merge gate built into the free Action

**Default:** the Action posts a comment; gating is a Pro/hosted concern.

**Decision:** the free Action can fail the check (`fail-on: high|medium|never`) so teams can require it
as a branch-protection gate from day one.

**Why:** the core value is *blocking* a bad migration, not just commenting. Gating in the free tier
drives the "install on the whole org" behavior that creates the Aïcha (platform-eng) persona's pull.
Pro differentiates on dashboard/history/multi-repo policy, not on the gate itself.

**Revisit:** if free-tier gating cannibalizes Pro conversion, move org-wide policy controls to Pro while
keeping single-repo gating free.
