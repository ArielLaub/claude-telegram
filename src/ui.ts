/**
 * Claudine Telegram Bot - UI Helpers
 *
 * Telegram-specific UI utilities: formatting, keyboards, status messages.
 */

import TelegramBot from "node-telegram-bot-api";
import { StatusMessage, LogEntry, TELEGRAM_MESSAGE_LIMIT, TYPING_INTERVAL_MS } from "./types.js";

// ============================================================================
// Text Formatting
// ============================================================================

/** Escape special characters for Telegram Markdown (legacy) */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

/** Escape special characters for Telegram HTML */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Truncate text to fit Telegram's message limit */
export function truncateText(text: string, maxLength = TELEGRAM_MESSAGE_LIMIT): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 20) + "\n\n... (truncated)";
}

/** Split long text into chunks for multiple messages */
export function splitText(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // No good newline, split at space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // No good space either, hard split
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}

// ============================================================================
// Captain's Log - Status Messages
// ============================================================================

/** Active status messages per chat */
const statusMessages = new Map<number, StatusMessage>();

/** Build stop button keyboard */
function buildStopKeyboard(chatId: number): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: "🛑 Stop", callback_data: `stop_${chatId}` }]],
  };
}

/** Format elapsed duration */
function formatDuration(startTime: Date): string {
  const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
  if (elapsed < 60) {
    return `${elapsed}s`;
  } else if (elapsed < 3600) {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    const hours = Math.floor(elapsed / 3600);
    const mins = Math.floor((elapsed % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}

/** Format token count (e.g., 1234 -> "1.2k") */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}

/** Format the Captain's Log message with blockquote actions */
function formatCaptainsLog(status: StatusMessage): string {
  const duration = formatDuration(status.startTime);
  const pauseIndicator = status.isPaused ? " ⏸️" : "";

  // Token display
  const totalTokens = status.inputTokens + status.outputTokens;
  const tokenDisplay = totalTokens > 0 ? ` · ${formatTokens(totalTokens)} tokens` : "";

  let text = `<b>Claude</b> · ${duration}${tokenDisplay}${pauseIndicator}\n\n`;

  for (const entry of status.entries) {
    const detailsText = entry.details ? ` ${escapeHtml(entry.details)}` : "";
    text += `<blockquote>${entry.icon} <b>${escapeHtml(entry.action)}</b>${detailsText}</blockquote>\n`;
  }

  // Add waiting indicator if paused
  if (status.isPaused) {
    text += `\n<blockquote>⏸️ <i>Awaiting input...</i></blockquote>`;
  }

  return text;
}

/** Create a new Captain's Log */
export async function createStatusMessage(
  bot: TelegramBot,
  chatId: number,
  initialAction = "Starting"
): Promise<StatusMessage> {
  // Clear any existing status message
  await clearStatusMessage(bot, chatId);

  const now = new Date();
  const initialEntry: LogEntry = {
    timestamp: now,
    action: initialAction,
    icon: "⏳",
  };

  const status: StatusMessage = {
    messageId: 0, // Will be set after sending
    chatId,
    startTime: now,
    entries: [initialEntry],
    isPaused: false,
    inputTokens: 0,
    outputTokens: 0,
  };

  const text = formatCaptainsLog(status);
  const message = await bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: buildStopKeyboard(chatId),
  });

  status.messageId = message.message_id;

  // Start typing indicator interval
  status.typingInterval = setInterval(() => {
    if (!status.isPaused) {
      bot.sendChatAction(chatId, "typing").catch(() => {});
    }
  }, TYPING_INTERVAL_MS);

  statusMessages.set(chatId, status);

  // Also send initial typing action
  await bot.sendChatAction(chatId, "typing").catch(() => {});

  return status;
}

