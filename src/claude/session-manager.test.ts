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
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

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
});
