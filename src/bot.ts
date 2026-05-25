/**
 * Claudine Bot - Core
 *
 * Platform-agnostic bot logic: message routing, callback handling, queue processing.
 */

import * as path from "path";
import { fileURLToPath } from "url";
import { BotConfig } from "./types.js";
import type { PlatformAdapter, IncomingMessage, CallbackEvent } from "./adapters/types.js";
import * as session from "./session.js";
import * as queue from "./queue.js";
import * as commands from "./commands.js";
import * as claude from "./claude.js";
import * as ui from "./ui.js";
import * as runtimeState from "./runtime-state.js";
import * as scheduler from "./scheduler.js";
import * as digest from "./digest.js";
import * as jira from "./jira.js";

// ============================================================================
// Bot Class
// ============================================================================

export class ClaudineBot {
  private adapter: PlatformAdapter;
  private config: BotConfig;

  constructor(config: BotConfig, adapter: PlatformAdapter) {
    this.config = config;
    this.adapter = adapter;

    this.setupHandlers();
  }

  /** Set up all event handlers */
  private setupHandlers(): void {
    this.adapter.onMessage(this.handleMessage.bind(this));
    this.adapter.onCallback(this.handleCallbackQuery.bind(this));
  }

  /** Check if a chat is allowed */
  private isAllowed(chatId: string): boolean {
    return this.config.allowedChatIds.includes(chatId);
  }

  /** Handle incoming messages */
  private async handleMessage(msg: IncomingMessage): Promise<void> {
    const chatId = msg.chatId;
    const text = msg.text;

    // Security check
    if (!this.isAllowed(chatId)) {
      await this.adapter.send(chatId, "Unauthorized.");
      return;
    }

    if (!text) return;

    // Handle commands first
    if (text.startsWith("/")) {
      const handled = await commands.routeCommand(this.adapter, chatId, text);
      if (handled) return;
      // Unknown command - fall through to treat as message
    }

    // Regular message - check if we're processing
    const numericChatId = Number(chatId);
    if (queue.isProcessing(numericChatId)) {
      // Queue the message instead of rejecting
      queue.enqueueMessage(numericChatId, text, Number(msg.messageId));

      const queueLength = queue.getQueueLength(numericChatId);
      await ui.sendMessage(
        this.adapter,
        chatId,
        `Message queued (${queueLength} in queue). Use /stop to cancel.`
      );
      return;
    }

    // Process this message (and any queued messages)
    await this.processMessages(chatId, text, Number(msg.messageId));
  }

  /** Process a message (and any queued messages) */
  private async processMessages(
    chatId: string,
    initialText: string,
    messageId: number
  ): Promise<void> {
    const numericChatId = Number(chatId);
    queue.setProcessing(numericChatId, true);

    try {
      // Track first message for session preview (only if no session yet)
      if (!session.getSessionId(numericChatId)) {
        session.setFirstMessage(numericChatId, initialText);
      }

      // Build the prompt - include any queued messages
      const queuedMessages = queue.dequeueAllMessages(numericChatId);

      let prompt: string;
      if (queuedMessages.length > 0) {
        // Batch the initial message with queued messages
        const allMessages = [
          { text: initialText, timestamp: Date.now(), messageId },
          ...queuedMessages,
        ];
        prompt = queue.batchMessages(allMessages);
      } else {
        prompt = initialText;
      }

      // Execute the query
      await claude.executeQuery(this.adapter, chatId, prompt, this.config.workingDir);

      // After processing, check if more messages were queued during execution
      if (queue.hasQueuedMessages(numericChatId)) {
        const newMessages = queue.dequeueAllMessages(numericChatId);
        const batchedPrompt = queue.batchMessages(newMessages);

        // Process the new batch
        await claude.executeQuery(this.adapter, chatId, batchedPrompt, this.config.workingDir);
      }
    } finally {
      queue.setProcessing(numericChatId, false);
    }
  }

  /** Handle callback queries (button presses) */
  private async handleCallbackQuery(query: CallbackEvent): Promise<void> {
    const chatId = query.chatId;
    const messageId = query.messageId;
    const data = query.data;

    // Security check
    if (!this.isAllowed(chatId)) {
      await this.adapter.answerCallback(query.id, "Unauthorized");
      return;
    }

    let handled = false;

    // Route to appropriate handler based on prefix
    if (data.startsWith("stop_")) {
      // Handle stop button press
      handled = await commands.handleStop(this.adapter, chatId);
    } else if (data.startsWith("approve_")) {
      handled = await claude.handleApprovalCallback(this.adapter, chatId, messageId, data);
    } else if (data.startsWith("question_")) {
      handled = await claude.handleQuestionCallback(this.adapter, chatId, messageId, data);
    } else if (data.startsWith("session_")) {
      handled = await this.handleSessionCallback(chatId, messageId, data);
    } else if (data.startsWith("model_")) {
      handled = await commands.handleModelCallback(this.adapter, chatId, messageId, data);
    } else if (data.startsWith("proj_")) {
      handled = await commands.handleProjectCallback(this.adapter, chatId, messageId, data);
    }

    // Acknowledge the callback
    await this.adapter.answerCallback(query.id);
  }