/** Add a new entry to the Captain's Log */
export async function updateStatusMessage(
  bot: TelegramBot,
  chatId: number,
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
  let text = formatCaptainsLog(status);

  // Check Telegram limit - if too long, truncate older entries
  while (text.length > TELEGRAM_MESSAGE_LIMIT - 100 && status.entries.length > 5) {
    // Remove oldest entries (keep first "Starting" entry if possible)
    status.entries.splice(1, 1);
    text = formatCaptainsLog(status);
  }

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: status.messageId,
      parse_mode: "HTML",
      reply_markup: buildStopKeyboard(chatId),
    });
  } catch {
    // Ignore edit errors (message unchanged or rate limited)
  }
}

/** Update token counts for the status message */
export function updateTokens(chatId: number, inputTokens: number, outputTokens: number): void {
  const status = statusMessages.get(chatId);
  if (!status) return;

  status.inputTokens = inputTokens;
  status.outputTokens = outputTokens;
}

/** Mark the log as paused (waiting for user input) */
export async function pauseStatusMessage(
  bot: TelegramBot,
  chatId: number,
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

  const text = formatCaptainsLog(status);

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: status.messageId,
      parse_mode: "HTML",
      reply_markup: buildStopKeyboard(chatId),
    });
  } catch {
    // Ignore edit errors
  }
}

/** Resume the log after user input */
export async function resumeStatusMessage(
  bot: TelegramBot,
  chatId: number,
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

  const text = formatCaptainsLog(status);

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: status.messageId,
      parse_mode: "HTML",
      reply_markup: buildStopKeyboard(chatId),
    });
  } catch {
    // Ignore edit errors
  }
}

/** Get the current status (for context) */
export function getStatusActions(chatId: number): string[] {
  const status = statusMessages.get(chatId);
  return status?.entries.map(e => `${e.icon} ${e.action}${e.details ? ` ${e.details}` : ""}`) || [];
}

/** Finalize the log with completion status (keeps message, stops updates) */
export async function finalizeStatusMessage(
  bot: TelegramBot,
  chatId: number,
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
  let text = `<b>Claude</b> · ${duration}${tokenDisplay} ${statusIcon}\n\n`;

  for (const e of status.entries) {
    const detailsText = e.details ? ` ${escapeHtml(e.details)}` : "";
    text += `<blockquote>${e.icon} <b>${escapeHtml(e.action)}</b>${detailsText}</blockquote>\n`;
  }

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: status.messageId,
      parse_mode: "HTML",
      // Remove the stop button on completion
    });
  } catch {
    // Ignore edit errors
  }

  // Remove from active status messages (but message stays in chat)
  statusMessages.delete(chatId);
}

/** Clear status message completely (delete from chat) */
export async function clearStatusMessage(
  bot: TelegramBot,
  chatId: number
): Promise<void> {
  const status = statusMessages.get(chatId);
  if (!status) return;

  // Stop typing interval
  if (status.typingInterval) {
    clearInterval(status.typingInterval);
  }

  // Delete the status message
  try {
    await bot.deleteMessage(chatId, status.messageId);
  } catch {
    // Message might already be deleted
  }

  statusMessages.delete(chatId);
}

// ============================================================================
// Keyboard Builders
// ============================================================================

/** Build inline keyboard for tool approval */
export function buildApprovalKeyboard(
  approvalId: string
): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Allow", callback_data: `approve_yes_${approvalId}` },
        { text: "Allow All", callback_data: `approve_all_${approvalId}` },
        { text: "Deny", callback_data: `approve_no_${approvalId}` },
      ],
    ],
  };
}

/** Build inline keyboard for question options */
export function buildQuestionKeyboard(
  questionId: string,
  options: Array<{ label: string }>,
  multiSelect: boolean,
  selectedOptions: Set<string> = new Set()
): TelegramBot.InlineKeyboardMarkup {
  const keyboard: TelegramBot.InlineKeyboardButton[][] = options.map(
    (opt, idx) => [
      {
        text: multiSelect && selectedOptions.has(opt.label) ? `✓ ${opt.label}` : opt.label,
        callback_data: `question_${questionId}_${idx}`,
      },
    ]
  );

  // Add "Other" option
  keyboard.push([
    { text: "Other (type answer)", callback_data: `question_${questionId}_other` },
  ]);

  // For multi-select, add "Done" button
  if (multiSelect) {
    keyboard.push([
      { text: "Done", callback_data: `question_${questionId}_done` },
    ]);
  }

  return { inline_keyboard: keyboard };
}

