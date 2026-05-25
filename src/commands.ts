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
import { COMMANDS, Command, VerbosityLevel, AVAILABLE_MODELS, ClaudeModel } from "./types.js";
import * as session from "./session.js";
import * as queue from "./queue.js";
import * as ui from "./ui.js";
import * as projects from "./projects.js";
import * as agents from "./agents.js";
import * as digest from "./digest.js";
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
  const history = session.getSessionHistory(Number(chatId));

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
  const history = session.getSessionHistory(Number(chatId));

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
  const currentModel = session.getModel(numericChatId);
  const modelInfo = AVAILABLE_MODELS.find(m => m.id === currentModel);

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
    `Model: ${modelInfo?.name || currentModel}\n` +
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
// Project / Agent Commands
// ============================================================================

/** Pending picker selections (workspace child disambiguation). */
const pendingProjectPicks = new Map<string, { chatId: number; candidates: projects.Project[] }>();

export async function handleProjects(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  const loadErr = projects.getLoadError();
  if (loadErr) {
    await ui.sendMessage(adapter, chatId, `<b>Project registry not loaded</b>\n<i>${ui.escapeHtml(loadErr)}</i>`);
    return true;
  }

  const active = session.getActiveProject(Number(chatId));
  const topLevel = projects.listTopLevel();

  if (topLevel.length === 0) {
    await ui.sendMessage(
      adapter,
      chatId,
      `<b>No projects registered</b>\n\nEdit <code>${ui.escapeHtml(projects.getRegistryPath())}</code> to add some.`,
    );
    return true;
  }

  let message = "<b>Projects</b>\n";
  if (active) {
    message += `<i>Active: ${ui.escapeHtml(active)}</i>\n`;
  }
  message += "\n";

  for (const p of topLevel) {
    const marker = p.name === active ? "▸ " : "• ";
    message += `${marker}<b>${ui.escapeHtml(p.shortName)}</b>`;
    if (p.tracker.type === "jira" && p.tracker.key) message += ` <code>${ui.escapeHtml(p.tracker.key)}</code>`;
    message += "\n";
    for (const childName of p.children) {
      const child = projects.getProject(childName);
      if (!child) continue;
      const childMarker = child.name === active ? "  ▸ " : "  └ ";
      message += `${childMarker}${ui.escapeHtml(child.shortName)}`;
      if (child.tracker.type === "jira" && child.tracker.key) message += ` <code>${ui.escapeHtml(child.tracker.key)}</code>`;
      message += "\n";
    }
  }

  message += "\nUse <code>/project &lt;name&gt;</code> to switch.";
  await ui.sendMessage(adapter, chatId, message);
  return true;
}

export async function handleProject(
  adapter: PlatformAdapter,
  chatId: string,
  ref?: string,
): Promise<boolean> {
  const numericChatId = Number(chatId);

  if (!ref || !ref.trim()) {
    const active = session.getActiveProject(numericChatId);
    if (active) {
      const p = projects.getProject(active);
      await ui.sendMessage(
        adapter,
        chatId,
        `<b>Active project:</b> ${ui.escapeHtml(active)}\n` +
          (p ? `<i>${ui.escapeHtml(p.path)}</i>` : "<i>(not in registry)</i>") +
          `\n\nUse <code>/project &lt;name&gt;</code> to switch, <code>/projects</code> to list.`,
      );
    } else {
      await ui.sendMessage(
        adapter,
        chatId,
        "<b>No active project.</b>\n\nUse <code>/projects</code> to list, then <code>/project &lt;name&gt;</code> to switch.",
      );
    }
    return true;
  }

  const { project, ambiguous } = projects.resolve(ref.trim());

  if (project) {
    session.setActiveProject(numericChatId, project.name);
    await ui.sendMessage(
      adapter,
      chatId,
      `✅ Active project set to <b>${ui.escapeHtml(project.name)}</b>\n<i>${ui.escapeHtml(project.path)}</i>`,
    );
    return true;
  }

  if (ambiguous.length > 0) {
    const selectionId = `${chatId}_${Date.now()}`;
    pendingProjectPicks.set(selectionId, { chatId: numericChatId, candidates: ambiguous });
    const labels = ambiguous.map(p => p.shortName);
    const keyboard = adapter.ui.buildPickerList("proj", selectionId, labels);
    await adapter.send(chatId, `<b>Which project?</b>\nMultiple matches for <code>${ui.escapeHtml(ref)}</code>:`, {
      rawKeyboard: keyboard,
    });
    // Drop the picker if untouched for 2 minutes
    setTimeout(() => pendingProjectPicks.delete(selectionId), 2 * 60 * 1000);
    return true;
  }

  await ui.sendMessage(adapter, chatId, `No project matches <code>${ui.escapeHtml(ref)}</code>.`);
  return true;
}

/** Handle "proj_<selectionId>_<index|cancel>" callbacks. */
export async function handleProjectCallback(
  adapter: PlatformAdapter,
  chatId: string,
  messageId: string,
  data: string,
): Promise<boolean> {
  const parts = data.split("_");
  if (parts.length < 4) return false;

  const selectionId = `${parts[1]}_${parts[2]}`;
  const action = parts.slice(3).join("_");
  const pending = pendingProjectPicks.get(selectionId);
  if (!pending || pending.chatId !== Number(chatId)) return false;

  if (action === "cancel") {
    pendingProjectPicks.delete(selectionId);
    await adapter.edit(chatId, messageId, "Project selection cancelled.");
    return true;
  }

  const idx = parseInt(action, 10);
  const picked = pending.candidates[idx];
  if (!picked) return false;

  pendingProjectPicks.delete(selectionId);
  session.setActiveProject(pending.chatId, picked.name);
  await adapter.edit(
    chatId,
    messageId,
    `✅ Active project set to <b>${ui.escapeHtml(picked.name)}</b>\n<i>${ui.escapeHtml(picked.path)}</i>`,
  );
  return true;
}