  /** Handle session selection callback */
  private async handleSessionCallback(
    chatId: string,
    messageId: string,
    data: string
  ): Promise<boolean> {
    // Parse: session_<chatId>_<timestamp>_<action>
    const parts = data.split("_");
    if (parts.length < 4) return false;

    const action = parts.slice(3).join("_");

    if (action === "cancel") {
      await this.adapter.edit(chatId, messageId, "Session selection cancelled.");
      return true;
    }

    if (action === "new") {
      session.resetChatState(Number(chatId));
      await this.adapter.edit(chatId, messageId, "✨ Started new session. Send a message to begin!");
      return true;
    }

    // It's a session index
    const sessionIndex = parseInt(action, 10);
    if (isNaN(sessionIndex)) return false;

    const history = session.getSessionHistory(Number(chatId));
    const sess = history[sessionIndex];

    if (sess) {
      session.setSessionId(Number(chatId), sess.sessionId);
      const date = new Date(sess.timestamp).toLocaleString();
      await this.adapter.edit(
        chatId,
        messageId,
        `✅ Resumed session from ${date}\n<i>${this.adapter.formatter.escape(sess.preview)}</i>`
      );
      return true;
    }

    return false;
  }

  /** Start the bot */
  start(): void {
    console.log(`Claudine Bot started! (${this.adapter.platformName})`);
    console.log(`Working directory: ${this.config.workingDir}`);
    console.log(`Allowed chat IDs: ${this.config.allowedChatIds.join(", ")}`);

    // Start the adapter
    this.adapter.start();

    // Register bot commands (platform-specific)
    commands.registerBotCommands(this.adapter);

    // Compare current git SHA to last-known to decide whether (and what) to announce.
    // - SHA changed: send a one-line "Updated to <short>: <subject>"
    // - SHA unchanged: stay silent. The user knows how to ping the bot if they want to check.
    // - No git info (e.g. running outside a repo): fall back to the old greeting.
    const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const git = runtimeState.getGitInfo(repoDir);
    const prev = runtimeState.loadState();

    if (!git) {
      for (const chatId of this.config.allowedChatIds) {
        this.adapter.send(chatId, "Claudine is online").catch((err) => {
          console.error(`Failed to send startup message to ${chatId}:`, err);
        });
      }
      return;
    }

    if (git.sha !== prev.gitSha) {
      const message =
        prev.gitSha
          ? `🔄 Updated to <code>${git.shortSha}</code>: <i>${this.adapter.formatter.escape(git.subject)}</i>`
          : `Claudine online at <code>${git.shortSha}</code>: <i>${this.adapter.formatter.escape(git.subject)}</i>`;
      for (const chatId of this.config.allowedChatIds) {
        this.adapter.send(chatId, message, { richFormat: true }).catch((err) => {
          console.error(`Failed to send startup message to ${chatId}:`, err);
        });
      }
      runtimeState.saveState({ gitSha: git.sha, gitSubject: git.subject });
    } else {
      console.log(`Same git SHA as last run (${git.shortSha}); skipping startup message.`);
    }

    // Proactive Jira digest. Skipped silently if Jira isn't configured.
    if (jira.isConfigured()) {
      const intervalEnv = Number(process.env.DIGEST_INTERVAL_MINUTES);
      const intervalMinutes = Number.isFinite(intervalEnv) && intervalEnv > 0 ? intervalEnv : 30;
      scheduler.start(intervalMinutes, [
        {
          name: "jira-digest",
          run: async () => {
            for (const chatId of this.config.allowedChatIds) {
              await digest.runDigest(this.adapter, chatId, false);
            }
          },
        },
      ]);
    } else {
      console.log("[scheduler] Jira not configured; digest scheduler not started.");
    }
  }

  /** Stop the bot */
  stop(): void {
    console.log("Shutting down...");
    scheduler.stop();
    this.adapter.stop();
  }

  /** Get the adapter */
  getAdapter(): PlatformAdapter {
    return this.adapter;
  }
}
