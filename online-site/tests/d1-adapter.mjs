import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const plain = (value) => value === undefined ? null : JSON.parse(JSON.stringify(value));

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { assert.ok(args.length <= 100, "D1 binding limit"); return new Statement(this.db, this.sql, args); }
  async first() { return plain(this.db.prepare(this.sql).get(...this.args)); }
  async all() { return { results: plain(this.db.prepare(this.sql).all(...this.args)) }; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async execute() {
    const statement = this.db.prepare(this.sql);
    return statement.columns().length ? { results: plain(statement.all(...this.args)), meta: { changes: 0 } } : this.run();
  }
}

export class D1Adapter {
  constructor(connection) { this.connection = connection; }
  prepare(sql) { return new Statement(this.connection, sql); }
  async batch(statements) {
    this.connection.exec("BEGIN");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.execute());
      this.connection.exec("COMMIT");
      return result;
    } catch (error) { this.connection.exec("ROLLBACK"); throw error; }
  }
}

export function database(path = ":memory:") {
  const connection = new DatabaseSync(path);
  connection.exec("PRAGMA foreign_keys = ON");
  for (const migration of readdirSync(new URL("../drizzle/", import.meta.url)).filter((p) => p.endsWith(".sql")).sort()) {
    connection.exec(readFileSync(new URL("../drizzle/" + migration, import.meta.url), "utf8"));
  }
  return new D1Adapter(connection);
}

