import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock better-sqlite3 to always use :memory:
vi.mock("better-sqlite3", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await vi.importActual("better-sqlite3") as any;
  const RealDatabase = actual.default;
  return {
    default: function MemoryDatabase(_path: string, options?: object) {
      return new RealDatabase(":memory:", options);
    },
  };
});

import {
  initDatabase,
  registerProject,
  unregisterProject,
  getProject,
  getAllProjects,
  setAutoApprove,
  upsertSession,
  getSession,
  updateSessionStatus,
  getAllSessions,
  recordTurn,
  migrateDatabase,
  getDb,
} from "./database.js";

describe("database", () => {
  beforeEach(() => {
    initDatabase();
  });

  // ─── Project CRUD ───

  describe("project CRUD", () => {
    it("registerProject + getProject", () => {
      registerProject("ch1", "/path/to/project", "guild1");
      const project = getProject("ch1");
      expect(project).toBeDefined();
      expect(project!.project_path).toBe("/path/to/project");
      expect(project!.guild_id).toBe("guild1");
      expect(project!.auto_approve).toBe(0);
    });

    it("registerProject with same channelId replaces existing", () => {
      registerProject("ch1", "/old/path", "guild1");
      registerProject("ch1", "/new/path", "guild1");
      const project = getProject("ch1");
      expect(project!.project_path).toBe("/new/path");
    });

    it("getProject returns undefined for non-existent channel", () => {
      expect(getProject("nonexistent")).toBeUndefined();
    });

    it("getAllProjects filters by guild", () => {
      registerProject("ch1", "/p1", "guild1");
      registerProject("ch2", "/p2", "guild1");
      registerProject("ch3", "/p3", "guild2");
      expect(getAllProjects("guild1")).toHaveLength(2);
      expect(getAllProjects("guild2")).toHaveLength(1);
      expect(getAllProjects("guild3")).toHaveLength(0);
    });

    it("unregisterProject removes project and cascades to sessions", () => {
      registerProject("ch1", "/p1", "guild1");
      upsertSession("s1", "ch1", null, "online");
      unregisterProject("ch1");
      expect(getProject("ch1")).toBeUndefined();
      expect(getSession("ch1")).toBeUndefined();
    });

    it("setAutoApprove toggles auto_approve flag", () => {
      registerProject("ch1", "/p1", "guild1");
      expect(getProject("ch1")!.auto_approve).toBe(0);

      setAutoApprove("ch1", true);
      expect(getProject("ch1")!.auto_approve).toBe(1);

      setAutoApprove("ch1", false);
      expect(getProject("ch1")!.auto_approve).toBe(0);
    });
  });

  // ─── Session CRUD ───

  describe("session CRUD", () => {
    beforeEach(() => {
      registerProject("ch1", "/p1", "guild1");
    });

    it("upsertSession + getSession", () => {
      upsertSession("s1", "ch1", "sdk-session-1", "online");
      const session = getSession("ch1");
      expect(session).toBeDefined();
      expect(session!.session_id).toBe("sdk-session-1");
      expect(session!.status).toBe("online");
    });

    it("upsertSession replaces existing session with same id", () => {
      upsertSession("s1", "ch1", null, "online");
      upsertSession("s1", "ch1", "sdk-1", "idle");
      const session = getSession("ch1");
      expect(session!.session_id).toBe("sdk-1");
      expect(session!.status).toBe("idle");
    });

    it("upsertSession with null sessionId", () => {
      upsertSession("s1", "ch1", null, "online");
      const session = getSession("ch1");
      expect(session!.session_id).toBeNull();
    });

    it("updateSessionStatus changes status", () => {
      upsertSession("s1", "ch1", null, "online");
      updateSessionStatus("ch1", "waiting");
      expect(getSession("ch1")!.status).toBe("waiting");
    });

    it("getAllSessions joins with projects", () => {
      registerProject("ch2", "/p2", "guild1");
      upsertSession("s1", "ch1", null, "online");
      upsertSession("s2", "ch2", null, "idle");
      const sessions = getAllSessions("guild1");
      expect(sessions).toHaveLength(2);
      expect(sessions[0].project_path).toBeDefined();
    });

    it("getAllSessions returns empty for guild with no sessions", () => {
      registerProject("ch2", "/p2", "guild2");
      expect(getAllSessions("guild2")).toHaveLength(0);
    });
  });

  // ─── Turn / cost tracking ───

  describe("turn tracking", () => {
    beforeEach(() => {
      registerProject("ch1", "/p1", "guild1");
    });

    it("new sessions start with zero turns and cost", () => {
      upsertSession("s1", "ch1", "sdk-1", "online");
      const session = getSession("ch1")!;
      expect(session.turn_count).toBe(0);
      expect(session.total_cost_usd).toBe(0);
    });

    it("recordTurn increments turns, accumulates cost, and returns the new count", () => {
      upsertSession("s1", "ch1", "sdk-1", "online");
      expect(recordTurn("s1", 0.25)).toBe(1);
      expect(recordTurn("s1", 0.5)).toBe(2);
      const session = getSession("ch1")!;
      expect(session.turn_count).toBe(2);
      expect(session.total_cost_usd).toBeCloseTo(0.75);
    });

    it("recordTurn returns 0 for an unknown session row", () => {
      expect(recordTurn("missing", 1)).toBe(0);
    });

    it("upsertSession keeps counters when the session continues", () => {
      upsertSession("s1", "ch1", "sdk-1", "online");
      recordTurn("s1", 0.1);
      upsertSession("s1", "ch1", "sdk-1", "idle");
      upsertSession("s1", "ch1", "sdk-2", "online");
      const session = getSession("ch1")!;
      expect(session.turn_count).toBe(1);
      expect(session.session_id).toBe("sdk-2");
      expect(session.status).toBe("online");
    });

    it("upsertSession resets counters when session_id is cleared (new conversation)", () => {
      upsertSession("s1", "ch1", "sdk-1", "online");
      recordTurn("s1", 0.1);
      upsertSession("s1", "ch1", null, "online");
      const session = getSession("ch1")!;
      expect(session.turn_count).toBe(0);
      expect(session.total_cost_usd).toBe(0);
    });
  });

  // ─── Migration ───

  describe("migrateDatabase", () => {
    it("adds tracking columns to a legacy sessions table without losing rows", () => {
      const db = getDb();
      db.exec(`
        DROP TABLE sessions;
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          channel_id TEXT REFERENCES projects(channel_id) ON DELETE CASCADE,
          session_id TEXT,
          status TEXT DEFAULT 'offline',
          last_activity TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      registerProject("ch1", "/p1", "guild1");
      db.prepare(
        "INSERT INTO sessions (id, channel_id, session_id, status) VALUES ('s1', 'ch1', 'sdk-1', 'idle')",
      ).run();

      migrateDatabase(db);
      migrateDatabase(db); // idempotent

      const session = getSession("ch1")!;
      expect(session.session_id).toBe("sdk-1");
      expect(session.turn_count).toBe(0);
      expect(session.total_cost_usd).toBe(0);
      expect(recordTurn("s1", 0.2)).toBe(1);
    });
  });
});
