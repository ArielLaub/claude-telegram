/**
 * Claudine Telegram Bot - Claude SDK Integration
 *
 * Handles communication with Claude via the Agent SDK, including
 * context setup, tool handling, and response streaming.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import TelegramBot from "node-telegram-bot-api";
import {
  Question,
  PendingQuestion,
  PendingApproval,
  VerbosityLevel,
  SENSITIVE_TOOLS,
  PLAN_MODE_TOOLS,
  ALL_TOOLS,
  APPROVAL_TIMEOUT_MS,
  QUESTION_TIMEOUT_MS,
} from "./types.js";
import * as session from "./session.js";
import * as queue from "./queue.js";
import * as ui from "./ui.js";

// ============================================================================
// Pending Operations Storage
// ============================================================================

const pendingApprovals = new Map<string, PendingApproval>();
const pendingQuestions = new Map<string, PendingQuestion>();

// Counter to ensure unique question IDs even if Date.now() returns same value
let questionCounter = 0;

// ============================================================================
// System Context for Claude
// ============================================================================

/** Generate system context to help Claude format responses for Telegram */
function getTelegramContext(workingDir: string): string {
  return `You are Claudine, a Claude-powered assistant running as a Telegram bot on a Raspberry Pi.

UI Guidelines for Telegram:
- Format responses for mobile Telegram chat (small screens)
- Use Telegram Markdown: *bold*, _italic_, \`code\`, \`\`\`codeblock\`\`\`
- Prefer bullet points and short paragraphs over ASCII tables
- Keep responses concise but complete - avoid unnecessary verbosity
- For code snippets, use fenced code blocks with language hints
- Avoid ASCII art, wide tables, or content that wraps poorly on mobile
- Use emojis sparingly for visual cues when appropriate

Progress Updates (IMPORTANT):
- When using tools, ALWAYS provide detailed descriptions of what you're doing
- Include the "description" parameter for Bash commands explaining the action
- When reading/searching files, mention specific file paths or patterns
- Before each tool use, briefly explain your reasoning or what you're looking for
- Example: Instead of just using Glob, say "Searching for TypeScript files in the src directory to understand the project structure"
- This helps the user understand your thought process in real-time

Environment:
- Working directory: ${workingDir}
- User can send /stop to cancel operations at any time
- Multiple messages may be batched if user sends while you're processing

Be helpful, direct, and mindful of the mobile chat interface.`;
}

/** Track actions performed during a query for context */
const queryActions = new Map<number, string[]>();

/** Add action to query context */
export function addQueryAction(chatId: number, action: string): void {
  if (!queryActions.has(chatId)) {
    queryActions.set(chatId, []);
  }
  queryActions.get(chatId)!.push(action);
}

/** Get and clear query actions */
function getAndClearQueryActions(chatId: number): string[] {
  const actions = queryActions.get(chatId) || [];
  queryActions.delete(chatId);
  return actions;
}

/** Format actions into a summary */
function formatActionsSummary(actions: string[]): string {
  if (actions.length === 0) return "";

  // Group and deduplicate similar actions
  const summary: string[] = [];
  let lastTool = "";
  let toolCount = 0;

  for (const action of actions) {
    const tool = action.split(" ")[0];
    if (tool === lastTool) {
      toolCount++;
    } else {
      if (lastTool && toolCount > 1) {
        summary.push(`${lastTool} (×${toolCount})`);
      } else if (lastTool) {
        summary.push(lastTool);
      }
      lastTool = tool;
      toolCount = 1;
    }
  }
  if (lastTool) {
    if (toolCount > 1) {
      summary.push(`${lastTool} (×${toolCount})`);
    } else {
      summary.push(lastTool);
    }
  }

  return summary.join(" → ");
}

/** Tool action with icon and description separated for Captain's Log */
interface ToolAction {
  icon: string;
  action: string;    // Bold action name
  details?: string;  // Non-bold details
  skip?: boolean;    // If true, don't show this action in the log
}

