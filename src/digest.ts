/**
 * Claudine Bot - Jira digest
 *
 * Per-chat state of "what tickets were assigned to me last time we looked"
 * plus a digest runner that diffs against the current Jira state and posts
 * only the deltas to Telegram.
 *
 * State lives in ~/.claude-telegram-digest.json (gitignored by living
 * outside the repo).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { PlatformAdapter } from "./adapters/types.js";
import * as ui from "./ui.js";
import * as jira from "./jira.js";

// ============================================================================
// State
// ============================================================================

const STATE_FILE = path.join(os.homedir(), ".claude-telegram-digest.json");

interface KnownIssue {
  statusName: string;
  statusCategory: string;
  updated: string;
}

interface ChatDigestState {
  knownIssues: Record<string, KnownIssue>;
  lastRun?: string;
}

interface DigestState {
  chats: Record<string, ChatDigestState>;
}

function loadState(): DigestState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Failed to load digest state:", err);
  }
  return { chats: {} };
}

function saveState(state: DigestState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("Failed to save digest state:", err);
  }
}

// ============================================================================
// JQL — change here when we want per-chat customization
// ============================================================================

export const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done";

// ============================================================================
// Public API
// ============================================================================

/**
 * Run a digest cycle for a chat.
 *
 * @param force   true → send a message even if there are no deltas
 *                false → stay silent on no-change ticks (scheduled use)
 * @returns       summary describing what was sent (or "no changes")
 */