/** Build inline keyboard for session selection */
export function buildSessionKeyboard(
  selectionId: string,
  sessions: Array<{ timestamp: number; preview: string; name?: string }>
): TelegramBot.InlineKeyboardMarkup {
  const keyboard: TelegramBot.InlineKeyboardButton[][] = sessions
    .slice(0, 5)
    .map((session, idx) => {
      const date = new Date(session.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      // Show name if available, otherwise truncated preview
      const label = session.name
        ? `${timeStr}: ${session.name.substring(0, 30)}`
        : `${timeStr}: ${session.preview.substring(0, 25)}...`;
      return [
        {
          text: label,
          callback_data: `session_${selectionId}_${idx}`,
        },
      ];
    });

  keyboard.push([
    { text: "✨ New Session", callback_data: `session_${selectionId}_new` },
    { text: "Cancel", callback_data: `session_${selectionId}_cancel` },
  ]);

  return { inline_keyboard: keyboard };
}

// ============================================================================
// Message Sending Helpers
// ============================================================================

/** Send a message, handling length limits and errors */
export async function sendMessage(
  bot: TelegramBot,
  chatId: number,
  text: string,
  options: TelegramBot.SendMessageOptions = {}
): Promise<TelegramBot.Message | null> {
  if (!text.trim()) return null;

  try {
    const chunks = splitText(text);
    let lastMsg: TelegramBot.Message | null = null;

    for (const chunk of chunks) {
      lastMsg = await bot.sendMessage(chatId, chunk, options);
    }

    return lastMsg;
  } catch (error) {
    console.error("Failed to send message:", error);
    return null;
  }
}

/** Convert Claude's markdown response to Telegram HTML */
function formatClaudeResponse(text: string): string {
  if (!text.trim()) return "";

  let html = text;

  // Escape HTML first (but preserve markdown)
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Convert markdown code blocks to HTML
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    return `<pre>${code.trim()}</pre>`;
  });

  // Convert inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Convert bold (**text** or __text__)
  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  html = html.replace(/__([^_]+)__/g, "<b>$1</b>");

  // Convert italic (*text* or _text_) - careful not to match inside words
  html = html.replace(/(?<![*\w])\*([^*]+)\*(?![*\w])/g, "<i>$1</i>");
  html = html.replace(/(?<![_\w])_([^_]+)_(?![_\w])/g, "<i>$1</i>");

  return html;
}

/** Send completion message - finalizes log, sends response */
export async function sendCompletionMessage(
  bot: TelegramBot,
  chatId: number,
  text: string,
  options: TelegramBot.SendMessageOptions = {}
): Promise<TelegramBot.Message | null> {
  // Finalize the Captain's Log (keeps it visible with completion status)
  await finalizeStatusMessage(bot, chatId, true);

  // Format response with nice styling (markdown -> HTML)
  const formattedText = formatClaudeResponse(text);

  // Send the actual response as a new message
  const responseMsg = await sendMessage(bot, chatId, formattedText, {
    ...options,
    parse_mode: "HTML",
  });

  return responseMsg;
}

/** Send error message */
export async function sendErrorMessage(
  bot: TelegramBot,
  chatId: number,
  error: string
): Promise<void> {
  // Finalize the Captain's Log with error status
  await finalizeStatusMessage(bot, chatId, false, `Error: ${error}`);

  await sendMessage(bot, chatId, `<b>Error</b>: ${escapeHtml(error)}`, {
    parse_mode: "HTML",
  });
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
