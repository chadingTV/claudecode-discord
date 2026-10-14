import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/i18n.js", () => ({
  L: (en: string, _kr: string) => en,
}));

vi.mock("../../db/database.js", () => ({
  getAllProjects: vi.fn(),
  getSession: vi.fn(),
}));

import { formatSessionUsage } from "./status.js";

describe("formatSessionUsage", () => {
  it("shows turns and estimated cost when cost display is on", () => {
    expect(formatSessionUsage({ turn_count: 12, total_cost_usd: 1.23456 }, true)).toBe(
      "Turns: 12  |  Cost (est.): $1.2346",
    );
  });

  it("hides cost when cost display is off", () => {
    expect(formatSessionUsage({ turn_count: 12, total_cost_usd: 1.2 }, false)).toBe(
      "Turns: 12",
    );
  });

  it("treats a missing session as zero turns", () => {
    expect(formatSessionUsage(undefined, false)).toBe("Turns: 0");
  });
});
