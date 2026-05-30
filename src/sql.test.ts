import { describe, it, expect } from "vitest";
import { parseSqlStatements, stripComments } from "./sql";

describe("parseSqlStatements", () => {
  it("splits on semicolons", () => {
    const s = parseSqlStatements("CREATE TABLE a (id int);\nALTER TABLE a ADD COLUMN b text;");
    expect(s).toHaveLength(2);
    expect(s[0].norm).toContain("create table a");
    expect(s[1].norm).toContain("add column b");
  });

  it("ignores semicolons inside string literals", () => {
    const s = parseSqlStatements("INSERT INTO a VALUES ('x;y'); SELECT 1;");
    expect(s).toHaveLength(2);
  });

  it("ignores semicolons inside dollar-quoted blocks", () => {
    const s = parseSqlStatements("CREATE FUNCTION f() RETURNS void AS $$ BEGIN; END; $$ LANGUAGE plpgsql; SELECT 1;");
    expect(s).toHaveLength(2);
  });

  it("tracks the starting line of each statement", () => {
    const s = parseSqlStatements("\n\nALTER TABLE a DROP COLUMN b;");
    expect(s[0].line).toBe(3);
  });
});

describe("stripComments", () => {
  it("removes line comments but keeps newlines", () => {
    const out = stripComments("SELECT 1; -- a comment\nSELECT 2;");
    expect(out).not.toContain("a comment");
    expect(out.split("\n")).toHaveLength(2);
  });

  it("removes block comments", () => {
    const out = stripComments("SELECT /* inline */ 1;");
    expect(out).not.toContain("inline");
  });

  it("does not strip -- inside a string literal", () => {
    const out = stripComments("SELECT '-- not a comment';");
    expect(out).toContain("-- not a comment");
  });
});
