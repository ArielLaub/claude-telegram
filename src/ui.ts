/**
 * Claudine Bot - UI Helpers
 *
 * Platform-agnostic UI utilities. Uses adapter for platform-specific operations.
 */

import type { PlatformAdapter } from "./adapters/types.js";
import { StatusMessage, LogEntry, TYPING_INTERVAL_MS } from "./types.js";

// Re-export commonly used formatter functions from adapter
// (These will be available once an adapter is set)
export { escapeHtml, truncateText, splitText, formatDuration, formatTokens } from "./adapters/telegram/formatter.js";
import { escapeHtml, TELEGRAM_MESSAGE_LIMIT, formatDuration, formatTokens } from "./adapters/telegram/formatter.js";

// ============================================================================
// Captain's Log - Status Messages
// ============================================================================

/** Active status messages per chat */
const statusMessages = new Map<string, StatusMessage>();

/** Format the Captain's Log message with blockquote actions */
function formatCaptainsLog(status: StatusMessage, formatter: PlatformAdapter["formatter"]): string {
  const duration = formatDuration(status.startTime);
  const pauseIndicator = status.isPaused ? " ⏸️" : "";

  // Token display
  const totalTokens = status.inputTokens + status.outputTokens;
  const tokenDisplay = totalTokens > 0 ? ` · ${formatTokens(totalTokens)} tokens` : "";

  let text = `<b>Claudine</b> · ${duration}${tokenDisplay}${pauseIndicator}\n\n`;

  for (const entry of status.entries) {
    const detailsText = entry.details ? ` ${formatter.escape(entry.details)}` : "";
    text += `<blockquote>${entry.icon} <b>${formatter.escape(entry.action)}</b>${detailsText}</blockquote>\n`;
  }

  // Add waiting indicator if paused
  if (status.isPaused) {
    text += `\n<blockquote>⏸️ <i>Awaiting input...</i></blockquote>`;
  }

  return text;
}

/** Create a new Captain's Log */
export async function createStatusMessage(
  adapter: PlatformAdapter,
  chatId: string,
  initialAction = "Starting"
): Promise<StatusMessage> {
  // Clear any existing status message
  await clearStatusMessage(adapter, chatId);

  const now = new Date();
  const initialEntry: LogEntry = {
    timestamp: now,
    action: initialAction,
    icon: "⏳",
  };

  const status: StatusMessage = {
    messageId: 0, // Will be set after sending
    chatId: Number(chatId),
    startTime: now,
    entries: [initialEntry],
    isPaused: false,
    inputTokens: 0,
    outputTokens: 0,
  };

  const text = formatCaptainsLog(status, adapter.formatter);
  const stopKeyboard = adapter.ui.buildStopButton(chatId);

  const message = await adapter.send(chatId, text, { rawKeyboard: stopKeyboard });
  status.messageId = Number(message.messageId);

  // Start typing indicator interval
  status.typingInterval = setInterval(() => {
    if (!status.isPaused) {
      adapter.sendTypingIndicator(chatId).catch(() => {});
    }
  }, TYPING_INTERVAL_MS);

  statusMessages.set(chatId, status);

  // Also send initial typing action
  await adapter.sendTypingIndicator(chatId).catch(() => {});

  return status;
}

/** Add a new entry to the Captain's Log */
export async function updateStatusMessage(
  adapter: PlatformAdapter,
  chatId: string,
  action: string,
  icon = "⚙️",
  details?: string
): Promise<void> {
  const status = statusMessages.get(chatId);
  if (!status) return;

  // Add new entry
  const entry: LogEntry = {
    timestamp: new Date(),
    action,
    details,
    icon,
  };
  status.entries.push(entry);

  // Format and update the message
  let text = formatCaptainsLog(status, adapter.formatter);

  // Check message limit - if too long, truncate older entries
  while (text.length > TELEGRAM_MESSAGE_LIMIT - 100 && status.entries.length > 5) {
    // Remove oldest entries (keep first "Starting" entry if possible)
    status.entries.splice(1, 1);
    text = formatCaptainsLog(status, adapter.formatter);
  }

  try {
    const stopKeyboard = adapter.ui.buildStopButton(chatId);
    await adapter.edit(chatId, String(status.messageId), text, { rawKeyboard: stopKeyboard });
  } catch {
    // Ignore edit errors (message unchanged or rate limited)
  }
}

