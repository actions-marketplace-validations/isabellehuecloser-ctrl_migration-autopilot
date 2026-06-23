import * as core from "@actions/core";
import * as github from "@actions/github";
import type { Dialect, Finding, Severity } from "./types";
import { getMigrationFiles } from "./diff";
import { runRules, highestSeverity } from "./rules";
import { enrichFindings } from "./enrich";
import { postReview } from "./comment";
import { checkLicense } from "./license";

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput("github-token", { required: true });
    const failOnRaw = (core.getInput("fail-on") || "high").toLowerCase();
    const dialect = ((core.getInput("dialect") || "postgres").toLowerCase() as Dialect);
    const apiKey = core.getInput("api-key");
    const model = core.getInput("model") || "gpt-4o-mini";
    const maxFiles = parseInt(core.getInput("max-files") || "50", 10);

    const context = github.context;
    if (context.eventName !== "pull_request" && context.eventName !== "pull_request_target") {
      core.info(`Skipping: event ${context.eventName} is not a pull_request.`);
      return;
    }

    const pr = context.payload.pull_request;
    if (!pr) {
      core.setFailed("No pull_request payload found.");
      return;
    }

    const { owner, repo } = context.repo;
    const octokit = github.getOctokit(githubToken);

    const license = await checkLicense({
      licenseKey: core.getInput("license-key"),
      toolName: "Migration Autopilot",
      buyUrl: "https://useautopilot.dev/#pricing",
    });
    if (!license.allow) {
      core.setFailed(license.message);
      return;
    }

    const migrations = await getMigrationFiles(octokit, owner, repo, pr.number, maxFiles, dialect);
    if (migrations.length === 0) {
      core.info("No database-migration files changed in this PR. Nothing to review.");
      core.setOutput("findings-count", "0");
      core.setOutput("highest-severity", "none");
      return;
    }

    core.info(`Checking ${migrations.length} migration file(s)...`);

    let findings: Finding[] = [];
    for (const mig of migrations) findings.push(...runRules(mig));

    if (apiKey && findings.length > 0) {
      core.info("Enriching findings with AI explanations...");
      findings = await enrichFindings(apiKey, model, findings);
    }

    await postReview(octokit, owner, repo, pr.number, findings, migrations);

    const highest = highestSeverity(findings);
    core.setOutput("findings-count", findings.length.toString());
    core.setOutput("highest-severity", highest);
    core.info(`Posted ${findings.length} finding(s). Highest severity: ${highest}.`);

    if (failOnRaw !== "never" && highest !== "none") {
      const threshold = (failOnRaw === "medium" ? "medium" : "high") as Severity;
      if (SEVERITY_RANK[highest as Severity] >= SEVERITY_RANK[threshold]) {
        core.setFailed(
          `Migration Autopilot blocked this PR: found ${highest}-severity migration risk (fail-on: ${failOnRaw}).`
        );
      }
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
