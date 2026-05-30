import { describe, it, expect } from "vitest";
import { parseRailsStatements } from "./rails";
import { runRules } from "./rules";
import type { Migration } from "./types";

function railsMig(ruby: string): Migration {
  return {
    filename: "db/migrate/20260101000000_test.rb",
    orm: "rails",
    dialect: "postgres",
    addedText: ruby,
    statements: parseRailsStatements(ruby),
  };
}

function ids(ruby: string): string[] {
  return runRules(railsMig(ruby)).map((f) => f.ruleId);
}

describe("Rails DSL → rules", () => {
  it("flags remove_column as drop-column", () => {
    expect(ids("remove_column :users, :email, :string")).toContain("drop-column");
  });
  it("flags change_column_null false as set-not-null", () => {
    expect(ids("change_column_null :users, :phone, false")).toContain("set-not-null");
  });
  it("flags add_index without concurrently", () => {
    expect(ids("add_index :users, :email")).toContain("create-index-not-concurrent");
  });
  it("does NOT flag add_index with concurrently", () => {
    expect(ids("add_index :users, :email, algorithm: :concurrently")).not.toContain(
      "create-index-not-concurrent"
    );
  });
  it("flags add_foreign_key without validate:false", () => {
    expect(ids("add_foreign_key :posts, :users")).toContain("add-foreign-key");
  });
  it("does NOT flag add_foreign_key with validate: false", () => {
    expect(ids("add_foreign_key :posts, :users, validate: false")).not.toContain("add-foreign-key");
  });
  it("flags rename_column", () => {
    expect(ids("rename_column :users, :a, :b")).toContain("rename-column");
  });
  it("safe add_column nullable → no findings", () => {
    expect(runRules(railsMig("add_column :users, :nickname, :string"))).toHaveLength(0);
  });
});