/** Update token counts for the status message */
export function updateTokens(chatId: string, inputTokens: number, outputTokens: number): void {
  const status = statusMessages.get(chatId);
  if (!status) return;

  status.inputTokens = inputTokens;
  status.outputTokens = outputTokens;
}

/** Mark the log as paused (waiting for user input) */
export async function pauseStatusMessage(
  adapter: PlatformAdapter,
  chatId: string,
  reason = "Awaiting input"
): Promise<void> {
  const status = statusMessages.get(chatId);
  if (!status) return;

  status.isPaused = true;

  // Add pause entry
  const entry: LogEntry = {
    timestamp: new Date(),
    action: reason,
    icon: "⏸️",
  };
  status.entries.push(entry);

  const text = formatCaptainsLog(status, adapter.formatter);

  try {
    const stopKeyboard = adapter.ui.buildStopButton(chatId);
    await adapter.edit(chatId, String(status.messageId), text, { rawKeyboard: stopKeyboard });
  } catch {
    // Ignore edit errors
  }
}

/** Resume the log after user input */
export async function resumeStatusMessage(
  adapter: PlatformAdapter,
  chatId: string,
  action = "Resuming"
): Promise<void> {
  const status = statusMessages.get(chatId);
  if (!status) return;

  status.isPaused = false;

  // Add resume entry
  const entry: LogEntry = {
    timestamp: new Date(),
    action,
    icon: "▶️",
  };
  status.entries.push(entry);

  const text = formatCaptainsLog(status, adapter.formatter);

  try {
    const stopKeyboard = adapter.ui.buildStopButton(chatId);
    await adapter.edit(chatId, String(status.messageId), text, { rawKeyboard: stopKeyboard });
  } catch {
    // Ignore edit errors
  }
}

/** Get the current status (for context) */
export function getStatusActions(chatId: string): string[] {
  const status = statusMessages.get(chatId);
  return status?.entries.map(e => `${e.icon} ${e.action}${e.details ? ` ${e.details}` : ""}`) || [];
}

/** Finalize the log with completion status (keeps message, stops updates) */
export async function finalizeStatusMessage(
  adapter: PlatformAdapter,
  chatId: string,
  success: boolean,
  summary?: string
): Promise<void> {
  const status = statusMessages.get(chatId);
  if (!status) return;

  // Stop typing interval
  if (status.typingInterval) {
    clearInterval(status.typingInterval);
    status.typingInterval = undefined;
  }

  // Add completion entry
  const entry: LogEntry = {
    timestamp: new Date(),
    action: summary || (success ? "Completed" : "Failed"),
    icon: success ? "✅" : "❌",
  };
  status.entries.push(entry);
  status.isPaused = false;

  // Format final message (without stop button)
  const duration = formatDuration(status.startTime);
  const statusIcon = success ? "✅" : "❌";
  const totalTokens = status.inputTokens + status.outputTokens;
  const tokenDisplay = totalTokens > 0 ? ` · ${formatTokens(totalTokens)} tokens` : "";
  let text = `<b>Claudine</b> · ${duration}${tokenDisplay} ${statusIcon}\n\n`;

  for (const e of status.entries) {
    const detailsText = e.details ? ` ${adapter.formatter.escape(e.details)}` : "";
    text += `<blockquote>${e.icon} <b>${adapter.formatter.escape(e.action)}</b>${detailsText}</blockquote>\n`;
  }

  try {
    await adapter.edit(chatId, String(status.messageId), text);
  } catch {
    // Ignore edit errors
  }

  // Remove from active status messages (but message stays in chat)
  statusMessages.delete(chatId);
}

