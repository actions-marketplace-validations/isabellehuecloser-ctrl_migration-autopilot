import type { ParsedStatement } from "./types";

/**
 * Translate a Rails/ActiveRecord migration (Ruby DSL) into pseudo-SQL statements
 * the SQL rule engine understands. This gives strong_migrations-style coverage
 * without a Ruby runtime. We only need enough fidelity for the rule regexes.
 */
export function parseRailsStatements(text: string): ParsedStatement[] {
  const lines = text.split("\n");
  const out: ParsedStatement[] = [];

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const t = line.trim();
    if (!t || t.startsWith("#")) return;

    const concurrently = /algorithm:\s*:concurrently/.test(t);

    const push = (sql: string) =>
      out.push({ raw: t, norm: sql.replace(/\s+/g, " ").toLowerCase().trim(), line: lineNo });

    // remove_column :users, :foo  -> drop column
    let m = /\bremove_column\b\s+:?(\w+)/.exec(t);
    if (m) return push(`alter table ${m[1]} drop column x`);

    // drop_table :users
    m = /\bdrop_table\b\s+:?(\w+)/.exec(t);
    if (m) return push(`drop table ${m[1]}`);

    // rename_column :users, :a, :b
    m = /\brename_column\b\s+:?(\w+)/.exec(t);
    if (m) return push(`alter table ${m[1]} rename column a to b`);

    // rename_table :a, :b
    m = /\brename_table\b\s+:?(\w+)/.exec(t);
    if (m) return push(`alter table ${m[1]} rename to b`);

    // change_column :users, :a, :integer  -> type change
    m = /\bchange_column\b\s+:?(\w+)/.exec(t);
    if (m && !/null:/.test(t)) return push(`alter table ${m[1]} alter column a type integer`);

    // change_column_null :users, :a, false  -> set not null
    m = /\bchange_column_null\b\s+:?(\w+)\s*,\s*:?\w+\s*,\s*false/.exec(t);
    if (m) return push(`alter table ${m[1]} alter column a set not null`);

    // add_column :users, :a, :string, null: false (no default) -> not null add
    m = /\badd_column\b\s+:?(\w+)/.exec(t);
    if (m) {
      const notNull = /null:\s*false/.test(t);
      const hasDefault = /default:/.test(t);
      const def = hasDefault ? " default 'x'" : "";
      const nn = notNull ? " not null" : "";
      return push(`alter table ${m[1]} add column a text${def}${nn}`);
    }

    // add_index :users, :a  (concurrently?)
    m = /\badd_index\b\s+:?(\w+)/.exec(t);
    if (m) {
      const unique = /unique:\s*true/.test(t);
      const c = concurrently ? " concurrently" : "";
      return push(`create ${unique ? "unique " : ""}index${c} idx on ${m[1]} (a)`);
    }

    // remove_index :users, ...
    m = /\bremove_index\b\s+:?(\w+)/.exec(t);
    if (m) {
      const c = concurrently ? " concurrently" : "";
      return push(`drop index${c} idx`);
    }

    // add_foreign_key :posts, :users  (validate: false?)
    m = /\badd_foreign_key\b\s+:?(\w+)/.exec(t);
    if (m) {
      const notValid = /validate:\s*false/.test(t) ? " not valid" : "";
      return push(`alter table ${m[1]} add constraint fk foreign key (x) references y${notValid}`);
    }

    // add_check_constraint :users, "...", validate: false?
    m = /\badd_check_constraint\b\s+:?(\w+)/.exec(t);
    if (m) {
      const notValid = /validate:\s*false/.test(t) ? " not valid" : "";
      return push(`alter table ${m[1]} add constraint chk check (x)${notValid}`);
    }
  });

  return out;
}
