/**
 * Telegram Text Formatter
 *
 * Formats text for Telegram using HTML mode.
 */

import type { TextFormatter } from "../types.js";

/** Telegram message length limit */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Telegram implementation of TextFormatter */
export class TelegramFormatter implements TextFormatter {
  /** Make text bold */
  bold(text: string): string {
    return `<b>${this.escape(text)}</b>`;
  }

  /** Make text italic */
  italic(text: string): string {
    return `<i>${this.escape(text)}</i>`;
  }

  /** Make text monospace/code */
  code(text: string): string {
    return `<code>${this.escape(text)}</code>`;
  }

  /** Create a code block */
  codeBlock(code: string, _lang?: string): string {
    return `<pre>${this.escape(code)}</pre>`;
  }

  /** Create a blockquote */
  quote(text: string): string {
    return `<blockquote>${text}</blockquote>`;
  }

  /** Escape special characters for Telegram HTML */
  escape(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /** Convert Claude's markdown response to Telegram HTML */
  formatResponse(text: string): string {
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

  /** Get the parse mode string for Telegram API */
  getParseMode(): string {
    return "HTML";
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Escape special characters for Telegram HTML (standalone function) */
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
    if (splitIndex < maxLength / 2) {
      // No good newline, split at space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex < maxLength / 2) {
      // No good split point, hard split
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}

/** Format elapsed duration */
export function formatDuration(startTime: Date): string {
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
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}