/** Tools that are skipped in low verbosity mode */
const LOW_VERBOSITY_SKIP_TOOLS = ["Read", "Glob", "Grep"];

/** Format tool action with detailed description based on verbosity level */
function formatToolAction(
  toolName: string,
  input: Record<string, unknown>,
  verbosity: VerbosityLevel
): ToolAction {
  // Low verbosity: skip read-only tools entirely
  if (verbosity === "low" && LOW_VERBOSITY_SKIP_TOOLS.includes(toolName)) {
    return { icon: "", action: "", skip: true };
  }

  switch (toolName) {
    case "Bash": {
      const desc = input.description as string | undefined;
      const cmd = input.command as string | undefined;

      if (verbosity === "low") {
        return { icon: "🔧", action: "Running command" };
      }
      if (verbosity === "high" && cmd) {
        const truncCmd = cmd.length > 80 ? cmd.substring(0, 80) + "..." : cmd;
        return { icon: "🔧", action: "Running", details: `$ ${truncCmd}` };
      }
      if (desc) {
        return { icon: "🔧", action: desc };
      }
      if (cmd) {
        const shortCmd = cmd.split(" ")[0];
        return { icon: "🔧", action: "Running", details: shortCmd };
      }
      return { icon: "🔧", action: "Executing command" };
    }

    case "Read": {
      const path = input.file_path as string | undefined;
      if (verbosity === "high" && path) {
        const lines = input.limit as number | undefined;
        const lineInfo = lines ? ` (${lines} lines)` : "";
        return { icon: "📖", action: "Reading", details: `${path}${lineInfo}` };
      }
      if (path) {
        const filename = path.split("/").pop() || path;
        return { icon: "📖", action: "Reading", details: filename };
      }
      return { icon: "📖", action: "Reading file" };
    }

    case "Write": {
      const path = input.file_path as string | undefined;
      if (verbosity === "low") {
        return { icon: "✏️", action: "Writing file" };
      }
      if (path) {
        const filename = path.split("/").pop() || path;
        return { icon: "✏️", action: "Writing", details: filename };
      }
      return { icon: "✏️", action: "Writing file" };
    }

    case "Edit": {
      const path = input.file_path as string | undefined;
      if (verbosity === "low") {
        return { icon: "✏️", action: "Editing file" };
      }
      if (verbosity === "high" && path) {
        const oldStr = input.old_string as string | undefined;
        const newStr = input.new_string as string | undefined;
        const filename = path.split("/").pop() || path;
        if (oldStr && newStr) {
          const oldPreview = oldStr.length > 30 ? oldStr.substring(0, 30) + "..." : oldStr;
          const newPreview = newStr.length > 30 ? newStr.substring(0, 30) + "..." : newStr;
          return { icon: "✏️", action: "Editing", details: `${filename}\n"${oldPreview}"\n→ "${newPreview}"` };
        }
        return { icon: "✏️", action: "Editing", details: filename };
      }
      if (path) {
        const filename = path.split("/").pop() || path;
        return { icon: "✏️", action: "Editing", details: filename };
      }
      return { icon: "✏️", action: "Editing file" };
    }

    case "Glob": {
      const pattern = input.pattern as string | undefined;
      const path = input.path as string | undefined;
      if (verbosity === "high" && pattern && path) {
        return { icon: "🔍", action: "Glob", details: `${pattern} in ${path}` };
      }
      if (pattern) {
        return { icon: "🔍", action: "Finding", details: pattern };
      }
      return { icon: "🔍", action: "Searching files" };
    }

    case "Grep": {
      const pattern = input.pattern as string | undefined;
      const path = input.path as string | undefined;
      if (verbosity === "high" && pattern) {
        const pathInfo = path ? ` in ${path}` : "";
        return { icon: "🔎", action: "Grep", details: `"${pattern}"${pathInfo}` };
      }
      if (pattern) {
        const shortPattern = pattern.length > 20 ? pattern.substring(0, 20) + "..." : pattern;
        return { icon: "🔎", action: "Grep", details: shortPattern };
      }
      return { icon: "🔎", action: "Searching content" };
    }

    case "WebSearch": {
      const query = input.query as string | undefined;
      if (verbosity === "low") {
        return { icon: "🌐", action: "Searching web" };
      }
      if (query) {
        return { icon: "🌐", action: "Web search", details: query };
      }
      return { icon: "🌐", action: "Searching the web" };
    }

    case "WebFetch": {
      const url = input.url as string | undefined;
      if (verbosity === "low") {
        return { icon: "🌐", action: "Fetching URL" };
      }
      if (url) {
        const shortUrl = url.length > 40 ? url.substring(0, 40) + "..." : url;
        return { icon: "🌐", action: "Fetching", details: shortUrl };
      }
      return { icon: "🌐", action: "Fetching URL" };
    }

    case "Task": {
      const desc = input.description as string | undefined;
      const subagentType = input.subagent_type as string | undefined;
      if (verbosity === "low") {
        return { icon: "🤖", action: "Running agent" };
      }
      if (desc) {
        return { icon: "🤖", action: subagentType || "Agent", details: desc };
      }
      return { icon: "🤖", action: "Running sub-agent" };
    }

    case "TodoWrite": {
      const todos = input.todos as Array<{ content: string; status: string }> | undefined;
      if (verbosity === "low") {
        return { icon: "📋", action: "Updating tasks" };
      }
      if (todos && todos.length > 0) {
        // Show all tasks (no limit)
        const taskLines = todos.map((t) => {
          const checkbox = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : "⬜";
          const maxLen = verbosity === "high" ? 50 : 40;
          const content = t.content.length > maxLen ? t.content.substring(0, maxLen) + "..." : t.content;
          return `${checkbox} ${content}`;
        });
        return { icon: "📋", action: "Tasks", details: taskLines.join("\n") };
      }
      return { icon: "📋", action: "Updating tasks" };
    }

    case "AskUserQuestion":
      return { icon: "❓", action: "Asking question" };

    default:
      return { icon: "⚙️", action: `Using ${toolName}` };
  }
}