export async function handleAgents(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  const loadErr = agents.getLoadError();
  if (loadErr) {
    await ui.sendMessage(adapter, chatId, `<b>Agents directory not loaded</b>\n<i>${ui.escapeHtml(loadErr)}</i>`);
    return true;
  }

  const pinned = session.getActiveAgent(Number(chatId));
  const list = agents.listAgents();

  if (list.length === 0) {
    await ui.sendMessage(
      adapter,
      chatId,
      `<b>No agents defined</b>\n\nAdd Markdown files to <code>${ui.escapeHtml(agents.getAgentsDir())}</code>.`,
    );
    return true;
  }

  let message = "<b>Agents</b>\n";
  if (pinned) message += `<i>Pinned for next message: ${ui.escapeHtml(pinned)}</i>\n`;
  message += "\n";

  for (const agent of list) {
    const marker = agent.name === pinned ? "▸ " : "• ";
    message += `${marker}<b>${ui.escapeHtml(agent.name)}</b> — ${ui.escapeHtml(agent.description)}\n`;
  }

  message += "\nUse <code>/agent &lt;name&gt;</code> to pin one.";
  await ui.sendMessage(adapter, chatId, message);
  return true;
}

export async function handleDigest(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  await digest.showFullQueue(adapter, chatId);
  return true;
}

export async function handleAgent(
  adapter: PlatformAdapter,
  chatId: string,
  name?: string,
): Promise<boolean> {
  const numericChatId = Number(chatId);

  if (!name || !name.trim()) {
    const pinned = session.getActiveAgent(numericChatId);
    if (pinned) {
      await ui.sendMessage(adapter, chatId, `<b>Pinned agent:</b> ${ui.escapeHtml(pinned)}\n\nUse <code>/agent &lt;name&gt;</code> to change, or <code>/agents</code> to list.`);
    } else {
      await ui.sendMessage(adapter, chatId, "<b>No agent pinned.</b>\n\nUse <code>/agents</code> to list, then <code>/agent &lt;name&gt;</code> to pin one.");
    }
    return true;
  }

  const agent = agents.getAgent(name.trim());
  if (!agent) {
    await ui.sendMessage(adapter, chatId, `No agent named <code>${ui.escapeHtml(name)}</code>. Try <code>/agents</code>.`);
    return true;
  }

  session.setActiveAgent(numericChatId, agent.name);
  await ui.sendMessage(adapter, chatId, `📌 Pinned <b>${ui.escapeHtml(agent.name)}</b> for the next message.`);
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

// Store pending model selections
const pendingModelSelections = new Map<
  string,
  {
    chatId: number;
    resolve: (model: ClaudeModel | null) => void;
  }
>();

export async function handleModel(adapter: PlatformAdapter, chatId: string): Promise<boolean> {
  const numericChatId = Number(chatId);
  const selectionId = `${chatId}_${Date.now()}`;
  const currentModel = session.getModel(numericChatId);
  const currentModelInfo = AVAILABLE_MODELS.find(m => m.id === currentModel);

  // Build keyboard with model options
  const keyboard = ui.buildModelKeyboard(adapter, selectionId, currentModel);

  let message = `<b>Select Model</b>\n\nCurrent: <b>${currentModelInfo?.name || "Unknown"}</b>\n\n`;
  for (const model of AVAILABLE_MODELS) {
    message += `• <b>${model.name}</b>: ${model.description}\n`;
  }

  await adapter.send(chatId, message, { rawKeyboard: keyboard });

  // Wait for selection
  const newModel = await new Promise<ClaudeModel | null>((resolve) => {
    pendingModelSelections.set(selectionId, { chatId: numericChatId, resolve });

    // Timeout after 2 minutes
    setTimeout(() => {
      if (pendingModelSelections.has(selectionId)) {
        pendingModelSelections.delete(selectionId);
        resolve(null);
      }
    }, 2 * 60 * 1000);
  });

  if (newModel) {
    session.setModel(numericChatId, newModel);
  }
  return true;
}

/** Handle model selection callback */
export async function handleModelCallback(
  adapter: PlatformAdapter,
  chatId: string,
  messageId: string,
  data: string
): Promise<boolean> {
  // Parse: model_<chatId>_<timestamp>_<action>
  const parts = data.split("_");
  if (parts.length < 4) return false;

  const selectionId = `${parts[1]}_${parts[2]}`;
  const action = parts.slice(3).join("_");
  const pending = pendingModelSelections.get(selectionId);

  if (!pending || pending.chatId !== Number(chatId)) return false;

  if (action === "cancel") {
    pending.resolve(null);
    pendingModelSelections.delete(selectionId);
    await adapter.edit(chatId, messageId, "Model selection cancelled.");
  } else {
    const modelIndex = parseInt(action, 10);
    const model = AVAILABLE_MODELS[modelIndex];
    if (model) {
      pending.resolve(model.id);
      pendingModelSelections.delete(selectionId);
      await adapter.edit(chatId, messageId, `Model changed to <b>${model.name}</b>`);
    }
  }

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
    case "/model":
      return handleModel(adapter, chatId);
    case "/projects":
      return handleProjects(adapter, chatId);
    case "/project":
      return handleProject(adapter, chatId, args);
    case "/agents":
      return handleAgents(adapter, chatId);
    case "/agent":
      return handleAgent(adapter, chatId, args);
    case "/digest":
      return handleDigest(adapter, chatId);
    case "/restart":
      return handleRestart(adapter, chatId);
    default:
      return false; // Not a recognized command
  }
}
