import { describe, it, expect, vi } from "vitest";

// Mock i18n to always return English strings (regardless of .tray-lang file)
vi.mock("../utils/i18n.js", () => ({
  L: (en: string, _kr: string) => en,
}));

import {
  formatStreamChunk,
  splitMessage,
  createToolApprovalEmbed,
  createResultEmbed,
  createAskUserQuestionEmbed,
  createStopButton,
  createCompletedButton,
  type AskQuestionData,
} from "./output-formatter.js";

// ─── formatStreamChunk ───

describe("formatStreamChunk", () => {
  it("returns text unchanged when under 1900 characters", () => {
    expect(formatStreamChunk("hello")).toBe("hello");
  });

  it("returns text unchanged at exactly 1900 characters", () => {
    const text = "a".repeat(1900);
    expect(formatStreamChunk(text)).toBe(text);
  });

  it("truncates text over 1900 characters with ellipsis", () => {
    const text = "a".repeat(2000);
    const result = formatStreamChunk(text);
    expect(result).toBe("a".repeat(1900) + "\n... (truncated)");
  });

  it("handles empty string", () => {
    expect(formatStreamChunk("")).toBe("");
  });
});

// ─── splitMessage ───

describe("splitMessage", () => {
  it("returns single chunk for short messages", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("returns single chunk at exactly 1900 characters", () => {
    const text = "a".repeat(1900);
    expect(splitMessage(text)).toEqual([text]);
  });

  it("splits long messages at newline boundaries", () => {
    const line1 = "a".repeat(1000);
    const line2 = "b".repeat(1000);
    const text = line1 + "\n" + line2;
    const chunks = splitMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toContain("b");
  });

  it("splits at MAX_DISCORD_LENGTH when no suitable newline found", () => {
    const text = "a".repeat(3800);
    const chunks = splitMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toHaveLength(1900);
  });

  it("preserves code block fences across splits (with language)", () => {
    // Build text that starts a code block and exceeds 1900 chars
    const code = "x".repeat(1850);
    const text = "```typescript\n" + code + "\n" + "y".repeat(500) + "\n```";
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk should close the code block
    expect(chunks[0]).toMatch(/```$/);
    // Second chunk should reopen with language
    expect(chunks[1]).toMatch(/^```typescript\n/);
  });

  it("preserves code block fences without language specifier", () => {
    const code = "x".repeat(1850);
    const text = "```\n" + code + "\n" + "y".repeat(500) + "\n```";
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toMatch(/```$/);
    expect(chunks[1]).toMatch(/^```\n/);
  });

  it("handles closed code block before split point", () => {
    const block = "```js\nconsole.log('hello');\n```\n";
    const after = "a".repeat(1900);
    const text = block + after;
    const chunks = splitMessage(text);
    // Code block is closed before split, so no fence injection needed
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk should NOT end with a double ``` (the block is properly closed)
    const fenceCount = (chunks[0].match(/^```/gm) || []).length;
    expect(fenceCount % 2).toBe(0); // even = all blocks closed
  });

  it("handles empty string", () => {
    expect(splitMessage("")).toEqual([]);
  });

  it("handles very long single line", () => {
    const text = "a".repeat(6000);
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1920); // small buffer for fences
    }
  });

  it("prefers splitting at newline near the end rather than mid-line", () => {
    // Newline at position 1500 (within acceptable range)
    const text = "a".repeat(1500) + "\n" + "b".repeat(800);
    const chunks = splitMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe("a".repeat(1500));
  });
});

// ─── createToolApprovalEmbed ───

describe("createToolApprovalEmbed", () => {
  it("creates embed with File field for Edit tool", () => {
    const result = createToolApprovalEmbed(
      "Edit",
      { file_path: "/src/index.ts", old_string: "foo", new_string: "bar" },
      "req-123",
    );
    expect(result.embed.data.title).toBe("🔧 Tool Use: Edit");
    const fileField = result.embed.data.fields?.find((f) => f.name === "File");
    expect(fileField?.value).toContain("index.ts");
    const changesField = result.embed.data.fields?.find((f) => f.name === "Changes");
    expect(changesField).toBeDefined();
  });

  it("creates embed with Command field for Bash tool", () => {
    const { embed } = createToolApprovalEmbed(
      "Bash",
      { command: "ls -la", description: "List files" },
      "req-456",
    );
    const cmdField = embed.data.fields?.find((f) => f.name === "Command");
    expect(cmdField?.value).toContain("ls -la");
    const descField = embed.data.fields?.find((f) => f.name === "Description");
    expect(descField?.value).toBe("List files");
  });

  it("creates three buttons: approve, deny, approve-all", () => {
    const { row: approvalRow } = createToolApprovalEmbed("Write", { file_path: "/a" }, "req-789");
    const buttons = approvalRow.components;
    expect(buttons).toHaveLength(3);
    expect(buttons[0].data).toHaveProperty("custom_id", "approve:req-789");
    expect(buttons[1].data).toHaveProperty("custom_id", "deny:req-789");
    expect(buttons[2].data).toHaveProperty("custom_id", "approve-all:req-789");
  });

  it("skips Input field for empty input on generic tool", () => {
    const { embed } = createToolApprovalEmbed("CustomTool", {}, "req-abc");
    const inputField = embed.data.fields?.find((f) => f.name === "Input");
    expect(inputField).toBeUndefined();
  });

  it("shows Content Preview for Write tool with content", () => {
    const { embed } = createToolApprovalEmbed(
      "Write",
      { file_path: "/a.ts", content: "x".repeat(1000) },
      "req-w",
    );
    const preview = embed.data.fields?.find((f) => f.name === "Content Preview");
    expect(preview).toBeDefined();
    // Content sliced to 500 + fence chars
    expect(preview!.value!.length).toBeLessThanOrEqual(520);
  });
});

