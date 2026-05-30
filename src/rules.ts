import type { Migration, ParsedStatement, Finding, Severity, Dialect } from "./types";

interface RuleContext {
  dialect: Dialect;
  orm: Migration["orm"];
}

interface Rule {
  id: string;
  /** Returns a partial finding when the statement is dangerous, else null. */
  test: (s: ParsedStatement, ctx: RuleContext) => Omit<Finding, "file" | "line" | "ruleId"> | null;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

export function highestSeverity(findings: Finding[]): Severity | "none" {
  let best: Severity | "none" = "none";
  for (const f of findings) {
    if (best === "none" || SEVERITY_RANK[f.severity] > SEVERITY_RANK[best]) best = f.severity;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const isAlterTable = (n: string) => /^alter table /.test(n);
const hasNotValid = (n: string) => /\bnot valid\b/.test(n);
const hasConcurrently = (n: string) => /\bconcurrently\b/.test(n);
const hasIfExists = (n: string) => /\bif exists\b/.test(n);
const onTempTable = (n: string) => /\b(temp|temporary)\b/.test(n);

/* ------------------------------------------------------------------ *
 * The rule corpus — derived from real production-incident footguns
 * (Squawk, ankane/strong_migrations, Atlas PG301-311, and the
 *  postmortems cited in discovery/RESEARCH-2026-05-30.md).
 * ------------------------------------------------------------------ */

const RULES: Rule[] = [
  // ---- DATA LOSS (high) ----
  {
    id: "drop-column",
    test: (s) =>
      isAlterTable(s.norm) && /\bdrop column\b/.test(s.norm)
        ? {
            severity: "high",
            title: "Dropping a column deletes data",
            message:
              "DROP COLUMN permanently deletes the column's data and breaks any running app version that still reads or writes it during deploy.",
            safeRewrite:
              "Deploy in two steps: first stop using the column in code and ship, then drop it in a later migration. Consider renaming to `*_deprecated` first.",
          }
        : null,
  },
  {
    id: "drop-table",
    test: (s) =>
      /^drop table /.test(s.norm) && !onTempTable(s.norm)
        ? {
            severity: "high",
            title: "Dropping a table deletes data",
            message:
              "DROP TABLE permanently deletes all rows. If anything still references it, queries fail at runtime.",
            safeRewrite:
              "Confirm no code references the table, take a backup, and drop it in a dedicated migration after a safe interval.",
          }
        : null,
  },
  {
    id: "truncate",
    test: (s) =>
      /^truncate\b/.test(s.norm) && !onTempTable(s.norm)
        ? {
            severity: "high",
            title: "TRUNCATE deletes all rows",
            message: "TRUNCATE removes every row in the table and cannot be rolled back once committed.",
            safeRewrite: "If this is intentional cleanup, gate it behind an explicit, reviewed data migration — not a schema migration.",
          }
        : null,
  },

  // ---- LOCKS THAT FREEZE PRODUCTION (high) ----
  {
    id: "set-not-null",
    test: (s) =>
      isAlterTable(s.norm) && /\bset not null\b/.test(s.norm)
        ? {
            severity: "high",
            title: "SET NOT NULL locks the whole table",
            message:
              "ALTER COLUMN ... SET NOT NULL takes an ACCESS EXCLUSIVE lock and scans every row to validate. On a large, busy table this freezes reads and writes — a classic source of multi-minute outages.",
            safeRewrite:
              "Add a `CHECK (col IS NOT NULL) NOT VALID` constraint, run `VALIDATE CONSTRAINT` in a separate migration (no exclusive lock), then optionally swap to a true NOT NULL.",
          }
        : null,
  },
  {
    id: "add-column-not-null-no-default",
    test: (s) => {
      if (!/^alter table .*\badd column\b/.test(s.norm)) return null;
      if (!/\bnot null\b/.test(s.norm)) return null;
      if (/\bdefault\b/.test(s.norm)) return null; // constant default is safe on modern PG
      return {
        severity: "high",
        title: "Adding a NOT NULL column without a default",
        message:
          "ADD COLUMN ... NOT NULL with no DEFAULT fails immediately on any table that already has rows, and blocks the deploy.",
        safeRewrite:
          "Add the column as nullable (or with a constant DEFAULT), backfill in batches, then add the NOT NULL constraint via a `NOT VALID` check + `VALIDATE CONSTRAINT`.",
      };
    },
  },
  {
    id: "change-column-type",
    test: (s) =>
      isAlterTable(s.norm) && /\balter column\b.*\b(type|set data type)\b/.test(s.norm)
        ? {
            severity: "high",
            title: "Changing a column type rewrites the table",
            message:
              "ALTER COLUMN ... TYPE rewrites the entire table under an ACCESS EXCLUSIVE lock, blocking all reads and writes for the duration on a large table.",
            safeRewrite:
              "Add a new column of the target type, backfill in batches, switch reads/writes in code, then drop the old column in a later migration.",
          }
        : null,
  },
  {
    id: "create-index-not-concurrent",
    test: (s, ctx) => {
      if (ctx.dialect !== "postgres") return null;
      if (!/^create (unique )?index\b/.test(s.norm)) return null;
      if (hasConcurrently(s.norm)) return null;
      return {
        severity: "high",
        title: "Building an index without CONCURRENTLY blocks writes",
        message:
          "CREATE INDEX (without CONCURRENTLY) takes a lock that blocks writes to the table until the index finishes building — minutes of write downtime on a large table.",
        safeRewrite: "Use `CREATE INDEX CONCURRENTLY`. Note it cannot run inside a transaction (see prisma-concurrently-in-txn).",
      };
    },
  },
  {
    id: "prisma-concurrently-in-txn",
    test: (s, ctx) => {
      // Prisma and Drizzle wrap each migration file in a single transaction by default.
      // CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction → migration errors out.
      if (ctx.orm !== "prisma" && ctx.orm !== "drizzle") return null;
      if (!hasConcurrently(s.norm)) return null;
      return {
        severity: "high",
        title: "CONCURRENTLY cannot run inside a wrapped transaction",
        message:
          `${ctx.orm === "prisma" ? "Prisma" : "Drizzle"} runs each migration file inside a transaction by default, but CREATE/DROP INDEX CONCURRENTLY is not allowed in a transaction block — this migration will fail at apply time.`,
        safeRewrite:
          ctx.orm === "prisma"
            ? "Put the CONCURRENTLY statement in its own migration and disable the transaction (e.g. `-- @prisma migrate: no-transaction` / run it as a separate non-transactional step)."
            : "Isolate the CONCURRENTLY statement in its own non-transactional migration step.",
      };
    },
  },

  // ---- LOCKS / BREAKAGE (medium) ----
  {
    id: "add-foreign-key",
    test: (s) => {
      if (!isAlterTable(s.norm)) return null;
      if (!/\badd constraint\b.*\bforeign key\b/.test(s.norm) && !/\badd foreign key\b/.test(s.norm)) return null;
      if (hasNotValid(s.norm)) return null;
      return {
        severity: "medium",
        title: "Adding a foreign key locks both tables",
        message:
          "Adding a FOREIGN KEY validates existing rows under a lock on both the referencing and referenced tables, which can stall writes on busy tables.",
        safeRewrite:
          "Add the constraint with `NOT VALID` first (cheap, no full scan), then `VALIDATE CONSTRAINT` in a separate migration.",
      };
    },
  },
  {
    id: "add-check-constraint",
    test: (s) => {
      if (!isAlterTable(s.norm)) return null;
      if (!/\badd constraint\b.*\bcheck\b/.test(s.norm) && !/\badd check\b/.test(s.norm)) return null;
      if (hasNotValid(s.norm)) return null;
      return {
        severity: "medium",
        title: "Adding a CHECK constraint scans the whole table",
        message:
          "ADD CONSTRAINT ... CHECK validates every existing row under a lock. On a large table this blocks writes for the scan duration.",
        safeRewrite: "Add the CHECK with `NOT VALID`, then `VALIDATE CONSTRAINT` in a later migration.",
      };
    },
  },
  {
    id: "add-unique-constraint",
    test: (s, ctx) => {
      if (ctx.dialect !== "postgres") return null;
      if (!isAlterTable(s.norm)) return null;
      if (!/\badd constraint\b.*\bunique\b/.test(s.norm)) return null;
      if (/\busing index\b/.test(s.norm)) return null; // safe path
      return {
        severity: "medium",
        title: "Adding a UNIQUE constraint builds an index under a lock",
        message:
          "ADD CONSTRAINT ... UNIQUE builds a unique index while holding a lock that blocks writes, rather than using a concurrently-built index.",
        safeRewrite:
          "Build the index first with `CREATE UNIQUE INDEX CONCURRENTLY`, then `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX`.",
      };
    },
  },
  {
    id: "rename-column",
    test: (s) =>
      isAlterTable(s.norm) && /\brename column\b/.test(s.norm)
        ? {
            severity: "medium",
            title: "Renaming a column breaks the running app",
            message:
              "RENAME COLUMN takes effect instantly, but the currently-deployed app code still references the old name and will error until the new version is live.",
            safeRewrite:
              "Add the new column, dual-write in code, backfill, switch reads, then drop the old column — instead of an in-place rename.",
          }
        : null,
  },
  {
    id: "rename-table",
    test: (s) =>
      /^alter table .*\brename to\b/.test(s.norm)
        ? {
            severity: "medium",
            title: "Renaming a table breaks the running app",
            message:
              "RENAME TO changes the table name instantly while the deployed app still queries the old name, causing runtime errors mid-deploy.",
            safeRewrite: "Create a view with the old name, or use the expand/contract pattern instead of an in-place rename.",
          }
        : null,
  },
  {
    id: "drop-index-not-concurrent",
    test: (s, ctx) => {
      if (ctx.dialect !== "postgres") return null;
      if (!/^drop index\b/.test(s.norm)) return null;
      if (hasConcurrently(s.norm)) return null;
      if (hasIfExists(s.norm) && /concurrently/.test(s.norm)) return null;
      return {
        severity: "low",
        title: "Dropping an index without CONCURRENTLY takes a lock",
        message:
          "DROP INDEX takes an exclusive lock on the table for the duration. It is usually fast, but on a hot table it can briefly block queries.",
        safeRewrite: "Use `DROP INDEX CONCURRENTLY` to avoid blocking.",
      };
    },
  },
  {
    id: "add-column-volatile-default",
    test: (s, ctx) => {
      if (ctx.dialect !== "postgres") return null;
      if (!/^alter table .*\badd column\b/.test(s.norm)) return null;
      if (!/\bdefault\b/.test(s.norm)) return null;
      if (!/\bdefault\s+(now\(\)|current_timestamp|random\(\)|gen_random_uuid\(\)|uuid_generate_v\d\(\)|clock_timestamp\(\))/.test(s.norm))
        return null;
      return {
        severity: "low",
        title: "Adding a column with a volatile default rewrites the table",
        message:
          "A constant DEFAULT is cheap on modern Postgres, but a volatile default (now(), random(), uuid generators) forces a full table rewrite under a lock.",
        safeRewrite: "Add the column with no default, backfill the computed value in batches, then set the default for new rows.",
      };
    },
  },
];

/** Run the full deterministic rule set over a migration. */
export function runRules(mig: Migration): Finding[] {
  const ctx: RuleContext = { dialect: mig.dialect, orm: mig.orm };
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const s of mig.statements) {
    for (const rule of RULES) {
      const hit = rule.test(s, ctx);
      if (!hit) continue;
      const key = `${rule.id}@${s.line ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        file: mig.filename,
        line: s.line,
        ruleId: rule.id,
        ...hit,
      });
    }
  }
  return findings;
}

export const ALL_RULE_IDS = RULES.map((r) => r.id);
