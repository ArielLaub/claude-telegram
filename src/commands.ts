/**
 * Claudine Telegram Bot - Command Handlers
 *
 * Handles all slash commands (/help, /new, /stop, etc.)
 */

import TelegramBot from "node-telegram-bot-api";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as fs from "fs";
import * as https from "https";
import { COMMANDS, Command } from "./types.js";
import * as session from "./session.js";
import * as queue from "./queue.js";
import * as ui from "./ui.js";
import { getHistogramData } from "./stats-collector.js";

const execAsync = promisify(exec);

// ============================================================================
// Command Handler Type
// ============================================================================

export type CommandHandler = (
  bot: TelegramBot,
  chatId: number,
  args?: string
) => Promise<boolean>; // Returns true if handled

// ============================================================================
// Help Command
// ============================================================================

export async function handleHelp(bot: TelegramBot, chatId: number): Promise<boolean> {
  const sessionCmds = COMMANDS.filter((c) => c.category === "session");
  const modeCmds = COMMANDS.filter((c) => c.category === "mode");
  const systemCmds = COMMANDS.filter((c) => c.category === "system");

  const formatGroup = (cmds: Command[]): string =>
    cmds.map((c) => `${c.command} - ${c.description}`).join("\n");

  const message =
    `<b>Claudine Bot - Help</b>\n\n` +
    `<b>Session Commands</b>\n${formatGroup(sessionCmds)}\n\n` +
    `<b>Mode Commands</b>\n${formatGroup(modeCmds)}\n\n` +
    `<b>System Commands</b>\n${formatGroup(systemCmds)}\n\n` +
    `<i>Send any message to chat with Claude.</i>`;

  await ui.sendMessage(bot, chatId, message, { parse_mode: "HTML" });
  return true;
}

// ============================================================================
// Session Commands
// ============================================================================

export async function handleNew(bot: TelegramBot, chatId: number): Promise<boolean> {
  session.resetChatState(chatId);
  queue.clearQueue(chatId);
  await ui.sendMessage(bot, chatId, "Started new conversation.");
  return true;
}

