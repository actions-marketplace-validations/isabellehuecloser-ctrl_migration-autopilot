import { describe, it, expect } from "vitest";
import { runRules, highestSeverity } from "./rules";
import { parseSqlStatements } from "./sql";
import type { Migration, Orm, Dialect } from "./types";

function mig(sql: string, orm: Orm = "sql", dialect: Dialect = "postgres"): Migration {
  return {
    filename: "migrations/0001_test.sql",
    orm,
    dialect,
    addedText: sql,
    statements: parseSqlStatements(sql),
  };
}

function ruleIds(sql: string, orm: Orm = "sql"): string[] {
  return runRules(mig(sql, orm)).map((f) => f.ruleId);
}

describe("data-loss rules (high)", () => {
  it("flags DROP COLUMN", () => {
    expect(ruleIds("ALTER TABLE users DROP COLUMN email;")).toContain("drop-column");
  });
  it("flags DROP TABLE", () => {
    expect(ruleIds("DROP TABLE users;")).toContain("drop-table");
  });
  it("flags TRUNCATE", () => {
    expect(ruleIds("TRUNCATE accounts;")).toContain("truncate");
  });
});

describe("lock rules (high)", () => {
  it("flags SET NOT NULL", () => {
    expect(ruleIds("ALTER TABLE users ALTER COLUMN phone SET NOT NULL;")).toContain("set-not-null");
  });
  it("flags ADD COLUMN NOT NULL without default", () => {
    expect(ruleIds("ALTER TABLE users ADD COLUMN age int NOT NULL;")).toContain(
      "add-column-not-null-no-default"
    );
  });
  it("flags column type change", () => {
    expect(ruleIds("ALTER TABLE users ALTER COLUMN id TYPE bigint;")).toContain("change-column-type");
  });
  it("flags CREATE INDEX without CONCURRENTLY", () => {
    expect(ruleIds("CREATE INDEX idx_users_email ON users (email);")).toContain(
      "create-index-not-concurrent"
    );
  });
  it("flags CONCURRENTLY inside a Prisma-wrapped transaction", () => {
    expect(ruleIds("CREATE INDEX CONCURRENTLY idx ON users (email);", "prisma")).toContain(
      "prisma-concurrently-in-txn"
    );
  });
});

describe("rewrite / exclusive-lock maintenance rules", () => {
  it("flags VACUUM FULL", () => {
    expect(ruleIds("VACUUM FULL users;")).toContain("vacuum-full");
  });
  it("flags CLUSTER", () => {
    expect(ruleIds("CLUSTER users USING idx_users_pkey;")).toContain("cluster");
  });
  it("flags REINDEX without CONCURRENTLY", () => {
    expect(ruleIds("REINDEX TABLE users;")).toContain("reindex-not-concurrent");
  });
  it("flags ADD COLUMN GENERATED ... STORED", () => {
    expect(
      ruleIds("ALTER TABLE users ADD COLUMN full_name text GENERATED ALWAYS AS (first || ' ' || last) STORED;")
    ).toContain("add-column-generated-stored");
  });
  it("flags ADD PRIMARY KEY", () => {
    expect(ruleIds("ALTER TABLE users ADD PRIMARY KEY (id);")).toContain("add-primary-key");
  });
});

describe("medium rules", () => {
  it("flags FK without NOT VALID", () => {
    expect(
      ruleIds("ALTER TABLE posts ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id);")
    ).toContain("add-foreign-key");
  });
  it("flags CHECK without NOT VALID", () => {
    expect(ruleIds("ALTER TABLE users ADD CONSTRAINT c CHECK (age > 0);")).toContain(
      "add-check-constraint"
    );
  });
  it("flags rename column", () => {
    expect(ruleIds("ALTER TABLE users RENAME COLUMN a TO b;")).toContain("rename-column");
  });
});

describe("SAFE migrations produce ZERO findings (no false positives)", () => {
  const safe = [
    "CREATE INDEX CONCURRENTLY idx_users_email ON users (email);",
    "ALTER TABLE users ADD COLUMN age int NOT NULL DEFAULT 0;",
    "ALTER TABLE users ADD COLUMN nickname text;",
    "ALTER TABLE posts ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID;",
    "ALTER TABLE users ADD CONSTRAINT c CHECK (age > 0) NOT VALID;",
    "ALTER TABLE users VALIDATE CONSTRAINT c;",
    "CREATE TABLE teams (id bigserial PRIMARY KEY, name text NOT NULL);",
    "INSERT INTO settings (key, value) VALUES ('x', 'y');",
    "DROP INDEX CONCURRENTLY idx_old;",
    "ALTER TABLE users ADD CONSTRAINT u UNIQUE USING INDEX idx_users_email_uniq;",
    "REINDEX INDEX CONCURRENTLY idx_users_email;",
    "ALTER TABLE users ADD PRIMARY KEY USING INDEX idx_users_pkey;",
  ];
  for (const sql of safe) {
    it(`no findings: ${sql.slice(0, 48)}`, () => {
      expect(runRules(mig(sql))).toHaveLength(0);
    });
  }
});

describe("dialect awareness", () => {
  it("does not apply Postgres index rule to mysql raw sql", () => {
    expect(ruleIds(/* mysql */ "CREATE INDEX idx ON users (email);").length).toBeGreaterThan(0);
    // mysql dialect: create-index-not-concurrent should not fire
    const f = runRules(mig("CREATE INDEX idx ON users (email);", "sql", "mysql"));
    expect(f.map((x) => x.ruleId)).not.toContain("create-index-not-concurrent");
  });
});

describe("highestSeverity", () => {
  it("returns high when a high finding exists", () => {
    const f = runRules(mig("ALTER TABLE users DROP COLUMN email; ALTER TABLE users RENAME COLUMN a TO b;"));
    expect(highestSeverity(f)).toBe("high");
  });
  it("returns none for empty", () => {
    expect(highestSeverity([])).toBe("none");
  });
});
