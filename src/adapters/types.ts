/**
 * Platform Adapter Interfaces
 *
 * Abstract interfaces for messaging platforms (Telegram, Slack, Discord, etc.)
 * These interfaces allow the core bot logic to be platform-agnostic.
 */

// ============================================================================
// Message Types (Platform-Agnostic)
// ============================================================================

/** Incoming message from user */
export interface IncomingMessage {
  chatId: string;
  messageId: string;
  text?: string;
  userId?: string;
}

/** Callback event from button press */
export interface CallbackEvent {
  id: string;
  chatId: string;
  messageId: string;
  data: string;
}

/** Sent message reference */
export interface SentMessage {
  messageId: string;
  chatId: string;
}

/** Button definition */
export interface Button {
  label: string;
  callbackData: string;
}

/** Question option for AskUserQuestion */
export interface QuestionOption {
  label: string;
  description: string;
}

/** Stored session for session picker */
export interface StoredSessionInfo {
  sessionId: string;
  timestamp: number;
  preview: string;
  name?: string;
}

// ============================================================================
// Message Options
// ============================================================================

/** Options for sending/editing messages */
export interface MessageOptions {
  /** Keyboard/buttons to attach */
  keyboard?: Button[][];
  /** Raw platform-specific keyboard (for complex cases) */
  rawKeyboard?: unknown;
  /** Whether to use rich formatting (HTML for Telegram, mrkdwn for Slack) */
  richFormat?: boolean;
}

// ============================================================================
// Core Adapter Interface
// ============================================================================

/** Main adapter interface for messaging platforms */
export interface MessageAdapter {
  // ─────────────────────────────────────────────────────────────────────────
  // Sending Messages
  // ─────────────────────────────────────────────────────────────────────────

  /** Send a new message */
  send(chatId: string, text: string, options?: MessageOptions): Promise<SentMessage>;

  /** Edit an existing message */
  edit(
    chatId: string,
    messageId: string,
    text: string,
    options?: MessageOptions
  ): Promise<void>;

  /** Delete a message */
  delete(chatId: string, messageId: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Interactions
  // ─────────────────────────────────────────────────────────────────────────

  /** Send typing indicator (if supported) */
  sendTypingIndicator(chatId: string): Promise<void>;

  /** Acknowledge a callback/button press */
  answerCallback(callbackId: string, text?: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────────

  /** Register handler for incoming messages */
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;

  /** Register handler for callback events (button presses) */
  onCallback(handler: (cb: CallbackEvent) => Promise<void>): void;

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /** Start the adapter (connect, begin polling, etc.) */
  start(): void;

  /** Stop the adapter gracefully */
  stop(): void;
}

// ============================================================================
// UI Builder Interface
// ============================================================================

/** Builds platform-specific UI elements (keyboards, buttons) */
export interface UIBuilder {
  /** Build a stop button for the Captain's Log */
  buildStopButton(chatId: string): unknown;

  /** Build approval buttons (Allow, Allow All, Deny) */
  buildApprovalButtons(approvalId: string): unknown;

  /** Build question buttons for AskUserQuestion */
  buildQuestionButtons(
    questionId: string,
    options: QuestionOption[],
    multiSelect: boolean,
    selectedOptions?: Set<string>
  ): unknown;

  /** Build session selection list */
  buildSessionList(selectionId: string, sessions: StoredSessionInfo[]): unknown;

  /** Build model selection list */
  buildModelList(selectionId: string, currentModel: string): unknown;
}

// ============================================================================
// Text Formatter Interface
// ============================================================================

/** Formats text for the specific platform */
export interface TextFormatter {
  /** Make text bold */
  bold(text: string): string;

  /** Make text italic */
  italic(text: string): string;

  /** Make text monospace/code */
  code(text: string): string;

  /** Create a code block */
  codeBlock(code: string, lang?: string): string;

  /** Create a blockquote */
  quote(text: string): string;

  /** Escape special characters for the platform */
  escape(text: string): string;

  /** Convert Claude's markdown response to platform format */
  formatResponse(markdown: string): string;

  /** Get the parse mode string for API calls (e.g., "HTML" for Telegram) */
  getParseMode(): string | undefined;
}

// ============================================================================
// Combined Platform Adapter
// ============================================================================

/** Complete platform adapter with all capabilities */
export interface PlatformAdapter extends MessageAdapter {
  /** UI element builder */
  ui: UIBuilder;

  /** Text formatter */
  formatter: TextFormatter;

  /** Platform name for logging */
  platformName: string;
}
