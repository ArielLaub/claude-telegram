/**
 * Claudine - A Claude-powered Bot
 *
 * Entry point for the application.
 * Supports multiple platforms via adapters.
 */

import { ClaudineBot } from "./bot.js";
import { BotConfig } from "./types.js";
import { TelegramAdapter } from "./adapters/telegram/index.js";
import { startCollector, stopCollector } from "./stats-collector.js";

// ============================================================================
// Environment Setup
// ============================================================================

// Ensure node is in PATH for SDK subprocess
process.env.PATH = `/usr/bin:/usr/local/bin:${process.env.PATH || ""}`;

// ============================================================================
// Configuration
// ============================================================================

function loadConfig(): BotConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || "";
  const workingDir = process.env.WORKING_DIR || process.cwd();

  // Parse allowed chat IDs - supports both old single ID and new comma-separated format
  const rawChatIds = process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "";
  const allowedChatIds = rawChatIds
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

  // Validate required environment variables
  const missing: string[] = [];
  if (!botToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (allowedChatIds.length === 0) missing.push("TELEGRAM_CHAT_IDS (or TELEGRAM_CHAT_ID)");
  // ANTHROPIC_API_KEY is optional - SDK can use CLI auth

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Please set these in your environment or .env file.");
    process.exit(1);
  }

  return {
    botToken: botToken!,
    allowedChatIds,
    anthropicApiKey: anthropicApiKey!,
    workingDir,
  };
}

// ============================================================================
// Main
// ============================================================================

const config = loadConfig();

// Create platform adapter (Telegram for now, could be configurable later)
const adapter = new TelegramAdapter(config.botToken);

// Create the bot with the adapter
const bot = new ClaudineBot(config, adapter);

// Start the stats collector
startCollector();

// Start the bot
bot.start();

// Graceful shutdown
process.on("SIGINT", () => {
  stopCollector();
  bot.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopCollector();
  bot.stop();
  process.exit(0);
});

process.on("SIGHUP", () => {
  stopCollector();
  bot.stop();
  process.exit(0);
});

// Prevent crashes from unhandled errors
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  // Don't exit - let the bot continue running
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  // Don't exit - let the bot continue running
});

console.log("Bot is running. Press Ctrl+C to stop.");
