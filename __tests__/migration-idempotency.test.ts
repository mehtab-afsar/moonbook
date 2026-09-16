import { loadMigrations } from "./helpers/migrations";

/**
 * `npm run db:reset` replays every migration from scratch, and a migration
 * that isn't safely re-runnable turns a reset into a debugging session.
 *
 * Postgres has no `IF NOT EXISTS` for policies, triggers, or ADD CONSTRAINT —
 * the first two are handled by a `drop ... if exists` immediately before, the
 * third by wrapping in a `do $$ ... pg_constraint ... $$` block.
 */
describe("migration idempotency", () => {
  const migrations = loadMigrations();

  it("has migrations to check (guards must never pass vacuously)", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it("every create table/index/schema carries IF NOT EXISTS", () => {
    const offenders: { file: string; stmt: string }[] = [];
    for (const m of migrations) {
      const creates = m.sql.matchAll(
        /create\s+(?:unique\s+)?(?:table|index|schema)\s+(?!if\s+not\s+exists)([a-z_."]+)/gi,
      );
      for (const c of creates) offenders.push({ file: m.file, stmt: c[0].trim() });
    }
    expect(offenders).toEqual([]);
  });

  it("every CREATE POLICY has a matching DROP POLICY IF EXISTS in the same file", () => {
    const offenders: { file: string; policy: string }[] = [];
    for (const m of migrations) {
      const created = new Set(
        [...m.sql.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+([a-z_.]+)/gi)].map(
          (x) => `${x[2]}.${x[1]}`,
        ),
      );
      const dropped = new Set(
        [...m.sql.matchAll(/drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+([a-z_.]+)/gi)].map(
          (x) => `${x[2]}.${x[1]}`,
        ),
      );
      for (const p of created) if (!dropped.has(p)) offenders.push({ file: m.file, policy: p });
    }
    expect(offenders).toEqual([]);
  });

  it("every CREATE TRIGGER has a matching DROP TRIGGER IF EXISTS in the same file", () => {
    const offenders: { file: string; trigger: string }[] = [];
    for (const m of migrations) {
      const created = new Set(
        [...m.sql.matchAll(/create\s+trigger\s+([a-z_]+)\s+/gi)].map((x) => x[1]),
      );
      const dropped = new Set(
        [...m.sql.matchAll(/drop\s+trigger\s+if\s+exists\s+([a-z_]+)\s+/gi)].map((x) => x[1]),
      );
      for (const t of created) if (!dropped.has(t)) offenders.push({ file: m.file, trigger: t });
    }
    expect(offenders).toEqual([]);
  });

  it("every ALTER TABLE ... ADD CONSTRAINT is guarded by a pg_constraint check", () => {
    const offenders: { file: string; stmt: string; guarded: boolean }[] = [];
    for (const m of migrations) {
      for (const match of m.sql.matchAll(/alter\s+table\s+[^;]*?add\s+constraint/gi)) {
        const before = m.sql.slice(0, match.index);
        const lastDo = before.lastIndexOf("do $$");
        const lastEnd = before.lastIndexOf("end $$");
        const insideDoBlock = lastDo > lastEnd;
        const guarded = insideDoBlock && before.slice(lastDo).includes("pg_constraint");
        if (!guarded) offenders.push({ file: m.file, stmt: match[0].trim(), guarded });
      }
    }
    expect(offenders).toEqual([]);
  });
});
