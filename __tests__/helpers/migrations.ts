import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export interface Migration {
  file: string;
  raw: string;
  /** Comments stripped. Every guard must use this — a rule matched against
   *  commented-out SQL is a false pass, and rollback blocks are all comments. */
  sql: string;
}

/** Strip -- line comments and slash-star block comments, preserving offsets loosely. */
export function stripSqlComments(input: string): string {
  let out = "";
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inSingle = false;
  let inDollar = false;
  let dollarTag = "";

  while (i < input.length) {
    const two = input.slice(i, i + 2);

    if (inLine) {
      if (input[i] === "\n") {
        inLine = false;
        out += "\n";
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (two === "*/") {
        inBlock = false;
        i += 2;
      } else {
        if (input[i] === "\n") out += "\n";
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      out += input[i];
      if (input[i] === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDollar) {
      if (input.startsWith(dollarTag, i)) {
        out += dollarTag;
        i += dollarTag.length;
        inDollar = false;
      } else {
        out += input[i];
        i += 1;
      }
      continue;
    }

    // Not inside anything.
    const dollarMatch = /^\$[A-Za-z_]*\$/.exec(input.slice(i));
    if (dollarMatch) {
      dollarTag = dollarMatch[0];
      inDollar = true;
      out += dollarTag;
      i += dollarTag.length;
      continue;
    }
    if (two === "--") {
      inLine = true;
      i += 2;
      continue;
    }
    if (two === "/*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (input[i] === "'") {
      inSingle = true;
      out += input[i];
      i += 1;
      continue;
    }
    out += input[i];
    i += 1;
  }
  return out;
}

/** All migrations in filename (= application) order. */
export function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      return { file, raw, sql: stripSqlComments(raw) };
    });
}

/** Concatenated, comment-free SQL of every migration, in application order. */
export function allSql(): string {
  return loadMigrations()
    .map((m) => m.sql)
    .join("\n");
}

/** Extract the body of a named function from the migrations, comments stripped. */
export function functionBody(name: string): string | null {
  const sql = allSql();
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$`,
    "i",
  );
  const m = re.exec(sql);
  return m ? m[0] : null;
}