export async function runDigest(
  adapter: PlatformAdapter,
  chatId: string,
  force = false,
): Promise<string> {
  if (!jira.isConfigured()) {
    if (force) {
      await ui.sendMessage(adapter, chatId, "<b>Jira not configured.</b>\nSet <code>JIRA_SITE</code>, <code>JIRA_EMAIL</code>, and <code>JIRA_API_TOKEN</code> in <code>.env</code>.");
    }
    return "jira not configured";
  }

  let current: jira.JiraIssue[];
  try {
    current = await jira.searchByJQL(DEFAULT_JQL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (force) {
      await ui.sendMessage(adapter, chatId, `<b>Jira request failed:</b> ${ui.escapeHtml(msg)}`);
    }
    return `jira request failed: ${msg}`;
  }

  const state = loadState();
  const hadPriorState = state.chats[chatId]?.knownIssues !== undefined;
  const prev = state.chats[chatId]?.knownIssues ?? {};
  const { newOnes, changed, removed } = diff(prev, current);

  // Always update state — we know the latest.
  state.chats[chatId] = {
    knownIssues: Object.fromEntries(
      current.map((it) => [
        it.key,
        { statusName: it.statusName, statusCategory: it.statusCategory, updated: it.updated },
      ]),
    ),
    lastRun: new Date().toISOString(),
  };
  saveState(state);

  // First-ever scheduled tick: silently baseline, don't dump the whole queue
  // as "new". User can /digest to see it explicitly.
  if (!hadPriorState && !force) return "baselined silently (first run)";

  const hasDeltas = newOnes.length + changed.length + removed.length > 0;
  if (!hasDeltas && !force) return "no changes";

  const message = formatDigest({ newOnes, changed, removed, total: current.length, force, prev });
  await ui.sendMessage(adapter, chatId, message);

  return hasDeltas
    ? `${newOnes.length} new, ${changed.length} changed, ${removed.length} removed`
    : "no changes (forced)";
}

/** Show the full queue (used by /digest) regardless of state. */
export async function showFullQueue(adapter: PlatformAdapter, chatId: string): Promise<void> {
  if (!jira.isConfigured()) {
    await ui.sendMessage(adapter, chatId, "<b>Jira not configured.</b>\nSet <code>JIRA_SITE</code>, <code>JIRA_EMAIL</code>, and <code>JIRA_API_TOKEN</code> in <code>.env</code>.");
    return;
  }

  let current: jira.JiraIssue[];
  try {
    current = await jira.searchByJQL(DEFAULT_JQL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ui.sendMessage(adapter, chatId, `<b>Jira request failed:</b> ${ui.escapeHtml(msg)}`);
    return;
  }

  if (current.length === 0) {
    await ui.sendMessage(adapter, chatId, "<b>📋 Jira queue</b>\n\n<i>Nothing assigned — inbox zero.</i>");
    return;
  }

  // Sort by updated desc so the freshest is on top.
  const sorted = [...current].sort((a, b) => b.updated.localeCompare(a.updated));
  const lines = sorted.map((it) => formatIssueLine(it));
  const message =
    `<b>📋 Jira queue (${current.length})</b>\n\n` +
    lines.join("\n") +
    `\n\n<i>Last checked: just now</i>`;

  await ui.sendMessage(adapter, chatId, message);

  // Update known state too, so next scheduled tick has accurate baseline.
  const state = loadState();
  state.chats[chatId] = {
    knownIssues: Object.fromEntries(
      current.map((it) => [
        it.key,
        { statusName: it.statusName, statusCategory: it.statusCategory, updated: it.updated },
      ]),
    ),
    lastRun: new Date().toISOString(),
  };
  saveState(state);
}

// ============================================================================
// Internals
// ============================================================================

function diff(
  prev: Record<string, KnownIssue>,
  current: jira.JiraIssue[],
): {
  newOnes: jira.JiraIssue[];
  changed: { issue: jira.JiraIssue; prevStatus: string }[];
  removed: { key: string; prevStatus: string }[];
} {
  const currentByKey = new Map(current.map((it) => [it.key, it]));

  const newOnes: jira.JiraIssue[] = [];
  const changed: { issue: jira.JiraIssue; prevStatus: string }[] = [];

  for (const issue of current) {
    const before = prev[issue.key];
    if (!before) {
      newOnes.push(issue);
    } else if (before.statusName !== issue.statusName) {
      changed.push({ issue, prevStatus: before.statusName });
    }
  }

  const removed: { key: string; prevStatus: string }[] = [];
  for (const [key, before] of Object.entries(prev)) {
    if (!currentByKey.has(key)) {
      removed.push({ key, prevStatus: before.statusName });
    }
  }

  return { newOnes, changed, removed };
}

function formatIssueLine(it: jira.JiraIssue): string {
  const summary = it.summary.length > 70 ? it.summary.slice(0, 70) + "…" : it.summary;
  return `• <a href="${it.url}">${ui.escapeHtml(it.key)}</a> — ${ui.escapeHtml(summary)} <i>(${ui.escapeHtml(it.statusName)})</i>`;
}

interface DigestPayload {
  newOnes: jira.JiraIssue[];
  changed: { issue: jira.JiraIssue; prevStatus: string }[];
  removed: { key: string; prevStatus: string }[];
  total: number;
  force: boolean;
  prev: Record<string, KnownIssue>;
}

function formatDigest(d: DigestPayload): string {
  const parts: string[] = ["<b>🔔 Jira digest</b>"];

  // On a forced run with nothing changed, say so explicitly.
  const hasDeltas = d.newOnes.length + d.changed.length + d.removed.length > 0;
  if (!hasDeltas && d.force) {
    parts.push("");
    parts.push(`<i>No changes since last check.</i> You have <b>${d.total}</b> open ticket${d.total === 1 ? "" : "s"}.`);
    parts.push("Use <code>/digest</code> to see the full queue.");
    return parts.join("\n");
  }

  if (d.newOnes.length > 0) {
    parts.push("");
    parts.push("<b>🆕 New</b>");
    parts.push(...d.newOnes.map(formatIssueLine));
  }

  if (d.changed.length > 0) {
    parts.push("");
    parts.push("<b>🔄 Status changed</b>");
    parts.push(
      ...d.changed.map(
        ({ issue, prevStatus }) =>
          `• <a href="${issue.url}">${ui.escapeHtml(issue.key)}</a> — ${ui.escapeHtml(issue.summary)}\n  <i>${ui.escapeHtml(prevStatus)} → ${ui.escapeHtml(issue.statusName)}</i>`,
      ),
    );
  }

  if (d.removed.length > 0) {
    parts.push("");
    parts.push("<b>✅ Removed from queue</b>");
    parts.push(
      ...d.removed.map(
        (r) => `• ${ui.escapeHtml(r.key)} <i>(was ${ui.escapeHtml(r.prevStatus)})</i>`,
      ),
    );
  }

  // Bottom line: tickets still in queue
  parts.push("");
  parts.push(`<i>${d.total} ticket${d.total === 1 ? "" : "s"} still in queue. Use <code>/digest</code> for the full list.</i>`);

  return parts.join("\n");
}
