/**
 * Claudine Telegram Bot - Message Queue Management
 *
 * Handles message queuing when the bot is busy processing requests.
 * Supports batching multiple messages into a single context.
 */

import { QueuedMessage, QueueStatus } from "./types.js";

// ============================================================================
// Queue State
// ============================================================================

/** Per-chat queue status */
const queueStates = new Map<number, QueueStatus>();

/** Get or create queue status for a chat */
function getQueueStatus(chatId: number): QueueStatus {
  if (!queueStates.has(chatId)) {
    queueStates.set(chatId, {
      isProcessing: false,
      queue: [],
      abortController: null,
    });
  }
  return queueStates.get(chatId)!;
}

// ============================================================================
// Queue Operations
// ============================================================================

/** Check if a chat is currently processing a request */
export function isProcessing(chatId: number): boolean {
  return getQueueStatus(chatId).isProcessing;
}

/** Set processing state for a chat */
export function setProcessing(chatId: number, processing: boolean): void {
  getQueueStatus(chatId).isProcessing = processing;
}

/** Add a message to the queue */
export function enqueueMessage(
  chatId: number,
  text: string,
  messageId: number
): void {
  const status = getQueueStatus(chatId);
  status.queue.push({
    text,
    timestamp: Date.now(),
    messageId,
  });
}

/** Get all queued messages and clear the queue */
export function dequeueAllMessages(chatId: number): QueuedMessage[] {
  const status = getQueueStatus(chatId);
  const messages = [...status.queue];
  status.queue = [];
  return messages;
}

/** Get queue length */
export function getQueueLength(chatId: number): number {
  return getQueueStatus(chatId).queue.length;
}

/** Check if queue has messages */
export function hasQueuedMessages(chatId: number): boolean {
  return getQueueStatus(chatId).queue.length > 0;
}

/** Clear the queue without returning messages */
export function clearQueue(chatId: number): number {
  const status = getQueueStatus(chatId);
  const count = status.queue.length;
  status.queue = [];
  return count;
}

/** Peek at queued messages without removing them */
export function peekQueue(chatId: number): QueuedMessage[] {
  return [...getQueueStatus(chatId).queue];
}

// ============================================================================
// Abort Controller Management
// ============================================================================

/** Set abort controller for current operation */
export function setAbortController(
  chatId: number,
  controller: AbortController
): void {
  getQueueStatus(chatId).abortController = controller;
}

/** Get current abort controller */
export function getAbortController(chatId: number): AbortController | null {
  return getQueueStatus(chatId).abortController;
}

/** Clear abort controller */
export function clearAbortController(chatId: number): void {
  getQueueStatus(chatId).abortController = null;
}

/** Abort current operation if one is running */
export function abortCurrentOperation(chatId: number): boolean {
  const status = getQueueStatus(chatId);
  if (status.abortController) {
    status.abortController.abort();
    status.abortController = null;
    return true;
  }
  return false;
}

// ============================================================================
// Batch Message Formatting
// ============================================================================

/**
 * Combine multiple queued messages into a single prompt.
 * This batches messages sent while the bot was busy.
 */
export function batchMessages(messages: QueuedMessage[]): string {
  if (messages.length === 0) {
    return "";
  }

  if (messages.length === 1) {
    return messages[0].text;
  }

  // Multiple messages - combine with context
  const parts = messages.map((msg, idx) => {
    const relativeTime = formatRelativeTime(msg.timestamp);
    return `[Message ${idx + 1}, ${relativeTime}]\n${msg.text}`;
  });

  return (
    `The user sent ${messages.length} messages while you were processing:\n\n` +
    parts.join("\n\n") +
    "\n\nPlease address all of these messages in your response."
  );
}

/** Format timestamp as relative time */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) {
    return `${seconds}s ago`;
  } else if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  } else {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
}

// ============================================================================
// Queue Status Formatting
// ============================================================================

/** Format queue status for display to user */
export function formatQueueStatus(chatId: number): string {
  const status = getQueueStatus(chatId);
  const count = status.queue.length;

  if (count === 0) {
    return "";
  }

  if (count === 1) {
    return "1 message queued";
  }

  return `${count} messages queued`;
}
