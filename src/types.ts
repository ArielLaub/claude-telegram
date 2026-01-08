/**
 * Claudine Telegram Bot - Type Definitions
 */

import TelegramBot from "node-telegram-bot-api";

// ============================================================================
// Session Types
// ============================================================================

/** Stored session metadata for history persistence */
export interface StoredSession {
  sessionId: string;
  timestamp: number;
  preview: string;
  name?: string;  // User-defined session name
}

/** Session history file structure */
export interface SessionHistory {
  sessions: StoredSession[];
}

// ============================================================================
// Queue Types
// ============================================================================

/** A queued message waiting to be processed */
export interface QueuedMessage {
  text: string;
  timestamp: number;
  messageId: number;
}

/** Queue status for a chat */
export interface QueueStatus {
  isProcessing: boolean;
  queue: QueuedMessage[];
  abortController: AbortController | null;
}

// ============================================================================
// Question/Approval Types
// ============================================================================

/** Option for AskUserQuestion */
export interface QuestionOption {
  label: string;
  description: string;
}

/** Question structure from Claude SDK */
export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/** Pending question state */
export interface PendingQuestion {
  chatId: number;
  resolve: (answer: string) => void;
  multiSelect: boolean;
  selectedOptions: Set<string>;
  options: QuestionOption[];
}

/** Pending tool approval state */
export interface PendingApproval {
  chatId: number;
  resolve: (approved: boolean) => void;
  toolName: string;
}

// ============================================================================
// UI Types
// ============================================================================

/** A single log entry in the Captain's Log */
export interface LogEntry {
  timestamp: Date;
  action: string;
  icon: string;
}

/** Status message state for progress tracking (Captain's Log) */
export interface StatusMessage {
  messageId: number;
  chatId: number;
  startTime: Date;
  entries: LogEntry[];
  isPaused: boolean;  // True when waiting for user input
  typingInterval?: NodeJS.Timeout;
}

/** Command definition for /help */
export interface Command {
  command: string;
  description: string;
  category: "session" | "mode" | "system";
}

// ============================================================================
// Chat State Types
// ============================================================================

/** Per-chat state tracking */
export interface ChatState {
  sessionId?: string;
  planMode: boolean;
  autoApprovedTools: Set<string>;
  firstMessage?: string;
}

// ============================================================================
// Config Types
// ============================================================================

/** Bot configuration from environment */
export interface BotConfig {
  botToken: string;
  allowedChatId: string;
  workingDir: string;
  anthropicApiKey: string;
}

// ============================================================================
// Constants
// ============================================================================

export const MAX_STORED_SESSIONS = 10;
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const TYPING_INTERVAL_MS = 3000;
export const QUESTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const SESSION_SELECTION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

/** Tools that require user approval */
export const SENSITIVE_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit"];

/** Tools allowed in plan mode (read-only) */
export const PLAN_MODE_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Task"];

/** All available tools */
export const ALL_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Task",
  "AskUserQuestion",
];

/** Command definitions for /help */
export const COMMANDS: Command[] = [
  // Session commands
  { command: "/new", description: "Start a new conversation", category: "session" },
  { command: "/sessions", description: "List and resume recent sessions", category: "session" },
  { command: "/resume", description: "Resume the most recent session", category: "session" },
  { command: "/name", description: "Name the current session", category: "session" },
  { command: "/clear", description: "Clear all session history", category: "session" },
  { command: "/status", description: "Show current session info", category: "session" },

  // Mode commands
  { command: "/plan", description: "Enter plan mode (explore without changes)", category: "mode" },
  { command: "/approve", description: "Approve and execute the plan", category: "mode" },
  { command: "/cancel", description: "Cancel plan mode", category: "mode" },
  { command: "/stop", description: "Stop current operation and clear queue", category: "mode" },

  // System commands
  { command: "/help", description: "Show this help message", category: "system" },
  { command: "/stats", description: "Show system stats (CPU, memory, temp)", category: "system" },
  { command: "/usage", description: "Show Claude API usage limits", category: "system" },
  { command: "/restart", description: "Restart the bot", category: "system" },
];
