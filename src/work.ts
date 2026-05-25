/**
 * Claudine Bot - Ticket → Agent Dispatcher (Track C v1)
 *
 * Given a Jira ticket key, fetches the ticket, picks an agent (pinned via
 * /agent, defaulting to ui-expert), and dispatches a Claude SDK query
 * into the user's currently active project. The agent runs through the
 * normal executeQuery flow — same tool-approval UI, same Captain's Log —
 * but with the agent's system prompt + ticket context baked into the
 * user message.
 *
 * The agent is responsible for creating the branch, committing, running
 * tests, and opening the PR via `gh pr create`. Approval/merge stays
 * manual in v1.
 */

import type { PlatformAdapter } from "./adapters/types.js";
import * as jira from "./jira.js";
import * as projects from "./projects.js";
import * as agents from "./agents.js";
import * as session from "./session.js";
import * as claude from "./claude.js";
import * as ui from "./ui.js";

const TICKET_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const FIGMA_URL_RE = /https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/[^\s)>"'\]]+/g;
const DEFAULT_AGENT = "ui-expert";

/** Build a branch-safe slug from a ticket summary. */
function slugify(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Start a work session for a Jira ticket. */
export async function startWork(
  adapter: PlatformAdapter,
  chatId: string,
  ticketKey: string,
): Promise<void> {
  const numericChatId = Number(chatId);

  // ── Preflight ──────────────────────────────────────────────────────────
  const normalizedKey = ticketKey.trim().toUpperCase();
  if (!TICKET_KEY_RE.test(normalizedKey)) {
    await ui.sendMessage(
      adapter,
      chatId,
      `<b>Bad ticket key:</b> <code>${ui.escapeHtml(ticketKey)}</code>\nExpected format like <code>ONIT-411</code>.`,
    );
    return;
  }

  if (!jira.isConfigured()) {
    await ui.sendMessage(
      adapter,
      chatId,
      "<b>Jira not configured.</b>\nSet <code>JIRA_SITE</code>, <code>JIRA_EMAIL</code>, and <code>JIRA_API_TOKEN</code> in <code>.env</code> first.",
    );
    return;
  }

  const activeProjectName = session.getActiveProject(numericChatId);
  if (!activeProjectName) {
    await ui.sendMessage(
      adapter,
      chatId,
      "<b>No active project.</b>\nUse <code>/project</code> to pick one before <code>/work</code>.",
    );
    return;
  }

  const project = projects.getProject(activeProjectName);
  if (!project) {
    await ui.sendMessage(
      adapter,
      chatId,
      `<b>Active project not found:</b> <code>${ui.escapeHtml(activeProjectName)}</code>. Run <code>/projects</code> and re-pick.`,
    );
    return;
  }

  // ── Fetch ticket ───────────────────────────────────────────────────────
  let ticket: jira.JiraIssueDetailed;
  try {
    ticket = await jira.getIssue(normalizedKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ui.sendMessage(
      adapter,
      chatId,
      `<b>Couldn't fetch ${ui.escapeHtml(normalizedKey)}:</b> ${ui.escapeHtml(msg)}`,
    );
    return;
  }

  // ── Pick agent ─────────────────────────────────────────────────────────
  const pinned = session.getActiveAgent(numericChatId);
  const agentName = pinned ?? DEFAULT_AGENT;
  const agent = agents.getAgent(agentName);
  if (!agent) {
    await ui.sendMessage(
      adapter,
      chatId,
      `<b>Agent not found:</b> <code>${ui.escapeHtml(agentName)}</code>. Run <code>/agents</code> to see what's available.`,
    );
    return;
  }
  // Pin is one-shot — clear it before dispatch so the next /work doesn't reuse.
  session.setActiveAgent(numericChatId, undefined);

  // ── Build prompt ───────────────────────────────────────────────────────
  const figmaUrls = Array.from(
    new Set([...ticket.descriptionText.matchAll(FIGMA_URL_RE)].map(m => m[0])),
  );
  const slug = slugify(ticket.summary) || "work";
  const branchName = `claudine/${normalizedKey.toLowerCase()}-${slug}`;

  const labelsLine = ticket.labels.length > 0 ? `**Labels**: ${ticket.labels.join(", ")}` : "";
  const componentsLine =
    ticket.components.length > 0 ? `**Components**: ${ticket.components.join(", ")}` : "";
  const figmaLine =
    figmaUrls.length > 0
      ? `**Figma**:\n${figmaUrls.map(u => `- ${u}`).join("\n")}`
      : "";

  const prompt = [
    agent.systemPrompt,
    "",
    "---",
    "",
    `## Your task: implement Jira ticket ${ticket.key}`,
    "",
    `**Summary**: ${ticket.summary}`,
    `**Type**: ${ticket.issueType}`,
    `**Status**: ${ticket.statusName}`,
    ticket.priority ? `**Priority**: ${ticket.priority}` : "",
    labelsLine,
    componentsLine,
    `**Ticket URL**: ${ticket.url}`,
    "",
    figmaLine,
    "",
    "### Description",
    ticket.descriptionText.trim() || "_(no description provided)_",
    "",
    "### Working environment",
    `- Repo: \`${project.path}\``,
    `- Branch to create: \`${branchName}\` (off latest \`origin/main\`)`,
    project.sensitivePaths.length > 0
      ? `- Sensitive paths (require explicit user approval before touching): ${project.sensitivePaths.map(p => `\`${p}\``).join(", ")}`
      : "",
    "",
    "### When you finish",
    "1. Make sure tests pass.",
    "2. Push the branch and run `gh pr create --fill` to open a PR. The PR title and body should reflect the change.",
    "3. Print the PR URL on its own line so it's easy to spot.",
    "4. Summarize what you changed and why.",
    "",
    "If the ticket is ambiguous or a decision falls outside the description, stop and ask using your tools rather than guessing.",
  ]
    .filter(line => line !== null && line !== undefined)
    .join("\n");

  // ── Announce, then dispatch ────────────────────────────────────────────
  const figmaBadge = figmaUrls.length > 0 ? ` · 🎨 ${figmaUrls.length} Figma link${figmaUrls.length === 1 ? "" : "s"}` : "";
  await ui.sendMessage(
    adapter,
    chatId,
    `<b>🚧 Starting ${ui.escapeHtml(ticket.key)}</b>\n` +
      `<i>${ui.escapeHtml(ticket.summary)}</i>\n\n` +
      `Agent: <code>${ui.escapeHtml(agentName)}</code>${figmaBadge}\n` +
      `Repo: <code>${ui.escapeHtml(project.path)}</code>\n` +
      `Branch: <code>${ui.escapeHtml(branchName)}</code>`,
  );

  await claude.executeQuery(adapter, chatId, prompt, project.path);
}
