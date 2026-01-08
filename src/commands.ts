/**
 * Claudine Bot - Command Handlers
 *
 * Platform-agnostic slash command handlers.
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as fs from "fs";
import * as https from "https";
import type { PlatformAdapter } from "./adapters/types.js";
import { TelegramAdapter } from "./adapters/telegram/index.js";
import { COMMANDS, Command, VerbosityLevel } from "./types.js";
import * as session from "./session.js";
import * as queue from "./queue.js";
import * as ui from "./ui.js";
import { getHistogramData } from "./stats-collector.js";

const execAsync = promisify(exec);

// ============================================================================
// Command Handler Type
// ============================================================================

export type CommandHandler = (
  adapter: PlatformAdapter,
  chatId: string,
  args?: string
) => Promise<boolean>; // Returns true if handled

// ============================================================================
// Help Command
// ============================================================================

export async function handleHelp(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
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

  await ui.sendMessage(adapter, chatId, message);
  return true;
}

// ============================================================================
// Session Commands
// ============================================================================

export async function handleNew(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  session.resetChatState(Number(chatId));
  queue.clearQueue(Number(chatId));
  await ui.sendMessage(adapter, chatId, "Started new conversation.");
  return true;
}

export async function handleSessions(
  adapter: PlatformAdapter,
  chatId: string
): Promise<{ handled: boolean; selectedSessionId?: string | null }> {
  const history = session.getSessionHistory();

  if (history.length === 0) {
    await ui.sendMessage(adapter, chatId, "No recent sessions found.");
    return { handled: true, selectedSessionId: null };
  }

  const selectionId = `${chatId}_${Date.now()}`;
  const keyboard = ui.buildSessionKeyboard(adapter, selectionId, history);

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

  await adapter.send(chatId, message, { rawKeyboard: keyboard });

  // Return info for callback handling - actual selection handled by callback
  return { handled: true, selectedSessionId: undefined };
}

export async function handleResume(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  const history = session.getSessionHistory();

  if (history.length === 0) {
    await ui.sendMessage(adapter, chatId, "No recent sessions to resume. Use /new to start fresh.");
    return true;
  }

  const mostRecent = history[0];
  session.setSessionId(Number(chatId), mostRecent.sessionId);

  const date = new Date(mostRecent.timestamp).toLocaleString();
  await ui.sendMessage(
    adapter,
    chatId,
    `Resumed session from ${date}\n<i>${ui.escapeHtml(mostRecent.preview)}</i>`
  );
  return true;
}

export async function handleClear(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  session.resetChatState(Number(chatId));
  session.clearSessionHistory();
  queue.clearQueue(Number(chatId));
  await ui.sendMessage(adapter, chatId, "Session history cleared. Starting fresh.");
  return true;
}

export async function handleStatus(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  const numericChatId = Number(chatId);
  const sessionId = session.getSessionId(numericChatId);
  const autoTools = session.getAutoApprovedTools(numericChatId);
  const inPlanMode = session.isPlanMode(numericChatId);
  const queueLength = queue.getQueueLength(numericChatId);
  const isProc = queue.isProcessing(numericChatId);

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

  await ui.sendMessage(adapter, chatId, message);
  return true;
}

export async function handleName(
  adapter: PlatformAdapter,
  chatId: string,
  name?: string
): Promise<boolean> {
  const sessionId = session.getSessionId(Number(chatId));

  if (!sessionId) {
    await ui.sendMessage(
      adapter,
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
        adapter,
        chatId,
        `Current session name: <b>${ui.escapeHtml(sess.name)}</b>\n\nUse <code>/name &lt;new name&gt;</code> to change it.`
      );
    } else {
      await ui.sendMessage(
        adapter,
        chatId,
        "This session has no name.\n\nUse <code>/name &lt;name&gt;</code> to set one."
      );
    }
    return true;
  }

  // Set the name
  const success = session.setSessionName(sessionId, name.trim());

  if (success) {
    await ui.sendMessage(
      adapter,
      chatId,
      `✅ Session named: <b>${ui.escapeHtml(name.trim())}</b>`
    );
  } else {
    await ui.sendMessage(adapter, chatId, "Failed to set session name.");
  }

  return true;
}

// ============================================================================
// Mode Commands
// ============================================================================

export async function handlePlan(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  session.setPlanMode(Number(chatId), true);
  await ui.sendMessage(
    adapter,
    chatId,
    "<b>Plan Mode Enabled</b>\n\n" +
      "Claude will now explore and create a plan without making changes.\n" +
      "Use /approve to execute the plan\n" +
      "Use /cancel to exit plan mode"
  );
  return true;
}

export async function handleApprove(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  const numericChatId = Number(chatId);
  if (!session.isPlanMode(numericChatId)) {
    await ui.sendMessage(adapter, chatId, "Not in plan mode. Use /plan first.");
    return true;
  }
  session.setPlanMode(numericChatId, false);
  await ui.sendMessage(adapter, chatId, "<b>Plan Approved</b>\nSend your next message to execute.");
  return true;
}

export async function handleCancel(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  const numericChatId = Number(chatId);
  if (!session.isPlanMode(numericChatId)) {
    await ui.sendMessage(adapter, chatId, "Not in plan mode.");
    return true;
  }
  session.setPlanMode(numericChatId, false);
  await ui.sendMessage(adapter, chatId, "<b>Plan Mode Cancelled</b>");
  return true;
}

export async function handleStop(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  const numericChatId = Number(chatId);
  const wasAborted = queue.abortCurrentOperation(numericChatId);
  const clearedCount = queue.clearQueue(numericChatId);
  queue.setProcessing(numericChatId, false);

  // Clear any status message
  await ui.clearStatusMessage(adapter, chatId);

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

  await ui.sendMessage(adapter, chatId, message);
  return true;
}

// ============================================================================
// System Commands
// ============================================================================

export async function handleStats(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
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

    await ui.sendMessage(adapter, chatId, statsMsg);
  } catch (error) {
    await ui.sendMessage(adapter, chatId, `Error getting stats: ${error}`);
  }
  return true;
}

export async function handleRestart(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  await ui.sendMessage(adapter, chatId, "Claudine is restarting...");
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

export async function handleUsage(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  try {
    await ui.sendMessage(adapter, chatId, "Fetching usage data...");

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

    await ui.sendMessage(adapter, chatId, message);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await ui.sendMessage(adapter, chatId, `<b>Error fetching usage:</b> ${ui.escapeHtml(errMsg)}`);
  }
  return true;
}

export async function handleStart(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  // Same as help but with welcome message
  await ui.sendMessage(
    adapter,
    chatId,
    "<b>Welcome to Claudine!</b>\n\n" +
      "I'm a Claude-powered assistant running on Telegram.\n\n" +
      "Use /help to see all commands, or just send a message to start chatting."
  );
  return true;
}

export async function handleVerbose(
  adapter: PlatformAdapter,
  chatId: string,
  level?: string
): Promise<boolean> {
  const currentLevel = session.getVerbosity(Number(chatId));

  // Show current level if no argument
  if (!level || level.trim() === "") {
    const descriptions: Record<VerbosityLevel, string> = {
      low: "Minimal output - just final results",
      normal: "Default - file names, tool actions",
      high: "Verbose - code diffs, command outputs",
    };

    await ui.sendMessage(
      adapter,
      chatId,
      `<b>Verbosity Level:</b> ${currentLevel}\n` +
        `<i>${descriptions[currentLevel]}</i>\n\n` +
        `Usage:\n` +
        `<code>/verbose low</code> - minimal output\n` +
        `<code>/verbose normal</code> - default\n` +
        `<code>/verbose high</code> - show details`
    );
    return true;
  }

  // Parse the new level
  const newLevel = level.trim().toLowerCase();
  if (newLevel !== "low" && newLevel !== "normal" && newLevel !== "high") {
    await ui.sendMessage(
      adapter,
      chatId,
      `Invalid verbosity level: <code>${ui.escapeHtml(level)}</code>\n` +
        `Valid options: <code>low</code>, <code>normal</code>, <code>high</code>`
    );
    return true;
  }

  session.setVerbosity(Number(chatId), newLevel as VerbosityLevel);

  const icons: Record<VerbosityLevel, string> = {
    low: "🔕",
    normal: "🔔",
    high: "🔊",
  };

  await ui.sendMessage(
    adapter,
    chatId,
    `${icons[newLevel as VerbosityLevel]} Verbosity set to <b>${newLevel}</b>`
  );
  return true;
}

// ============================================================================
// Platform Command Registration
// ============================================================================

/** Register bot commands with the platform (Telegram menu, etc.) */
export async function registerBotCommands(adapter: PlatformAdapter): Promise<void> {
  // Telegram-specific command registration
  if (adapter instanceof TelegramAdapter) {
    const commandList = COMMANDS.map((cmd) => ({
      command: cmd.command.replace("/", ""), // Remove leading slash
      description: cmd.description,
    }));

    await adapter.registerCommands(commandList);
  }
  // Other platforms can add their registration logic here
}

