import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { allSql, loadMigrations } from "./helpers/migrations";

/**
 * An ambiguous PostgREST embed is an ERROR, not a fallback.
 *
 * This schema deliberately carries COMPOSITE foreign keys — the ones that make
 * `activities.direction` unable to disagree with its type, and a field unable
 * to belong to another org's type. Enforcing invariants in the schema rather
 * than in code is the right trade, but it has a consequence: several table
 * pairs are now joined by more than one foreign key, and a bare
 * `.select("...parties(name)")` across such a pair cannot be resolved.
 * PostgREST answers PGRST200 rather than guessing, so any caller that
 * destructured `{ data }` without checking `error` renders a permanently empty
 * list that looks exactly like "no rows yet".
 *
 * That bug shipped twice in one afternoon, which is why this exists.
 *
 * AMBIGUITY IS PER PAIR, NOT PER TABLE. A table reached by two keys from
 * `activities` may be reached by one from `payments`, where a bare embed is
 * correct. An earlier version of this guard marked a target ambiguous globally;
 * ported to the sibling LedgerFlow repo it produced fifty findings of which
 * nearly all were false, which is how a guard gets switched off. It now
 * resolves the SOURCE table of each query — the `.from("…")` the `.select(…)`
 * hangs off — and only demands a named key where that specific pair has two.
 *
 * KNOWN LIMIT: only top-level embeds are checked. A nested embed resolves
 * against the embedded table rather than the root, and matching that reliably
 * needs a parser rather than a regex.
 */

const SOURCE_ROOTS = ["app", "features", "lib"];

/** For each source table, the targets more than one of its foreign keys reach. */
function ambiguousBySource(): Map<string, Set<string>> {
  const counts = new Map<string, Map<string, number>>();

  const tableBlocks = allSql().matchAll(
    /create\s+table\s+if\s+not\s+exists\s+public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi,
  );
  for (const [, source, body] of tableBlocks) {
    const perSource = counts.get(source) ?? new Map<string, number>();
    for (const [, target] of body.matchAll(/references\s+public\.([a-z_]+)\s*\(/gi)) {
      perSource.set(target, (perSource.get(target) ?? 0) + 1);
    }
    counts.set(source, perSource);
  }

  const out = new Map<string, Set<string>>();
  for (const [source, targets] of counts) {
    const ambiguous = new Set(
      [...targets.entries()].filter(([, n]) => n > 1).map(([t]) => t),
    );
    if (ambiguous.size > 0) out.set(source, ambiguous);
  }
  return out;
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(path)) out.push(path);
    }
  };
  for (const root of SOURCE_ROOTS) {
    try {
      walk(root);
    } catch {
      // A root that doesn't exist yet is not a failure.
    }
  }
  return out;
}

/**
 * Every `.from("x") … .select("…")` pair in a file, with its select string.
 *
 * Each `.select(` is matched to the NEAREST PRECEDING `.from(`, rather than
 * requiring the two to be adjacent. An earlier version allowed a fixed 120
 * characters between them and silently skipped every query with a comment in
 * the gap — including the one on the documents page, which is exactly the
 * query this guard was written for. It passed by finding nothing, which is the
 * failure mode the anti-vacuous assertions below now cover directly.
 */
function queries(src: string): { source: string; select: string }[] {
  const froms: { index: number; table: string }[] = [];
  for (const m of src.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)) {
    froms.push({ index: m.index!, table: m[1] });
  }

  const out: { source: string; select: string }[] = [];
  for (const m of src.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
    // The last `.from(` before this `.select(` is the table it reads.
    let source: string | null = null;
    for (const f of froms) {
      if (f.index < m.index!) source = f.table;
      else break;
    }
    if (source) out.push({ source, select: m[2] });
  }
  return out;
}

describe("PostgREST embeds", () => {
  const ambiguous = ambiguousBySource();

  it("has migrations to check (guards must never pass vacuously)", () => {
    expect(loadMigrations().length).toBeGreaterThan(0);
  });

  it("found at least one genuinely ambiguous pair", () => {
    // Anti-vacuous. If this empties, the rule below stops meaning anything
    // and should be deleted rather than left passing.
    expect(ambiguous.size).toBeGreaterThan(0);
  });

  it("found queries to check", () => {
    const total = sourceFiles().reduce((n, f) => n + queries(readFileSync(f, "utf8")).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("actually finds queries on the tables it is meant to police", () => {
    // The assertion that matters. A parsing bug that skips exactly the
    // queries worth checking leaves the rule below passing on an empty set —
    // which is how the previous version of queries() went unnoticed. Every
    // table with an ambiguous pair must be seen to be read somewhere.
    const seen = new Set<string>();
    for (const file of sourceFiles()) {
      for (const q of queries(readFileSync(file, "utf8"))) seen.add(q.source);
    }
    const unseen = [...ambiguous.keys()].filter((t) => !seen.has(t));
    expect(unseen).toEqual([]);
  });

  it("every embed of a pair reachable by two keys names the key", () => {
    const offenders: { file: string; from: string; embed: string }[] = [];

    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      for (const { source, select } of queries(src)) {
        const targets = ambiguous.get(source);
        if (!targets) continue;

        for (const target of targets) {
          // `target(` is an embed; `target!some_fkey(` is a named one.
          const bare = new RegExp(`(^|[,\\s])${target}\\s*\\(`, "g");
          if (bare.test(select) && !new RegExp(`${target}\\s*!`).test(select)) {
            offenders.push({ file, from: source, embed: `${target}(` });
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
