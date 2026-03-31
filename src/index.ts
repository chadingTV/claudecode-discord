import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./utils/config.js";
import { initDatabase } from "./db/database.js";
import { startBot } from "./bot/client.js";

const LOCK_FILE = path.join(process.cwd(), ".bot.lock");

function acquireLock(): boolean {
  try {
    // Check if lock file exists and process is still running
    if (fs.existsSync(LOCK_FILE)) {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
      try {
        // signal 0 checks if process exists without killing it
        process.kill(pid, 0);
        return false; // process still running
      } catch {
        // process not running, stale lock file
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // ignore
  }
}

async function main() {
  if (!acquireLock()) {
    console.error("Another bot instance is already running. Exiting.");
    process.exit(1);
  }

  // Clean up lock file on exit
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(0); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(0); });

  // Global error handlers — prevent silent hangs from unhandled errors
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    // Don't exit — let the bot keep running for non-fatal errors
  });

  console.log("Starting Claude Code Discord Controller...");

  // Load and validate config
  loadConfig();
  console.log("Config loaded");

  // Initialize database
  initDatabase();
  console.log("Database initialized");

  // Start Discord bot
  await startBot();
  console.log("Bot is running!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  releaseLock();
  process.exit(1);
});