// ============================================================================
// Tool Approval Handling
// ============================================================================

/** Request user approval for a sensitive tool */
export async function requestToolApproval(
  bot: TelegramBot,
  chatId: number,
  toolName: string,
  toolInput: unknown
): Promise<boolean> {
  // Check if already auto-approved
  if (session.isToolAutoApproved(chatId, toolName)) {
    return true;
  }

  const approvalId = `${chatId}_${Date.now()}`;
  const inputDisplay = ui.formatToolInput(toolName, toolInput);

  const message = `<b>Tool Request: ${ui.escapeHtml(toolName)}</b>\n<pre>${ui.escapeHtml(inputDisplay)}</pre>`;
  const keyboard = ui.buildApprovalKeyboard(approvalId);

  await bot.sendMessage(chatId, message, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  return new Promise((resolve) => {
    pendingApprovals.set(approvalId, { chatId, resolve, toolName });

    // Timeout
    setTimeout(() => {
      if (pendingApprovals.has(approvalId)) {
        pendingApprovals.delete(approvalId);
        resolve(false);
      }
    }, APPROVAL_TIMEOUT_MS);
  });
}

/** Handle approval callback */
export async function handleApprovalCallback(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  data: string
): Promise<boolean> {
  // Parse: approve_yes_<id>, approve_all_<id>, approve_no_<id>
  const parts = data.split("_");
  if (parts.length < 3) return false;

  const action = parts[1]; // yes, all, no
  const approvalId = parts.slice(2).join("_");
  const approval = pendingApprovals.get(approvalId);

  if (!approval || approval.chatId !== chatId) return false;

  pendingApprovals.delete(approvalId);

  if (action === "yes") {
    approval.resolve(true);
    await bot.editMessageText(`Allowed: ${approval.toolName}`, {
      chat_id: chatId,
      message_id: messageId,
    });
  } else if (action === "all") {
    session.addAutoApprovedTool(chatId, approval.toolName);
    approval.resolve(true);
    await bot.editMessageText(`Allowed all future: ${approval.toolName}`, {
      chat_id: chatId,
      message_id: messageId,
    });
  } else {
    approval.resolve(false);
    await bot.editMessageText(`Denied: ${approval.toolName}`, {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  return true;
}

// ============================================================================
// Question Handling
// ============================================================================

/** Small delay helper */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ask user a question with button options */
export async function askUserQuestion(
  bot: TelegramBot,
  chatId: number,
  questions: Question[]
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    // Use counter + timestamp to ensure unique IDs
    questionCounter++;
    const questionId = `${chatId}_${Date.now()}_${questionCounter}`;

    // Format message with question and option descriptions
    let message = `<b>${ui.escapeHtml(q.header)}</b>\n\n${ui.escapeHtml(q.question)}\n`;
    for (const opt of q.options) {
      if (opt.description) {
        message += `\n• <b>${ui.escapeHtml(opt.label)}</b>: ${ui.escapeHtml(opt.description)}`;
      }
    }

    const keyboard = ui.buildQuestionKeyboard(questionId, q.options, q.multiSelect);

    try {
      await bot.sendMessage(chatId, message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error("Failed to send question message:", err);
      answers[q.header] = "Error sending question";
      continue;
    }

    // Wait for answer
    const answer = await new Promise<string>((resolve) => {
      pendingQuestions.set(questionId, {
        chatId,
        resolve,
        multiSelect: q.multiSelect,
        selectedOptions: new Set(),
        options: q.options,
      });

      // Timeout
      setTimeout(() => {
        if (pendingQuestions.has(questionId)) {
          pendingQuestions.delete(questionId);
          resolve("No answer provided");
        }
      }, QUESTION_TIMEOUT_MS);
    });

    answers[q.header] = answer;

    // Small delay between questions to prevent race conditions
    if (i < questions.length - 1) {
      await delay(100);
    }
  }

  return answers;
}

/** Handle question callback */
export async function handleQuestionCallback(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  data: string
): Promise<boolean> {
  try {
    // Parse: question_<chatId>_<timestamp>_<counter>_<answer>
    const parts = data.split("_");
    if (parts.length < 4) return false;

    // questionId format: chatId_timestamp_counter
    const questionId = `${parts[1]}_${parts[2]}_${parts[3]}`;
    const answerPart = parts.slice(4).join("_");
    const pending = pendingQuestions.get(questionId);

    if (!pending || pending.chatId !== chatId) {
      console.log("Question callback: no pending question found for", questionId);
      return false;
    }

    if (answerPart === "other") {
      // User wants to type custom answer
      try {
        await bot.editMessageText("Please type your answer:", {
          chat_id: chatId,
          message_id: messageId,
        });
      } catch (e) {
        console.error("Failed to edit message for 'other':", e);
      }

      // Set up one-time listener for next message
      const listener = async (msg: TelegramBot.Message) => {
        if (msg.chat.id === chatId && msg.text && !msg.text.startsWith("/")) {
          bot.removeListener("message", listener);
          pending.resolve(msg.text);
          pendingQuestions.delete(questionId);
        }
      };
      bot.on("message", listener);

      // Clean up listener on timeout
      setTimeout(() => {
        bot.removeListener("message", listener);
      }, QUESTION_TIMEOUT_MS);

      return true;
    }

    if (answerPart === "done" && pending.multiSelect) {
      // Multi-select done
      const selected = Array.from(pending.selectedOptions).join(", ");
      pending.resolve(selected || "None selected");
      pendingQuestions.delete(questionId);
      try {
        await bot.editMessageText(`Selected: ${selected || "None"}`, {
          chat_id: chatId,
          message_id: messageId,
        });
      } catch (e) {
        console.error("Failed to edit message for 'done':", e);
      }
      return true;
    }

    // Regular option selected
    const optionIndex = parseInt(answerPart, 10);
    const option = pending.options[optionIndex];

    if (!option) return false;

    if (pending.multiSelect) {
      // Toggle selection
      if (pending.selectedOptions.has(option.label)) {
        pending.selectedOptions.delete(option.label);
      } else {
        pending.selectedOptions.add(option.label);
      }

      // Update button text to show selection state
      const keyboard = ui.buildQuestionKeyboard(
        questionId,
        pending.options,
        pending.multiSelect,
        pending.selectedOptions
      );

      try {
        await bot.editMessageReplyMarkup(keyboard, {
          chat_id: chatId,
          message_id: messageId,
        });
      } catch (e) {
        console.error("Failed to edit reply markup:", e);
      }
    } else {
      // Single select - resolve immediately
      pending.resolve(option.label);
      pendingQuestions.delete(questionId);
      try {
        await bot.editMessageText(`Selected: ${option.label}`, {
          chat_id: chatId,
          message_id: messageId,
        });
      } catch (e) {
        console.error("Failed to edit message for selection:", e);
      }
    }

    return true;
  } catch (err) {
    console.error("Error in handleQuestionCallback:", err);
    return false;
  }
}

// ============================================================================
// Main Query Function
// ============================================================================

export interface QueryResult {
  success: boolean;
  error?: string;
}

/** Create a canUseTool callback for handling permissions and AskUserQuestion */
function createCanUseTool(
  bot: TelegramBot,
  chatId: number,
  inPlanMode: boolean
): CanUseTool {
  return async (toolName, input, options) => {
    // Handle AskUserQuestion specially - get answers from user via Telegram
    if (toolName === "AskUserQuestion") {
      const questions = (input as { questions?: Question[] }).questions;
      if (questions && questions.length > 0) {
        // Pause the log while waiting for user input
        await ui.pauseStatusMessage(bot, chatId, "Waiting for your answer...");

        const answers = await askUserQuestion(bot, chatId, questions);

        // Resume the log
        await ui.resumeStatusMessage(bot, chatId, "Got answer, continuing...");

        // Return allow with the answers added to input
        return {
          behavior: "allow" as const,
          updatedInput: { ...input, answers },
          toolUseID: options.toolUseID,
        };
      }
    }

    // Handle sensitive tools - request approval
    if (SENSITIVE_TOOLS.includes(toolName) && !inPlanMode) {
      // Check if auto-approved
      if (session.isToolAutoApproved(chatId, toolName)) {
        return {
          behavior: "allow" as const,
          updatedInput: input,
          toolUseID: options.toolUseID,
        };
      }

      // Pause the log while waiting for approval
      await ui.pauseStatusMessage(bot, chatId, `Approval needed: ${toolName}`);

      const approved = await requestToolApproval(bot, chatId, toolName, input);

      // Resume the log with result
      if (approved) {
        await ui.resumeStatusMessage(bot, chatId, `Approved: ${toolName}`);
        return {
          behavior: "allow" as const,
          updatedInput: input,
          toolUseID: options.toolUseID,
        };
      } else {
        await ui.resumeStatusMessage(bot, chatId, `Denied: ${toolName}`);
        return {
          behavior: "deny" as const,
          message: `Tool ${toolName} was denied by user`,
          toolUseID: options.toolUseID,
        };
      }
    }

    // Allow all other tools
    return {
      behavior: "allow" as const,
      updatedInput: input,
      toolUseID: options.toolUseID,
    };
  };
}

/** Execute a Claude query with the given prompt */
export async function executeQuery(
  bot: TelegramBot,
  chatId: number,
  prompt: string,
  workingDir: string
): Promise<QueryResult> {
  const sessionId = session.getSessionId(chatId);
  const inPlanMode = session.isPlanMode(chatId);
  const verbosity = session.getVerbosity(chatId);

  // Create abort controller for this query
  const abortController = new AbortController();
  queue.setAbortController(chatId, abortController);

  // Create status message
  await ui.createStatusMessage(bot, chatId, "Starting...");

  // Build effective prompt with plan mode prefix if needed
  const effectivePrompt = inPlanMode
    ? `[PLAN MODE - Do not make any changes. Only explore, analyze, and create a detailed plan for the following request. Explain what you would do step by step.]\n\n${prompt}`
    : prompt;

  // Build system prompt with Telegram context
  const systemPrompt = getTelegramContext(workingDir);

  let responseText = "";
  let lastUpdateTime = 0;

  try {
    for await (const message of query({
      prompt: effectivePrompt,
      options: {
        cwd: workingDir,
        allowedTools: inPlanMode ? PLAN_MODE_TOOLS : ALL_TOOLS,
        permissionMode: inPlanMode ? "plan" : "default",
        systemPrompt,
        canUseTool: createCanUseTool(bot, chatId, inPlanMode),
        env: {
          PATH: process.env.PATH || "/usr/bin:/usr/local/bin:/bin",
          HOME: process.env.HOME || "/home/pi",
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
        },
        ...(sessionId ? { resume: sessionId } : {}),
        abortController,
      },
    })) {
      // Check for abort
      if (abortController.signal.aborted) {
        break;
      }

      // Capture session ID
      if (message.type === "system" && message.subtype === "init") {
        session.setSessionId(chatId, message.session_id);
        // Save to history with first message preview
        const preview = session.getFirstMessage(chatId) || prompt;
        session.addSessionToHistory(message.session_id, preview);
      }

      // Handle tool use - just update status (permissions handled by canUseTool)
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            const toolName = block.name;
            const toolInput = block.input as Record<string, unknown>;

            // Extract detailed description based on tool type and verbosity
            const { icon, action, details, skip } = formatToolAction(toolName, toolInput, verbosity);
            if (!skip) {
              await ui.updateStatusMessage(bot, chatId, action, icon, details);
            }
          }

          // Stream text responses - show Claude's reasoning/explanation
          if (block.type === "text" && block.text) {
            responseText = block.text;

            // Update status with Claude's current text (shows reasoning)
            const now = Date.now();
            if (now - lastUpdateTime > 2000) {
              lastUpdateTime = now;
              // Show the last meaningful chunk of text as status
              const lines = responseText.trim().split('\n').filter(l => l.trim());
              const lastLine = lines[lines.length - 1] || '';
              if (lastLine.length > 10) {
                await ui.updateStatusMessage(bot, chatId, lastLine, "💭");
              }
            }
          }
        }
      }

      // Handle result
      if (message.type === "result") {
        // Update token counts from result
        const usage = (message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        if (usage) {
          ui.updateTokens(chatId, usage.input_tokens || 0, usage.output_tokens || 0);
        }

        if (message.subtype === "success") {
          // Send the final response
          await ui.sendCompletionMessage(bot, chatId, responseText || "Done.");
          return { success: true };
        } else {
          await ui.sendErrorMessage(bot, chatId, message.subtype);
          return { success: false, error: message.subtype };
        }
      }
    }

    // If we got here without a result, check if aborted
    if (abortController.signal.aborted) {
      return { success: false, error: "Aborted by user" };
    }

    // Send any accumulated response
    if (responseText) {
      await ui.sendCompletionMessage(bot, chatId, responseText);
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await ui.sendErrorMessage(bot, chatId, errorMessage);
    return { success: false, error: errorMessage };
  } finally {
    queue.clearAbortController(chatId);
  }
}
