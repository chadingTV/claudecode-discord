import fs from "node:fs";
import path from "node:path";
import { findSessionDir } from "../bot/commands/sessions.js";

/**
 * Delete the ~/.claude/projects/<encoded-path>/ session directory
 * and <projectPath>/.claude-uploads/ for a given project.
 */
export function cleanupProjectFiles(projectPath: string): {
  sessionDir: boolean;
  uploads: boolean;
} {
  const result = { sessionDir: false, uploads: false };

  // 1. Remove session directory (~/.claude/projects/<encoded-path>/)
  const sessionDir = findSessionDir(projectPath);
  if (sessionDir) {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      result.sessionDir = true;
    } catch {
      // skip if removal fails
    }
  }

  // 2. Remove uploads directory (<projectPath>/.claude-uploads/)
  const uploadsDir = path.join(projectPath, ".claude-uploads");
  if (fs.existsSync(uploadsDir)) {
    try {
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      result.uploads = true;
    } catch {
      // skip if removal fails
    }
  }

  return result;
}
