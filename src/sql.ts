import type { ParsedStatement } from "./types";

/**
 * Split raw SQL text into individual statements, tracking the new-file line where
 * each statement begins. Strips line (`--`) and block (`/* *​/`) comments and
 * ignores semicolons inside single-quoted string literals and dollar-quoted blocks.
 */
export function parseSqlStatements(text: string): ParsedStatement[] {
  const cleaned = stripComments(text);
  const statements: ParsedStatement[] = [];

  let buf = "";
  let startLine = 1;
  let line = 1;
  let inSingle = false;
  let dollarTag: string | null = null;
  let bufStartCaptured = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (ch === "\n") line++;

    // capture the line where the next non-space char of the statement starts
    if (!bufStartCaptured && !/\s/.test(ch)) {
      startLine = line;
      bufStartCaptured = true;
    }

    // dollar-quoted string handling ($$ ... $$ or $tag$ ... $tag$)
    if (!inSingle) {
      if (dollarTag) {
        if (cleaned.startsWith(dollarTag, i)) {
          buf += dollarTag;
          i += dollarTag.length - 1;
          dollarTag = null;
          continue;
        }
      } else {
        const dm = /^\$[A-Za-z0-9_]*\$/.exec(cleaned.slice(i));
        if (dm) {
          dollarTag = dm[0];
          buf += dollarTag;
          i += dollarTag.length - 1;
          continue;
        }
      }
    }

    if (dollarTag) {
      buf += ch;
      continue;
    }

    if (ch === "'") {
      // handle escaped '' inside string
      if (inSingle && cleaned[i + 1] === "'") {
        buf += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      buf += ch;
      continue;
    }

    if (ch === ";" && !inSingle) {
      pushStatement(statements, buf, startLine);
      buf = "";
      bufStartCaptured = false;
      continue;
    }

    buf += ch;
  }

  pushStatement(statements, buf, startLine);
  return statements;
}

function pushStatement(out: ParsedStatement[], raw: string, line: number): void {
  const trimmed = raw.trim();
  if (!trimmed) return;
  out.push({
    raw: trimmed,
    norm: trimmed.replace(/\s+/g, " ").toLowerCase(),
    line,
  });
}

/** Remove SQL line and block comments while preserving newlines for line counting. */
export function stripComments(text: string): string {
  let out = "";
  let inSingle = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      } else if (ch === "\n") {
        out += ch;
      }
      continue;
    }
    if (!inSingle && ch === "-" && next === "-") {
      inLine = true;
      i++;
      continue;
    }
    if (!inSingle && ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = !inSingle;
    }
    out += ch;
  }
  return out;
}