/** Clear status message completely (delete from chat) */
export async function clearStatusMessage(
  adapter: PlatformAdapter,
  chatId: string
): Promise<void> {
  const status = statusMessages.get(chatId);
  if (!status) return;

  // Stop typing interval
  if (status.typingInterval) {
    clearInterval(status.typingInterval);
  }

  // Delete the status message
  try {
    await adapter.delete(chatId, String(status.messageId));
  } catch {
    // Message might already be deleted
  }

  statusMessages.delete(chatId);
}

// ============================================================================
// Message Sending Helpers
// ============================================================================

/** Send a message, handling length limits and errors */
export async function sendMessage(
  adapter: PlatformAdapter,
  chatId: string,
  text: string,
  options?: { parseMode?: string }
): Promise<{ messageId: string; chatId: string } | null> {
  if (!text.trim()) return null;

  try {
    return await adapter.send(chatId, text, { richFormat: true });
  } catch (error) {
    console.error("Failed to send message:", error);
    return null;
  }
}

/** Send completion message - finalizes log, sends response */
export async function sendCompletionMessage(
  adapter: PlatformAdapter,
  chatId: string,
  text: string
): Promise<{ messageId: string; chatId: string } | null> {
  // Finalize the Captain's Log (keeps it visible with completion status)
  await finalizeStatusMessage(adapter, chatId, true);

  // Format response with nice styling (markdown -> platform format)
  const formattedText = adapter.formatter.formatResponse(text);

  // Send the actual response as a new message
  return await sendMessage(adapter, chatId, formattedText);
}

/** Send error message */
export async function sendErrorMessage(
  adapter: PlatformAdapter,
  chatId: string,
  error: string
): Promise<void> {
  // Finalize the Captain's Log with error status
  await finalizeStatusMessage(adapter, chatId, false, `Error: ${error}`);

  await sendMessage(adapter, chatId, `<b>Error</b>: ${adapter.formatter.escape(error)}`);
}

// ============================================================================
// Tool Display Formatting
// ============================================================================

/** Format tool input for display in approval request */
export function formatToolInput(toolName: string, toolInput: unknown): string {
  let inputDisplay: string;

  if (toolName === "Bash" && typeof toolInput === "object" && toolInput !== null) {
    inputDisplay = (toolInput as { command?: string }).command || JSON.stringify(toolInput, null, 2);
  } else if (toolName === "Edit" || toolName === "Write") {
    const input = toolInput as { file_path?: string };
    inputDisplay = input.file_path || JSON.stringify(toolInput, null, 2);
  } else {
    inputDisplay = JSON.stringify(toolInput, null, 2);
  }

  // Truncate if too long
  if (inputDisplay.length > 500) {
    inputDisplay = inputDisplay.substring(0, 500) + "...";
  }

  return inputDisplay;
}

// ============================================================================
// Keyboard Builder Delegates (for backwards compatibility)
// ============================================================================

/** Build inline keyboard for tool approval */
export function buildApprovalKeyboard(adapter: PlatformAdapter, approvalId: string): unknown {
  return adapter.ui.buildApprovalButtons(approvalId);
}

/** Build inline keyboard for question options */
export function buildQuestionKeyboard(
  adapter: PlatformAdapter,
  questionId: string,
  options: Array<{ label: string; description: string }>,
  multiSelect: boolean,
  selectedOptions?: Set<string>
): unknown {
  return adapter.ui.buildQuestionButtons(questionId, options, multiSelect, selectedOptions);
}

/** Build inline keyboard for session selection */
export function buildSessionKeyboard(
  adapter: PlatformAdapter,
  selectionId: string,
  sessions: Array<{ sessionId: string; timestamp: number; preview: string; name?: string }>
): unknown {
  return adapter.ui.buildSessionList(selectionId, sessions);
}