export async function handleSessions(
  bot: TelegramBot,
  chatId: number
): Promise<{ handled: boolean; selectedSessionId?: string | null }> {
  const history = session.getSessionHistory();

  if (history.length === 0) {
    await ui.sendMessage(bot, chatId, "No recent sessions found.");
    return { handled: true, selectedSessionId: null };
  }

  const selectionId = `${chatId}_${Date.now()}`;
  const keyboard = ui.buildSessionKeyboard(selectionId, history);

  let message = "<b>Recent Sessions:</b>\n\n";
  history.slice(0, 5).forEach((sess, idx) => {
    const date = new Date(sess.timestamp);
    const timeStr =
      date.toLocaleDateString() +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const nameDisplay = sess.name ? `<b>${ui.escapeHtml(sess.name)}</b>` : `<i>${ui.escapeHtml(sess.preview)}</i>`;
    message += `<b>${idx + 1}.</b> ${timeStr}\n   ${nameDisplay}\n\n`;
  });

  await bot.sendMessage(chatId, message, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  // Return info for callback handling - actual selection handled by callback
  return { handled: true, selectedSessionId: undefined };
}

export async function handleResume(bot: TelegramBot, chatId: number): Promise<boolean> {
  const history = session.getSessionHistory();

  if (history.length === 0) {
    await ui.sendMessage(bot, chatId, "No recent sessions to resume. Use /new to start fresh.");
    return true;
  }

  const mostRecent = history[0];
  session.setSessionId(chatId, mostRecent.sessionId);

  const date = new Date(mostRecent.timestamp).toLocaleString();
  await ui.sendMessage(
    bot,
    chatId,
    `Resumed session from ${date}\n<i>${ui.escapeHtml(mostRecent.preview)}</i>`,
    { parse_mode: "HTML" }
  );
  return true;
}

export async function handleClear(bot: TelegramBot, chatId: number): Promise<boolean> {
  session.resetChatState(chatId);
  session.clearSessionHistory();
  queue.clearQueue(chatId);
  await ui.sendMessage(bot, chatId, "Session history cleared. Starting fresh.");
  return true;
}

export async function handleStatus(bot: TelegramBot, chatId: number): Promise<boolean> {
  const sessionId = session.getSessionId(chatId);
  const autoTools = session.getAutoApprovedTools(chatId);
  const inPlanMode = session.isPlanMode(chatId);
  const queueLength = queue.getQueueLength(chatId);
  const isProc = queue.isProcessing(chatId);

  // Get session name if available
  let sessionDisplay = "none";
  if (sessionId) {
    const sess = session.getSessionById(sessionId);
    if (sess?.name) {
      sessionDisplay = `${sess.name} (${sessionId.substring(0, 8)}...)`;
    } else {
      sessionDisplay = sessionId.substring(0, 8) + "...";
    }
  }

  const message =
    `<b>Status</b>\n` +
    `Session: ${ui.escapeHtml(sessionDisplay)}\n` +
    `Plan Mode: ${inPlanMode ? "Active" : "Off"}\n` +
    `Processing: ${isProc ? "Yes" : "No"}\n` +
    `Queued messages: ${queueLength}\n` +
    `Auto-approved tools: ${autoTools.length > 0 ? autoTools.join(", ") : "none"}`;

  await ui.sendMessage(bot, chatId, message, { parse_mode: "HTML" });
  return true;
}

export async function handleName(
  bot: TelegramBot,
  chatId: number,
  name?: string
): Promise<boolean> {
  const sessionId = session.getSessionId(chatId);

  if (!sessionId) {
    await ui.sendMessage(
      bot,
      chatId,
      "No active session. Start a conversation first, then use /name to name it."
    );
    return true;
  }

  if (!name || name.trim() === "") {
    // Show current name
    const sess = session.getSessionById(sessionId);
    if (sess?.name) {
      await ui.sendMessage(
        bot,
        chatId,
        `Current session name: <b>${ui.escapeHtml(sess.name)}</b>\n\nUse <code>/name &lt;new name&gt;</code> to change it.`,
        { parse_mode: "HTML" }
      );
    } else {
      await ui.sendMessage(
        bot,
        chatId,
        "This session has no name.\n\nUse <code>/name &lt;name&gt;</code> to set one.",
        { parse_mode: "HTML" }
      );
    }
    return true;
  }

  // Set the name
  const success = session.setSessionName(sessionId, name.trim());

  if (success) {
    await ui.sendMessage(
      bot,
      chatId,
      `✅ Session named: <b>${ui.escapeHtml(name.trim())}</b>`,
      { parse_mode: "HTML" }
    );
  } else {
    await ui.sendMessage(bot, chatId, "Failed to set session name.");
  }

  return true;
}

// ============================================================================
// Mode Commands
// ============================================================================

export async function handlePlan(bot: TelegramBot, chatId: number): Promise<boolean> {
  session.setPlanMode(chatId, true);
  await ui.sendMessage(
    bot,
    chatId,
    "<b>Plan Mode Enabled</b>\n\n" +
      "Claude will now explore and create a plan without making changes.\n" +
      "Use /approve to execute the plan\n" +
      "Use /cancel to exit plan mode",
    { parse_mode: "HTML" }
  );
  return true;
}

export async function handleApprove(bot: TelegramBot, chatId: number): Promise<boolean> {
  if (!session.isPlanMode(chatId)) {
    await ui.sendMessage(bot, chatId, "Not in plan mode. Use /plan first.");
    return true;
  }
  session.setPlanMode(chatId, false);
  await ui.sendMessage(bot, chatId, "<b>Plan Approved</b>\nSend your next message to execute.", {
    parse_mode: "HTML",
  });
  return true;
}

export async function handleCancel(bot: TelegramBot, chatId: number): Promise<boolean> {
  if (!session.isPlanMode(chatId)) {
    await ui.sendMessage(bot, chatId, "Not in plan mode.");
    return true;
  }
  session.setPlanMode(chatId, false);
  await ui.sendMessage(bot, chatId, "<b>Plan Mode Cancelled</b>", { parse_mode: "HTML" });
  return true;
}

export async function handleStop(bot: TelegramBot, chatId: number): Promise<boolean> {
  const wasAborted = queue.abortCurrentOperation(chatId);
  const clearedCount = queue.clearQueue(chatId);
  queue.setProcessing(chatId, false);

  // Clear any status message
  await ui.clearStatusMessage(bot, chatId);

  let message = "<b>Stopped</b>";
  if (wasAborted) {
    message += "\nCancelled current operation.";
  }
  if (clearedCount > 0) {
    message += `\nCleared ${clearedCount} queued message${clearedCount > 1 ? "s" : ""}.`;
  }
  if (!wasAborted && clearedCount === 0) {
    message += "\nNothing was running.";
  }

  await ui.sendMessage(bot, chatId, message, { parse_mode: "HTML" });
  return true;
}

// ============================================================================
// System Commands
// ============================================================================

export async function handleStats(bot: TelegramBot, chatId: number): Promise<boolean> {
  try {
    // Get CPU usage
    const cpus = os.cpus();
    const cpuCount = cpus.length;

    let cpuUsage = 0;
    try {
      const { stdout: cpuInfo } = await execAsync(
        "top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"
      );
      cpuUsage = parseFloat(cpuInfo.trim()) || 0;
    } catch {
      // top might not be available
    }

    // Memory info
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

    // Process memory
    const processMemMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    // Uptime
    const uptime = process.uptime();
    const uptimeStr =
      uptime < 60
        ? `${Math.floor(uptime)}s`
        : uptime < 3600
          ? `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`
          : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

    // Temperature (Raspberry Pi specific)
    let temp = "N/A";
    try {
      const { stdout: tempOut } = await execAsync("vcgencmd measure_temp");
      temp = tempOut.replace("temp=", "").trim();
    } catch {
      // Not a Pi or vcgencmd not available
    }

    // Get histogram data
    const histograms = getHistogramData();
    const histNote = histograms.sampleCount > 1
      ? `<i>(${histograms.sampleCount} samples, last 10min)</i>`
      : `<i>(collecting data...)</i>`;

    const statsMsg =
      `<b>System Stats</b>\n\n` +
      `<b>CPU:</b> ${cpuUsage.toFixed(1)}% (${cpuCount} cores)\n` +
      `<code>${histograms.cpu}</code>\n\n` +
      `<b>Memory:</b> ${(usedMem / 1024 / 1024 / 1024).toFixed(1)}GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(1)}GB (${memPercent}%)\n` +
      `<code>${histograms.mem}</code>\n\n` +
      `${histNote}\n\n` +
      `Bot Memory: ${processMemMB}MB\n` +
      `Temperature: ${temp}\n` +
      `Bot Uptime: ${uptimeStr}`;

    await ui.sendMessage(bot, chatId, statsMsg, { parse_mode: "HTML" });
  } catch (error) {
    await ui.sendMessage(bot, chatId, `Error getting stats: ${error}`);
  }
  return true;
}

export async function handleRestart(bot: TelegramBot, chatId: number): Promise<boolean> {
  await ui.sendMessage(bot, chatId, "Claudine is restarting...");
  // Give time for message to send
  setTimeout(() => {
    process.exit(0); // systemd will restart us
  }, 500);
  return true;
}

/** Usage response from Anthropic API */
interface UsageData {
  five_hour?: {
    utilization: number;
    resets_at: string | null;
  };
  seven_day?: {
    utilization: number;
    resets_at: string | null;
  };
  seven_day_opus?: {
    utilization: number;
    resets_at: string | null;
  };
}

/** Fetch usage data from Anthropic API */
async function fetchAnthropicUsage(): Promise<UsageData> {
  return new Promise((resolve, reject) => {
    // Read the OAuth token from Claude CLI credentials
    const credentialsPath = `${os.homedir()}/.claude/.credentials.json`;
    let token: string | undefined;

    try {
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
      token = credentials.claudeAiOauth?.accessToken;
    } catch (err) {
      console.error("Failed to read credentials:", err);
      // Try environment variable as fallback
      token = process.env.ANTHROPIC_OAUTH_TOKEN;
    }

    if (!token) {
      reject(new Error("No OAuth token found. Make sure you're logged in with Claude CLI."));
      return;
    }

    const options = {
      hostname: "api.anthropic.com",
      path: "/api/oauth/usage",
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Failed to parse usage response"));
          }
        } else {
          reject(new Error(`API returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

/** Format time until reset */
function formatTimeUntilReset(resetAt: string | null): string {
  if (!resetAt) return "N/A";

  const resetTime = new Date(resetAt).getTime();
  const now = Date.now();
  const diffMs = resetTime - now;

  if (diffMs <= 0) return "resetting soon";

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/** Create a visual progress bar using emoji squares */
function createProgressBar(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  // Use colored squares based on usage level
  let filledChar: string;
  if (percent >= 90) {
    filledChar = "🟥"; // Red when critical
  } else if (percent >= 70) {
    filledChar = "🟨"; // Yellow when warning
  } else {
    filledChar = "🟩"; // Green when healthy
  }

  return filledChar.repeat(filled) + "⬜".repeat(empty);
}

export async function handleUsage(bot: TelegramBot, chatId: number): Promise<boolean> {
  try {
    await ui.sendMessage(bot, chatId, "Fetching usage data...");

    const usage = await fetchAnthropicUsage();

    let message = "<b>Claude Usage</b>\n\n";

    // 5-hour limit
    if (usage.five_hour) {
      const pct = usage.five_hour.utilization;
      const bar = createProgressBar(pct);
      const reset = formatTimeUntilReset(usage.five_hour.resets_at);
      message += `<b>5-Hour Limit</b>\n`;
      message += `${bar} ${pct.toFixed(1)}%\n`;
      message += `Resets in: ${reset}\n\n`;
    }

    // 7-day limit
    if (usage.seven_day) {
      const pct = usage.seven_day.utilization;
      const bar = createProgressBar(pct);
      const reset = formatTimeUntilReset(usage.seven_day.resets_at);
      message += `<b>Weekly Limit</b>\n`;
      message += `${bar} ${pct.toFixed(1)}%\n`;
      message += `Resets in: ${reset}\n\n`;
    }

    // Opus limit (if applicable)
    if (usage.seven_day_opus && usage.seven_day_opus.utilization > 0) {
      const pct = usage.seven_day_opus.utilization;
      const bar = createProgressBar(pct);
      const reset = formatTimeUntilReset(usage.seven_day_opus.resets_at);
      message += `<b>Opus Weekly Limit</b>\n`;
      message += `${bar} ${pct.toFixed(1)}%\n`;
      message += `Resets in: ${reset}\n`;
    }

    await ui.sendMessage(bot, chatId, message, { parse_mode: "HTML" });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await ui.sendMessage(bot, chatId, `<b>Error fetching usage:</b> ${ui.escapeHtml(errMsg)}`, {
      parse_mode: "HTML",
    });
  }
  return true;
}

export async function handleStart(bot: TelegramBot, chatId: number): Promise<boolean> {
  // Same as help but with welcome message
  await ui.sendMessage(
    bot,
    chatId,
    "<b>Welcome to Claudine!</b>\n\n" +
      "I'm a Claude-powered assistant running on Telegram.\n\n" +
      "Use /help to see all commands, or just send a message to start chatting.",
    { parse_mode: "HTML" }
  );
  return true;
}

// ============================================================================
// Telegram Menu Registration
// ============================================================================

/** Register bot commands with Telegram for the menu button */
export async function registerBotCommands(bot: TelegramBot): Promise<void> {
  try {
    const commandList = COMMANDS.map((cmd) => ({
      command: cmd.command.replace("/", ""), // Remove leading slash
      description: cmd.description,
    }));

    console.log("Registering commands:", commandList.map(c => c.command).join(", "));

    // Use the request method directly for better reliability
    const result = await (bot as any).request("setMyCommands", {
      commands: commandList,
    });

    console.log("Bot commands registered with Telegram menu, result:", result);
  } catch (error) {
    console.error("Failed to register bot commands:", error);
  }
}

// ============================================================================
// Command Router
// ============================================================================

/** Route a command to its handler. Returns true if command was handled. */
export async function routeCommand(
  bot: TelegramBot,
  chatId: number,
  text: string
): Promise<boolean> {
  const [command, ...argParts] = text.split(" ");
  const args = argParts.join(" ");

  switch (command.toLowerCase()) {
    case "/start":
      return handleStart(bot, chatId);
    case "/help":
      return handleHelp(bot, chatId);
    case "/new":
      return handleNew(bot, chatId);
    case "/sessions":
      const result = await handleSessions(bot, chatId);
      return result.handled;
    case "/resume":
      return handleResume(bot, chatId);
    case "/name":
      return handleName(bot, chatId, args);
    case "/clear":
      return handleClear(bot, chatId);
    case "/status":
      return handleStatus(bot, chatId);
    case "/plan":
      return handlePlan(bot, chatId);
    case "/approve":
      return handleApprove(bot, chatId);
    case "/cancel":
      return handleCancel(bot, chatId);
    case "/stop":
      return handleStop(bot, chatId);
    case "/stats":
      return handleStats(bot, chatId);
    case "/usage":
      return handleUsage(bot, chatId);
    case "/restart":
      return handleRestart(bot, chatId);
    default:
      return false; // Not a recognized command
  }
}
