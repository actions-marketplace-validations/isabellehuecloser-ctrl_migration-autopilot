import type { ChangedFile, Migration, Orm, Dialect } from "./types";
import { parseSqlStatements } from "./sql";
import { parseRailsStatements } from "./rails";

/**
 * Decide whether a changed file is a database migration and which ORM produced it.
 * Returns null for files we do not review.
 */
export function classifyMigrationFile(filename: string): Orm | null {
  const f = filename.replace(/\\/g, "/").toLowerCase();

  // Prisma: prisma/migrations/<timestamp>_name/migration.sql
  if (/(^|\/)prisma\/migrations\/.+\/migration\.sql$/.test(f)) return "prisma";

  // Drizzle: drizzle/0000_name.sql or <dir>/migrations/0000_name.sql with drizzle meta nearby
  if (/(^|\/)drizzle\/.+\.sql$/.test(f)) return "drizzle";
  if (/(^|\/)migrations\/\d{4,}_.+\.sql$/.test(f)) return "drizzle";

  // Rails / ActiveRecord: db/migrate/<timestamp>_name.rb
  if (/(^|\/)db\/migrate\/\d+_.+\.rb$/.test(f)) return "rails";

  // Generic raw SQL migrations: any *.sql under a migration-ish directory.
  if (/\.sql$/.test(f) && /(migration|migrate|schema|ddl)/.test(f)) return "sql";

  return null;
}

/** Extract only the added lines (right side of the diff) from a unified patch. */
export function extractAddedLines(patch: string): { text: string; lineForOffset: number[] } {
  const lines = patch.split("\n");
  const added: string[] = [];
  const lineForOffset: number[] = [];
  let newLine = 0;

  for (const l of lines) {
    if (l.startsWith("@@")) {
      // @@ -a,b +c,d @@  -> new file starts at c
      const m = /\+(\d+)/.exec(l);
      if (m) newLine = parseInt(m[1], 10);
      continue;
    }
    if (l.startsWith("+") && !l.startsWith("+++")) {
      added.push(l.slice(1));
      lineForOffset.push(newLine);
      newLine++;
    } else if (l.startsWith("-") && !l.startsWith("---")) {
      // removed line: does not advance new-file counter
    } else if (l.startsWith("\\")) {
      // "\ No newline at end of file"
    } else {
      // context line advances new-file counter
      newLine++;
    }
  }
  return { text: added.join("\n"), lineForOffset };
}

export function buildMigration(file: ChangedFile, orm: Orm, defaultDialect: Dialect): Migration {
  const { text } = extractAddedLines(file.patch);
  const dialect: Dialect = orm === "rails" || orm === "prisma" || orm === "drizzle"
    ? guessDialect(text, defaultDialect)
    : defaultDialect;

  const statements =
    orm === "rails"
      ? parseRailsStatements(text)
      : parseSqlStatements(text);

  return { filename: file.filename, orm, dialect, addedText: text, statements };
}

function guessDialect(text: string, fallback: Dialect): Dialect {
  const t = text.toLowerCase();
  if (/\bengine\s*=\s*innodb\b/.test(t) || /\bauto_increment\b/.test(t)) return "mysql";
  if (/\bconcurrently\b/.test(t) || /\busing\s+gin\b/.test(t) || /::/.test(t)) return "postgres";
  return fallback;
}

export async function getMigrationFiles(
  octokit: ReturnType<typeof import("@actions/github").getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  maxFiles: number,
  defaultDialect: Dialect
): Promise<Migration[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const migrations: Migration[] = [];
  for (const f of files) {
    if (f.status === "removed") continue;
    const orm = classifyMigrationFile(f.filename);
    if (!orm) continue;
    if (!f.patch) continue;
    migrations.push(
      buildMigration({ filename: f.filename, patch: f.patch, status: f.status }, orm, defaultDialect)
    );
    if (migrations.length >= maxFiles) break;
  }
  return migrations;
}
