/**
 * Telegram Keyboard Builders
 *
 * Creates Telegram-specific InlineKeyboardMarkup structures.
 */

import TelegramBot from "node-telegram-bot-api";
import type { UIBuilder, QuestionOption, StoredSessionInfo } from "../types.js";
import { AVAILABLE_MODELS } from "../../types.js";

/** Telegram implementation of UIBuilder */
export class TelegramUIBuilder implements UIBuilder {
  /** Build a stop button for the Captain's Log */
  buildStopButton(chatId: string): TelegramBot.InlineKeyboardMarkup {
    return {
      inline_keyboard: [[{ text: "🛑 Stop", callback_data: `stop_${chatId}` }]],
    };
  }

  /** Build approval buttons (Allow, Allow All, Deny) */
  buildApprovalButtons(approvalId: string): TelegramBot.InlineKeyboardMarkup {
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

  /** Build question buttons for AskUserQuestion */
  buildQuestionButtons(
    questionId: string,
    options: QuestionOption[],
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

  /** Build session selection list */
  buildSessionList(
    selectionId: string,
    sessions: StoredSessionInfo[]
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

  /** Build model selection list */
  buildModelList(
    selectionId: string,
    currentModel: string
  ): TelegramBot.InlineKeyboardMarkup {
    const keyboard: TelegramBot.InlineKeyboardButton[][] = AVAILABLE_MODELS.map(
      (model, idx) => [
        {
          text: model.id === currentModel ? `✓ ${model.name}` : model.name,
          callback_data: `model_${selectionId}_${idx}`,
        },
      ]
    );

    keyboard.push([
      { text: "❌ Cancel", callback_data: `model_${selectionId}_cancel` },
    ]);

    return { inline_keyboard: keyboard };
  }

  /** Generic single-pick list with a Cancel button. */
  buildPickerList(
    prefix: string,
    selectionId: string,
    labels: string[],
    cancelLabel = "Cancel",
  ): TelegramBot.InlineKeyboardMarkup {
    const keyboard: TelegramBot.InlineKeyboardButton[][] = labels.map((label, idx) => [
      { text: label, callback_data: `${prefix}_${selectionId}_${idx}` },
    ]);
    keyboard.push([
      { text: `❌ ${cancelLabel}`, callback_data: `${prefix}_${selectionId}_cancel` },
    ]);
    return { inline_keyboard: keyboard };
  }
}
