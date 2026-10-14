import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies before importing session-manager
vi.mock("../utils/i18n.js", () => ({
  L: (en: string, _kr: string) => en,
}));

vi.mock("../db/database.js", () => ({
  upsertSession: vi.fn(),
  updateSessionStatus: vi.fn(),
  getProject: vi.fn(),
  getSession: vi.fn(),
  setAutoApprove: vi.fn(),
  recordTurn: vi.fn(() => 0),
}));

vi.mock("../utils/config.js", () => ({
  getConfig: vi.fn(() => ({ SHOW_COST: true, SESSION_TURN_WARNING: 30 })),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { getProject, getSession, recordTurn } from "../db/database.js";
import { sessionManager } from "./session-manager.js";

// Helper to create a mock TextChannel
function mockChannel(id: string) {
  return { id, send: vi.fn().mockResolvedValue({ edit: vi.fn() }) } as any;
}

describe("SessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── isActive ───

  describe("isActive", () => {
    it("returns false for unknown channel", () => {
      expect(sessionManager.isActive("unknown-channel")).toBe(false);
    });
  });

  // ─── resolveApproval ───

  describe("resolveApproval", () => {
    it("returns false for unknown requestId", () => {
      expect(sessionManager.resolveApproval("nonexistent", "approve")).toBe(false);
    });
  });

  // ─── resolveQuestion ───

  describe("resolveQuestion", () => {
    it("returns false for unknown requestId", () => {
      expect(sessionManager.resolveQuestion("nonexistent", "answer")).toBe(false);
    });
  });

  // ─── Custom input ───

  describe("custom input", () => {
    it("hasPendingCustomInput returns false initially", () => {
      expect(sessionManager.hasPendingCustomInput("ch-1")).toBe(false);
    });

    it("enableCustomInput sets pending state", () => {
      sessionManager.enableCustomInput("req-1", "ch-1");
      expect(sessionManager.hasPendingCustomInput("ch-1")).toBe(true);
    });

    it("resolveCustomInput returns false when no pending question", () => {
      sessionManager.enableCustomInput("req-no-question", "ch-2");
      // There's a custom input pending but no matching question in pendingQuestions
      expect(sessionManager.resolveCustomInput("ch-2", "hello")).toBe(false);
    });

    it("resolveCustomInput returns false for channel without pending input", () => {
      expect(sessionManager.resolveCustomInput("ch-no-input", "hello")).toBe(false);
    });
  });

  // ─── Message queue ───

  describe("message queue", () => {
    const channelId = "queue-ch";

    it("hasQueue returns false initially", () => {
      expect(sessionManager.hasQueue(channelId)).toBe(false);
    });

    it("getQueueSize returns 0 initially", () => {
      expect(sessionManager.getQueueSize(channelId)).toBe(0);
    });

    it("isQueueFull returns false when empty", () => {
      expect(sessionManager.isQueueFull(channelId)).toBe(false);
    });

    it("setPendingQueue + hasQueue works", () => {
      const channel = mockChannel(channelId);
      sessionManager.setPendingQueue(channelId, channel, "test prompt");
      expect(sessionManager.hasQueue(channelId)).toBe(true);
    });

    it("confirmQueue moves pending to queue", () => {
      const channel = mockChannel(channelId);
      sessionManager.setPendingQueue(channelId, channel, "prompt 1");
      const result = sessionManager.confirmQueue(channelId);
      expect(result).toBe(true);
      expect(sessionManager.getQueueSize(channelId)).toBe(1);
      expect(sessionManager.hasQueue(channelId)).toBe(false);
    });

    it("confirmQueue returns false when nothing pending", () => {
      expect(sessionManager.confirmQueue("no-pending")).toBe(false);
    });

    it("cancelQueue clears pending", () => {
      const channel = mockChannel(channelId);
      sessionManager.setPendingQueue(channelId, channel, "to cancel");
      sessionManager.cancelQueue(channelId);
      expect(sessionManager.hasQueue(channelId)).toBe(false);
    });

    it("isQueueFull returns true after 5 items", () => {
      const ch = "full-queue-ch";
      const channel = mockChannel(ch);
      for (let i = 0; i < 5; i++) {
        sessionManager.setPendingQueue(ch, channel, `msg ${i}`);
        sessionManager.confirmQueue(ch);
      }
      expect(sessionManager.isQueueFull(ch)).toBe(true);
      expect(sessionManager.getQueueSize(ch)).toBe(5);
    });
  });

  // ─── stopSession ───

  describe("stopSession", () => {
    it("returns false for inactive session", async () => {
      expect(await sessionManager.stopSession("no-session")).toBe(false);
    });
  });

  // ─── Turn tracking ───

  describe("sendMessage turn tracking", () => {
    function mockSdkStream(messages: object[]) {
      vi.mocked(query).mockReturnValue(
        (async function* () {
          for (const m of messages) yield m;
        })() as any,
      );
    }

    beforeEach(() => {
      vi.mocked(getProject).mockReturnValue({
        channel_id: "ch-turns",
        project_path: "/p",
        guild_id: "g",
        auto_approve: 0,
        created_at: "",
      });
      vi.mocked(getSession).mockReturnValue({
        id: "row-1",
        channel_id: "ch-turns",
        session_id: "sdk-1",
        status: "idle",
        last_activity: null,
        created_at: "",
        turn_count: 3,
        total_cost_usd: 1,
      });
    });

    it("records the completed turn and its cost on the session row", async () => {
      mockSdkStream([
        { type: "system", subtype: "init", session_id: "sdk-1" },
        { type: "result", result: "done", total_cost_usd: 0.42, duration_ms: 10 },
      ]);
      vi.mocked(recordTurn).mockReturnValue(4);

      await sessionManager.sendMessage(mockChannel("ch-turns"), "hi");

      expect(recordTurn).toHaveBeenCalledTimes(1);
      expect(recordTurn).toHaveBeenCalledWith("row-1", 0.42);
    });

    function sentTexts(channel: { send: ReturnType<typeof vi.fn> }): string[] {
      return channel.send.mock.calls.map(([arg]) =>
        typeof arg === "string" ? arg : (arg?.content ?? ""),
      );
    }

    it("posts a long-session warning when the turn count hits the threshold", async () => {
      mockSdkStream([{ type: "result", result: "done", total_cost_usd: 0, duration_ms: 1 }]);
      vi.mocked(recordTurn).mockReturnValue(30);
      const channel = mockChannel("ch-turns");

      await sessionManager.sendMessage(channel, "hi");

      expect(sentTexts(channel).some((t) => t.includes("30 turns"))).toBe(true);
    });

    it("does not warn below the threshold", async () => {
      mockSdkStream([{ type: "result", result: "done", total_cost_usd: 0, duration_ms: 1 }]);
      vi.mocked(recordTurn).mockReturnValue(4);
      const channel = mockChannel("ch-turns");

      await sessionManager.sendMessage(channel, "hi");

      expect(sentTexts(channel).some((t) => t.includes("turns"))).toBe(false);
    });

    it("does not record a turn when the query fails before a result", async () => {
      vi.mocked(query).mockReturnValue(
        (async function* () {
          throw new Error("boom");
        })() as any,
      );

      await sessionManager.sendMessage(mockChannel("ch-turns"), "hi");

      expect(recordTurn).not.toHaveBeenCalled();
    });
  });
});
