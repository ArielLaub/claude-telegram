/**
 * Telegram Adapter
 *
 * Implements the PlatformAdapter interface for Telegram.
 */

import TelegramBot from "node-telegram-bot-api";
import type {
  PlatformAdapter,
  MessageAdapter,
  IncomingMessage,
  CallbackEvent,
  SentMessage,
  MessageOptions,
} from "../types.js";
import { TelegramUIBuilder } from "./keyboards.js";
import { TelegramFormatter, splitText } from "./formatter.js";

export class TelegramAdapter implements PlatformAdapter {
  private bot: TelegramBot;
  public ui: TelegramUIBuilder;
  public formatter: TelegramFormatter;
  public platformName = "telegram";

  constructor(token: string) {
    this.bot = new TelegramBot(token, { polling: true });
    this.ui = new TelegramUIBuilder();
    this.formatter = new TelegramFormatter();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Sending Messages
  // ─────────────────────────────────────────────────────────────────────────

  async send(chatId: string, text: string, options?: MessageOptions): Promise<SentMessage> {
    const sendOptions: TelegramBot.SendMessageOptions = {
      parse_mode: this.formatter.getParseMode() as "HTML",
    };

    if (options?.rawKeyboard) {
      sendOptions.reply_markup = options.rawKeyboard as TelegramBot.InlineKeyboardMarkup;
    }

    // Handle long messages by splitting
    const chunks = splitText(text);
    let lastMsg: TelegramBot.Message | null = null;

    for (const chunk of chunks) {
      lastMsg = await this.bot.sendMessage(Number(chatId), chunk, sendOptions);
    }

    return {
      messageId: String(lastMsg!.message_id),
      chatId: String(lastMsg!.chat.id),
    };
  }

  async edit(
    chatId: string,
    messageId: string,
    text: string,
    options?: MessageOptions
  ): Promise<void> {
    const editOptions: TelegramBot.EditMessageTextOptions = {
      chat_id: Number(chatId),
      message_id: Number(messageId),
      parse_mode: this.formatter.getParseMode() as "HTML",
    };

    if (options?.rawKeyboard) {
      editOptions.reply_markup = options.rawKeyboard as TelegramBot.InlineKeyboardMarkup;
    }

    await this.bot.editMessageText(text, editOptions);
  }

  async delete(chatId: string, messageId: string): Promise<void> {
    await this.bot.deleteMessage(Number(chatId), Number(messageId));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Interactions
  // ─────────────────────────────────────────────────────────────────────────

  async sendTypingIndicator(chatId: string): Promise<void> {
    await this.bot.sendChatAction(Number(chatId), "typing");
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.bot.answerCallbackQuery(callbackId, text ? { text } : undefined);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────────

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.bot.on("message", async (msg: TelegramBot.Message) => {
      await handler({
        chatId: String(msg.chat.id),
        messageId: String(msg.message_id),
        text: msg.text,
        userId: msg.from?.id ? String(msg.from.id) : undefined,
      });
    });
  }

  onCallback(handler: (cb: CallbackEvent) => Promise<void>): void {
    this.bot.on("callback_query", async (query: TelegramBot.CallbackQuery) => {
      if (!query.message || !query.data) return;

      await handler({
        id: query.id,
        chatId: String(query.message.chat.id),
        messageId: String(query.message.message_id),
        data: query.data,
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  start(): void {
    console.log(`[${this.platformName}] Adapter started`);
  }

  stop(): void {
    this.bot.stopPolling();
    console.log(`[${this.platformName}] Adapter stopped`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Telegram-Specific Methods (for advanced use cases)
  // ─────────────────────────────────────────────────────────────────────────

  /** Get the underlying TelegramBot instance (for edge cases) */
  getRawBot(): TelegramBot {
    return this.bot;
  }

  /** Edit message reply markup only */
  async editReplyMarkup(
    chatId: string,
    messageId: string,
    keyboard: TelegramBot.InlineKeyboardMarkup
  ): Promise<void> {
    await this.bot.editMessageReplyMarkup(keyboard, {
      chat_id: Number(chatId),
      message_id: Number(messageId),
    });
  }

  /** Register command handler with Telegram menu */
  async registerCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    try {
      await (this.bot as any).setMyCommands(commands);
      console.log(`[${this.platformName}] Commands registered:`, commands.map(c => c.command).join(", "));
    } catch (error) {
      console.error(`[${this.platformName}] Failed to register commands:`, error);
    }
  }

  /** Remove one-time listener (for custom answer handling) */
  removeMessageListener(handler: (msg: TelegramBot.Message) => void): void {
    this.bot.removeListener("message", handler);
  }

  /** Add one-time message listener */
  addMessageListener(handler: (msg: TelegramBot.Message) => void): void {
    this.bot.on("message", handler);
  }
}

// Re-export types and utilities
export { TelegramUIBuilder } from "./keyboards.js";
export { TelegramFormatter, splitText, truncateText, formatDuration, formatTokens } from "./formatter.js";
export { TELEGRAM_MESSAGE_LIMIT } from "./formatter.js";
