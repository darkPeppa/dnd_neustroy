// Shared D1 interface for the browser SQLite engine. All API validation stays in server/index.ts.
import type { Database } from "sql.js";
export function sqliteD1(db: Database) {
  class Statement {
    constructor(
      public sql: string,
      public params: unknown[] = [],
    ) {}
    bind(...params: unknown[]) {
      return new Statement(this.sql, params);
    }
    execute() {
      const s = db.prepare(this.sql);
      try {
        s.bind(this.params as any);
        const rows: Record<string, any>[] = [];
        while (s.step()) rows.push(s.getAsObject());
        return rows;
      } finally {
        s.free();
      }
    }
    async first<T>(column?: string) {
      const row = this.execute()[0];
      return (column ? row?.[column] : row || null) as T;
    }
    async all() {
      return {
        success: true,
        results: this.execute(),
        meta: { changes: db.getRowsModified() },
      };
    }
    async run() {
      this.execute();
      return { success: true, meta: { changes: db.getRowsModified() } };
    }
  }
  return {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      db.run("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        db.run("COMMIT");
        return results;
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    },
    exec: async (sql: string) => {
      db.run(sql);
    },
  } as unknown as D1Database;
}
