/**
 * Claudine - A Claude-powered Telegram Bot
 *
 * Entry point for the application.
 */

import { ClaudineBot } from "./bot.js";
import { BotConfig } from "./types.js";
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
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || "";
  const workingDir = process.env.WORKING_DIR || process.cwd();

  // Validate required environment variables
  const missing: string[] = [];
  if (!botToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!allowedChatId) missing.push("TELEGRAM_CHAT_ID");
  // ANTHROPIC_API_KEY is optional - SDK can use CLI auth

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Please set these in your environment or .env file.");
    process.exit(1);
  }

  return {
    botToken: botToken!,
    allowedChatId: allowedChatId!,
    anthropicApiKey: anthropicApiKey!,
    workingDir,
  };
}

// ============================================================================
// Main
// ============================================================================

const config = loadConfig();
const bot = new ClaudineBot(config);

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
