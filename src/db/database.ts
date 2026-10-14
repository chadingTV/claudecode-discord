import Database from "better-sqlite3";
import path from "node:path";
import type { Project, Session, SessionStatus } from "./types.js";

const DB_PATH = path.join(process.cwd(), "data.db");

let db: Database.Database;

export function initDatabase(): void {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      channel_id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      auto_approve INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      channel_id TEXT REFERENCES projects(channel_id) ON DELETE CASCADE,
      session_id TEXT,
      status TEXT DEFAULT 'offline',
      last_activity TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  migrateDatabase(db);
}

// Add columns introduced after the initial release to existing data.db files.
// Safe to run repeatedly.
export function migrateDatabase(database: Database.Database): void {
  const columns = (
    database.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]
  ).map((c) => c.name);

  if (!columns.includes("turn_count")) {
    database.exec("ALTER TABLE sessions ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.includes("total_cost_usd")) {
    database.exec("ALTER TABLE sessions ADD COLUMN total_cost_usd REAL NOT NULL DEFAULT 0");
  }
}

export function getDb(): Database.Database {
  return db;
}

// Project queries
export function registerProject(
  channelId: string,
  projectPath: string,
  guildId: string,
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO projects (channel_id, project_path, guild_id)
    VALUES (?, ?, ?)
  `);
  stmt.run(channelId, projectPath, guildId);
}

export function unregisterProject(channelId: string): void {
  db.prepare("DELETE FROM sessions WHERE channel_id = ?").run(channelId);
  db.prepare("DELETE FROM projects WHERE channel_id = ?").run(channelId);
}

export function getProject(channelId: string): Project | undefined {
  return db
    .prepare("SELECT * FROM projects WHERE channel_id = ?")
    .get(channelId) as Project | undefined;
}

export function getAllProjects(guildId: string): Project[] {
  return db
    .prepare("SELECT * FROM projects WHERE guild_id = ?")
    .all(guildId) as Project[];
}

export function setAutoApprove(
  channelId: string,
  autoApprove: boolean,
): void {
  db.prepare("UPDATE projects SET auto_approve = ? WHERE channel_id = ?").run(
    autoApprove ? 1 : 0,
    channelId,
  );
}

// Session queries
export function upsertSession(
  id: string,
  channelId: string,
  sessionId: string | null,
  status: SessionStatus,
): void {
  // Turn/cost counters persist across updates of the same row and reset when
  // session_id is cleared (a fresh conversation). created_at is refreshed to
  // keep getSession()'s "latest row" ordering identical to the old REPLACE.
  const stmt = db.prepare(`
    INSERT INTO sessions (id, channel_id, session_id, status, last_activity)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      channel_id = excluded.channel_id,
      session_id = excluded.session_id,
      status = excluded.status,
      last_activity = excluded.last_activity,
      created_at = datetime('now'),
      turn_count = CASE WHEN excluded.session_id IS NULL THEN 0 ELSE sessions.turn_count END,
      total_cost_usd = CASE WHEN excluded.session_id IS NULL THEN 0 ELSE sessions.total_cost_usd END
  `);
  stmt.run(id, channelId, sessionId, status);
}

// Record one completed turn on a session row. Returns the new turn count
// (0 if the row does not exist).
export function recordTurn(id: string, costUsd: number): number {
  const row = db
    .prepare(`
      UPDATE sessions
      SET turn_count = turn_count + 1, total_cost_usd = total_cost_usd + ?
      WHERE id = ?
      RETURNING turn_count
    `)
    .get(costUsd, id) as { turn_count: number } | undefined;
  return row?.turn_count ?? 0;
}

export function getSession(channelId: string): Session | undefined {
  return db
    .prepare(
      "SELECT * FROM sessions WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(channelId) as Session | undefined;
}

export function updateSessionStatus(
  channelId: string,
  status: SessionStatus,
): void {
  db.prepare(
    "UPDATE sessions SET status = ?, last_activity = datetime('now') WHERE channel_id = ?",
  ).run(status, channelId);
}

export function getAllSessions(guildId: string): (Session & { project_path: string })[] {
  return db
    .prepare(`
      SELECT s.*, p.project_path FROM sessions s
      JOIN projects p ON s.channel_id = p.channel_id
      WHERE p.guild_id = ?
    `)
    .all(guildId) as (Session & { project_path: string })[];
}