// ─── createResultEmbed ───

describe("createResultEmbed", () => {
  it("shows token usage in footer", () => {
    const { embed } = createResultEmbed("Done", 50000, 5000, 5000);
    const footer = embed.data.footer?.text ?? "";
    expect(footer).toContain("Tokens");
    expect(footer).toContain("55.0K");
    expect(footer).toContain("↑50.0K");
    expect(footer).toContain("↓5.0K");
    expect(footer).toContain("Duration");
    expect(footer).toContain("5.0s");
  });

  it("formats duration correctly", () => {
    const { embed } = createResultEmbed("Done", 0, 0, 12500);
    const footer = embed.data.footer?.text ?? "";
    expect(footer).toContain("12.5s");
  });

  it("returns no file for short results", () => {
    const { embed, file } = createResultEmbed("short", 0, 0, 0);
    expect(embed.data.description).toBe("short");
    expect(file).toBeUndefined();
  });

  it("attaches txt file for results over 4000 chars", () => {
    const longText = "x".repeat(5000);
    const { embed, file } = createResultEmbed(longText, 0, 0, 0);
    expect(embed.data.description!.length).toBeLessThanOrEqual(4000);
    expect(embed.data.description).toContain("Full result attached");
    expect(file).toBeDefined();
    expect(file!.name).toBe("result.txt");
  });
});

// ─── createAskUserQuestionEmbed ───

describe("createAskUserQuestionEmbed", () => {
  it("creates single-select with option buttons + custom input button", () => {
    const data: AskQuestionData = {
      question: "Pick one",
      header: "Test",
      options: [
        { label: "A", description: "Option A" },
        { label: "B", description: "Option B" },
      ],
      multiSelect: false,
    };
    const { embed, components } = createAskUserQuestionEmbed(data, "req-1", 0, 1);
    expect(embed.data.title).toBe("❓ Test");
    // 2 option buttons + 1 custom input = 3 buttons in 1 row
    expect(components).toHaveLength(1);
    expect(components[0].components).toHaveLength(3);
  });

  it("creates multi-select with StringSelectMenu + custom input row", () => {
    const data: AskQuestionData = {
      question: "Pick many",
      header: "Multi",
      options: [
        { label: "X", description: "desc X" },
        { label: "Y", description: "desc Y" },
      ],
      multiSelect: true,
    };
    const { components } = createAskUserQuestionEmbed(data, "req-2", 0, 1);
    // Row 1: select menu, Row 2: custom input button
    expect(components).toHaveLength(2);
    expect(components[0].components[0].data).toHaveProperty("custom_id", "ask-select:req-2");
  });

  it("shows question index when totalQuestions > 1", () => {
    const data: AskQuestionData = {
      question: "Q",
      header: "H",
      options: [{ label: "A", description: "" }],
      multiSelect: false,
    };
    const { embed } = createAskUserQuestionEmbed(data, "r", 1, 3);
    expect(embed.data.title).toContain("(2/3)");
  });

  it("splits buttons into rows of 5 when many options", () => {
    const options = Array.from({ length: 7 }, (_, i) => ({
      label: `Opt${i}`,
      description: "",
    }));
    const data: AskQuestionData = {
      question: "Q",
      header: "H",
      options,
      multiSelect: false,
    };
    const { components } = createAskUserQuestionEmbed(data, "r", 0, 1);
    // 7 options + 1 custom = 8 buttons -> 2 rows (5 + 3)
    expect(components).toHaveLength(2);
    expect(components[0].components).toHaveLength(5);
    expect(components[1].components).toHaveLength(3);
  });
});

// ─── createStopButton / createCompletedButton ───

describe("createStopButton", () => {
  it("creates button with correct customId", () => {
    const row = createStopButton("ch-123");
    expect(row.components[0].data).toHaveProperty("custom_id", "stop:ch-123");
  });
});

describe("createCompletedButton", () => {
  it("creates disabled button", () => {
    const row = createCompletedButton();
    expect(row.components[0].data).toHaveProperty("disabled", true);
  });
});
