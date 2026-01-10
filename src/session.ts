/**
 * Claudine Telegram Bot - Session Management
 *
 * Handles session persistence, history, and per-chat state tracking.
 */

import * as fs from "fs";
import * as path from "path";
import {
  StoredSession,
  SessionHistory,
  ChatState,
  VerbosityLevel,
  ClaudeModel,
  DEFAULT_MODEL,
  MAX_STORED_SESSIONS,
} from "./types.js";

// ============================================================================
// Session File Persistence
// ============================================================================

const SESSION_FILE = path.join(
  process.env.HOME || "/tmp",
  ".claude-telegram-sessions.json"
);

/** Load session history from disk */
export function loadSessionHistory(): SessionHistory {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = fs.readFileSync(SESSION_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to load session history:", error);
  }
  return { sessions: [] };
}

/** Save session history to disk */
export function saveSessionHistory(history: SessionHistory): void {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error("Failed to save session history:", error);
  }
}

/** Add or update a session in history */
export function addSessionToHistory(chatId: number, sessionId: string, preview: string): void {
  const history = loadSessionHistory();

  // Remove if already exists (to update timestamp)
  history.sessions = history.sessions.filter((s) => s.sessionId !== sessionId);

  // Add to front
  history.sessions.unshift({
    sessionId,
    chatId,
    timestamp: Date.now(),
    preview: preview.substring(0, 100) + (preview.length > 100 ? "..." : ""),
  });

  // Keep only last N sessions
  history.sessions = history.sessions.slice(0, MAX_STORED_SESSIONS);

  saveSessionHistory(history);
}

/** Get stored sessions for a specific chat */
export function getSessionHistory(chatId: number): StoredSession[] {
  return loadSessionHistory().sessions.filter((s) => s.chatId === chatId);
}

/** Clear all session history */
export function clearSessionHistory(): void {
  saveSessionHistory({ sessions: [] });
}

/** Set a custom name for a session */
export function setSessionName(sessionId: string, name: string): boolean {
  const history = loadSessionHistory();
  const session = history.sessions.find((s) => s.sessionId === sessionId);

  if (session) {
    session.name = name;
    saveSessionHistory(history);
    return true;
  }
  return false;
}

/** Get session by ID */
export function getSessionById(sessionId: string): StoredSession | undefined {
  const history = loadSessionHistory();
  return history.sessions.find((s) => s.sessionId === sessionId);
}

// ============================================================================
// Per-Chat State Management
// ============================================================================

/** In-memory state for each chat */
const chatStates = new Map<number, ChatState>();

/** Get or create chat state */
export function getChatState(chatId: number): ChatState {
  if (!chatStates.has(chatId)) {
    chatStates.set(chatId, {
      planMode: false,
      autoApprovedTools: new Set(),
      verbosity: "normal",
      model: DEFAULT_MODEL,
    });
  }
  return chatStates.get(chatId)!;
}

/** Reset chat state (for /new command) */
export function resetChatState(chatId: number): void {
  const currentVerbosity = chatStates.get(chatId)?.verbosity || "normal";
  const currentModel = chatStates.get(chatId)?.model || DEFAULT_MODEL;
  chatStates.set(chatId, {
    planMode: false,
    autoApprovedTools: new Set(),
    verbosity: currentVerbosity,  // Preserve verbosity across sessions
    model: currentModel,  // Preserve model across sessions
  });
}

/** Set session ID for a chat */
export function setSessionId(chatId: number, sessionId: string): void {
  const state = getChatState(chatId);
  state.sessionId = sessionId;
}

/** Get session ID for a chat */
export function getSessionId(chatId: number): string | undefined {
  return getChatState(chatId).sessionId;
}

/** Clear session ID (but keep other state) */
export function clearSessionId(chatId: number): void {
  const state = getChatState(chatId);
  state.sessionId = undefined;
}

/** Set plan mode for a chat */
export function setPlanMode(chatId: number, enabled: boolean): void {
  getChatState(chatId).planMode = enabled;
}

/** Check if chat is in plan mode */
export function isPlanMode(chatId: number): boolean {
  return getChatState(chatId).planMode;
}

/** Add tool to auto-approved list */
export function addAutoApprovedTool(chatId: number, toolName: string): void {
  getChatState(chatId).autoApprovedTools.add(toolName);
}

/** Check if tool is auto-approved */
export function isToolAutoApproved(chatId: number, toolName: string): boolean {
  return getChatState(chatId).autoApprovedTools.has(toolName);
}

/** Get all auto-approved tools for a chat */
export function getAutoApprovedTools(chatId: number): string[] {
  return Array.from(getChatState(chatId).autoApprovedTools);
}

/** Clear auto-approved tools */
export function clearAutoApprovedTools(chatId: number): void {
  getChatState(chatId).autoApprovedTools.clear();
}

/** Set first message for session preview */
export function setFirstMessage(chatId: number, message: string): void {
  getChatState(chatId).firstMessage = message;
}

/** Get first message for session preview */
export function getFirstMessage(chatId: number): string | undefined {
  return getChatState(chatId).firstMessage;
}

/** Set verbosity level for a chat */
export function setVerbosity(chatId: number, level: VerbosityLevel): void {
  getChatState(chatId).verbosity = level;
}

/** Get verbosity level for a chat */
export function getVerbosity(chatId: number): VerbosityLevel {
  return getChatState(chatId).verbosity || "normal";
}

/** Set model for a chat */
export function setModel(chatId: number, model: ClaudeModel): void {
  getChatState(chatId).model = model;
}

/** Get model for a chat */
export function getModel(chatId: number): ClaudeModel {
  return getChatState(chatId).model || DEFAULT_MODEL;
}
