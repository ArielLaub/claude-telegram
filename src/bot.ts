/**
 * Claudine Telegram Bot - Bot Core
 *
 * Main bot logic: message routing, callback handling, queue processing.
 */

import TelegramBot from "node-telegram-bot-api";
import { BotConfig } from "./types.js";
import * as session from "./session.js";
import * as queue from "./queue.js";
import * as commands from "./commands.js";
import * as claude from "./claude.js";
import * as ui from "./ui.js";

// ============================================================================
// Bot Class
// ============================================================================

export class ClaudineBot {
  private bot: TelegramBot;
  private config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
    this.bot = new TelegramBot(config.botToken, { polling: true });

    this.setupHandlers();
  }

  /** Set up all event handlers */
  private setupHandlers(): void {
    this.bot.on("message", this.handleMessage.bind(this));
    this.bot.on("callback_query", this.handleCallbackQuery.bind(this));
  }

  /** Check if a chat is allowed */
  private isAllowed(chatId: number): boolean {
    return this.config.allowedChatIds.includes(chatId.toString());
  }

  /** Handle incoming messages */
  private async handleMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Security check
    if (!this.isAllowed(chatId)) {
      await this.bot.sendMessage(chatId, "Unauthorized.");
      return;
    }

    if (!text) return;

    // Handle commands first
    if (text.startsWith("/")) {
      const handled = await commands.routeCommand(this.bot, chatId, text);
      if (handled) return;
      // Unknown command - fall through to treat as message
    }

    // Regular message - check if we're processing
    if (queue.isProcessing(chatId)) {
      // Queue the message instead of rejecting
      queue.enqueueMessage(chatId, text, msg.message_id);

      const queueLength = queue.getQueueLength(chatId);
      await ui.sendMessage(
        this.bot,
        chatId,
        `Message queued (${queueLength} in queue). Use /stop to cancel.`
      );
      return;
    }

    // Process this message (and any queued messages)
    await this.processMessages(chatId, text, msg.message_id);
  }

  /** Process a message (and any queued messages) */
  private async processMessages(
    chatId: number,
    initialText: string,
    messageId: number
  ): Promise<void> {
    queue.setProcessing(chatId, true);

    try {
      // Track first message for session preview (only if no session yet)
      if (!session.getSessionId(chatId)) {
        session.setFirstMessage(chatId, initialText);
      }

      // Build the prompt - include any queued messages
      const queuedMessages = queue.dequeueAllMessages(chatId);

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
      await claude.executeQuery(this.bot, chatId, prompt, this.config.workingDir);

      // After processing, check if more messages were queued during execution
      if (queue.hasQueuedMessages(chatId)) {
        const newMessages = queue.dequeueAllMessages(chatId);
        const batchedPrompt = queue.batchMessages(newMessages);

        // Process the new batch
        await claude.executeQuery(this.bot, chatId, batchedPrompt, this.config.workingDir);
      }
    } finally {
      queue.setProcessing(chatId, false);
    }
  }

  /** Handle callback queries (button presses) */
  private async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    const data = query.data;

    if (!chatId || !messageId || !data) return;

    // Security check
    if (!this.isAllowed(chatId)) {
      await this.bot.answerCallbackQuery(query.id, { text: "Unauthorized" });
      return;
    }

    let handled = false;

    // Route to appropriate handler based on prefix
    if (data.startsWith("stop_")) {
      // Handle stop button press
      handled = await commands.handleStop(this.bot, chatId);
    } else if (data.startsWith("approve_")) {
      handled = await claude.handleApprovalCallback(this.bot, chatId, messageId, data);
    } else if (data.startsWith("question_")) {
      handled = await claude.handleQuestionCallback(this.bot, chatId, messageId, data);
    } else if (data.startsWith("session_")) {
      handled = await this.handleSessionCallback(chatId, messageId, data);
    }

    // Acknowledge the callback
    await this.bot.answerCallbackQuery(query.id);
  }

  /** Handle session selection callback */
  private async handleSessionCallback(
    chatId: number,
    messageId: number,
    data: string
  ): Promise<boolean> {
    // Parse: session_<chatId>_<timestamp>_<action>
    const parts = data.split("_");
    if (parts.length < 4) return false;

    const action = parts.slice(3).join("_");

    if (action === "cancel") {
      await this.bot.editMessageText("Session selection cancelled.", {
        chat_id: chatId,
        message_id: messageId,
      });
      return true;
    }

    if (action === "new") {
      session.resetChatState(chatId);
      await this.bot.editMessageText("✨ Started new session. Send a message to begin!", {
        chat_id: chatId,
        message_id: messageId,
      });
      return true;
    }

    // It's a session index
    const sessionIndex = parseInt(action, 10);
    if (isNaN(sessionIndex)) return false;

    const history = session.getSessionHistory();
    const sess = history[sessionIndex];

    if (sess) {
      session.setSessionId(chatId, sess.sessionId);
      const date = new Date(sess.timestamp).toLocaleString();
      await this.bot.editMessageText(`✅ Resumed session from ${date}\n<i>${ui.escapeHtml(sess.preview)}</i>`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
      });
      return true;
    }

    return false;
  }

  /** Start the bot */
  start(): void {
    console.log("Claudine Telegram Bot started!");
    console.log(`Working directory: ${this.config.workingDir}`);
    console.log(`Allowed chat IDs: ${this.config.allowedChatIds.join(", ")}`);

    // Register bot commands with Telegram menu
    commands.registerBotCommands(this.bot);

    // Send startup message to all allowed chats
    for (const chatId of this.config.allowedChatIds) {
      this.bot.sendMessage(chatId, "Claudine is online").catch((err) => {
        console.error(`Failed to send startup message to ${chatId}:`, err);
      });
    }
  }

  /** Stop the bot */
  stop(): void {
    console.log("Shutting down...");
    this.bot.stopPolling();
  }

  /** Get the underlying TelegramBot instance */
  getBot(): TelegramBot {
    return this.bot;
  }
}
