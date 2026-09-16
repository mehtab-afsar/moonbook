import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { allSql } from "./helpers/migrations";

/**
 * Moonbook's schema deliberately carries COMPOSITE foreign keys — the ones
 * that make `activities.direction` unable to disagree with its type, and a
 * field unable to belong to another org's type. Enforcing invariants in the
 * schema instead of in code is the right trade, but it has a consequence:
 * several table pairs are now joined by more than one foreign key, and a
 * PostgREST embed across an ambiguous pair is an ERROR, not a fallback.
 *
 * `.select("...parties(name)")` then returns `data: null` with an error, and
 * any caller that destructured `{ data }` alone renders a permanently empty
 * list that looks exactly like "no rows yet".
 *
 * That bug shipped twice in one afternoon. This guard reads the migrations,
 * works out which pairs are genuinely ambiguous, and fails if any source file
 * embeds one without naming the key.
 */

const SOURCE_ROOTS = ["app", "features", "lib"];

/** Tables that more than one foreign key reaches from the same source table. */
function ambiguousTargets(): Set<string> {
  const counts = new Map<string, number>();
  // `... references public.parties(id) ...` inside a create table block.
  const tableBlocks = allSql().matchAll(
    /create\s+table\s+if\s+not\s+exists\s+public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi,
  );
  for (const [, source, body] of tableBlocks) {
    for (const [, target] of body.matchAll(/references\s+public\.([a-z_]+)\s*\(/gi)) {
      const key = `${source}→${target}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const ambiguous = new Set<string>();
  for (const [pair, n] of counts) if (n > 1) ambiguous.add(pair.split("→")[1]);
  return ambiguous;
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

describe("PostgREST embeds", () => {
  const targets = ambiguousTargets();

  it("found the pairs that are genuinely ambiguous", () => {
    // Anti-vacuous: if this ever empties, the guard below stops meaning
    // anything and should be deleted rather than left passing.
    expect(targets.size).toBeGreaterThan(0);
  });

  it("every embed of an ambiguous table names its foreign key", () => {
    const offenders: { file: string; embed: string }[] = [];

    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      for (const target of targets) {
        // Matches `parties(` but not `parties!some_fkey(`, and only inside
        // what looks like a select string rather than ordinary code.
        const re = new RegExp(`[",\\s]${target}\\s*\\(`, "g");
        for (const m of src.matchAll(re)) {
          const before = src.slice(Math.max(0, m.index - 200), m.index + 1);
          const insideSelect = /\.select\(\s*[`"'][^`"']*$/.test(before) || /[`"'][^`"']*$/.test(before);
          if (insideSelect && !new RegExp(`${target}\\s*!`).test(src.slice(m.index, m.index + target.length + 40))) {
            offenders.push({ file, embed: `${target}(` });
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