// ============================================================================
// Command Router
// ============================================================================

/** Route a command to its handler. Returns true if command was handled. */
export async function routeCommand(
  adapter: PlatformAdapter,
  chatId: string,
  text: string
): Promise<boolean> {
  const [command, ...argParts] = text.split(" ");
  const args = argParts.join(" ");

  switch (command.toLowerCase()) {
    case "/start":
      return handleStart(adapter, chatId);
    case "/help":
      return handleHelp(adapter, chatId);
    case "/new":
      return handleNew(adapter, chatId);
    case "/sessions":
      const result = await handleSessions(adapter, chatId);
      return result.handled;
    case "/resume":
      return handleResume(adapter, chatId);
    case "/name":
      return handleName(adapter, chatId, args);
    case "/clear":
      return handleClear(adapter, chatId);
    case "/status":
      return handleStatus(adapter, chatId);
    case "/plan":
      return handlePlan(adapter, chatId);
    case "/approve":
      return handleApprove(adapter, chatId);
    case "/cancel":
      return handleCancel(adapter, chatId);
    case "/stop":
      return handleStop(adapter, chatId);
    case "/stats":
      return handleStats(adapter, chatId);
    case "/usage":
      return handleUsage(adapter, chatId);
    case "/verbose":
      return handleVerbose(adapter, chatId, args);
    case "/restart":
      return handleRestart(adapter, chatId);
    default:
      return false; // Not a recognized command
  }
}
