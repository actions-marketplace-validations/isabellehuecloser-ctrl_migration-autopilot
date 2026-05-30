export type Orm = "prisma" | "drizzle" | "rails" | "sql";

export type Dialect = "postgres" | "mysql";

export type Severity = "high" | "medium" | "low";

export interface ChangedFile {
  filename: string;
  patch: string;
  status: string;
}

/** A migration extracted from a changed file, with only the ADDED content. */
export interface Migration {
  filename: string;
  orm: Orm;
  dialect: Dialect;
  /** Added lines joined, used for SQL/Rails parsing. */
  addedText: string;
  /** Map from a normalized statement back to the 1-based new-file line where it starts. */
  statements: ParsedStatement[];
}

export interface ParsedStatement {
  /** Original text of the statement (trimmed). */
  raw: string;
  /** Lowercased, whitespace-collapsed text for matching. */
  norm: string;
  /** 1-based line number in the new file where this statement begins, if known. */
  line?: number;
}

export interface Finding {
  file: string;
  line?: number;
  ruleId: string;
  severity: Severity;
  title: string;
  /** What is dangerous, in one or two sentences. */
  message: string;
  /** Suggested safe rewrite / mitigation. */
  safeRewrite?: string;
  /** Optional AI-written plain-English explanation (only when api-key is set). */
  enrichment?: string;
}
