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

    CREATE TABLE IF NOT EXISTS workspaces (
      guild_id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
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
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (id, channel_id, session_id, status, last_activity)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(id, channelId, sessionId, status);
}

export function getSession(channelId: string): Session | undefined {
  return db
    .prepare(
      "SELECT * FROM sessions WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(channelId) as Session | undefined;
}

export function clearSession(channelId: string): void {
  db.prepare("DELETE FROM sessions WHERE channel_id = ?").run(channelId);
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

// Model per channel
export function setModel(channelId: string, model: string | null): void {
  try { db.exec("ALTER TABLE projects ADD COLUMN model TEXT DEFAULT NULL"); } catch {}
  db.prepare("UPDATE projects SET model = ? WHERE channel_id = ?").run(model, channelId);
}

export function getModel(channelId: string): string | null {
  try { db.exec("ALTER TABLE projects ADD COLUMN model TEXT DEFAULT NULL"); } catch {}
  const row = db.prepare("SELECT model FROM projects WHERE channel_id = ?").get(channelId) as { model: string | null } | undefined;
  return row?.model ?? null;
}

// Disabled MCPs per channel
export function getDisabledMcps(channelId: string): string[] {
  try { db.exec("ALTER TABLE projects ADD COLUMN disabled_mcps TEXT DEFAULT NULL"); } catch {}
  const row = db.prepare("SELECT disabled_mcps FROM projects WHERE channel_id = ?").get(channelId) as { disabled_mcps: string | null } | undefined;
  if (!row?.disabled_mcps) return [];
  try { return JSON.parse(row.disabled_mcps) as string[]; } catch { return []; }
}

export function setDisabledMcps(channelId: string, names: string[]): void {
  try { db.exec("ALTER TABLE projects ADD COLUMN disabled_mcps TEXT DEFAULT NULL"); } catch {}
  db.prepare("UPDATE projects SET disabled_mcps = ? WHERE channel_id = ?").run(
    names.length > 0 ? JSON.stringify(names) : null,
    channelId,
  );
}
