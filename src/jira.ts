/**
 * Claudine Bot - Jira REST client
 *
 * Tiny wrapper around the Atlassian Cloud REST API. Auth is HTTP Basic with
 * (email : api_token); generate a token at:
 *   https://id.atlassian.com/manage-profile/security/api-tokens
 *
 * Config comes from environment variables (validated in isConfigured()):
 *   JIRA_SITE       e.g. onit-team.atlassian.net
 *   JIRA_EMAIL      Atlassian login email
 *   JIRA_API_TOKEN  the token
 *
 * No external deps — uses Node's built-in https module.
 */

import * as https from "https";

// ============================================================================
// Types
// ============================================================================

export interface JiraIssue {
  key: string;
  summary: string;
  statusName: string;
  statusCategory: string;
  priority?: string;
  updated: string;
  url: string;
  projectKey: string;
}

export interface JiraIssueDetailed extends JiraIssue {
  /** Description rendered to plain text from Atlassian Document Format. */
  descriptionText: string;
  /** Jira issue type name: "Bug", "Story", "Task", etc. */
  issueType: string;
  labels: string[];
  components: string[];
}

// ============================================================================
// Config
// ============================================================================

interface Config {
  site: string;
  email: string;
  token: string;
}

function readConfig(): Config | null {
  const site = process.env.JIRA_SITE?.trim();
  const email = process.env.JIRA_EMAIL?.trim();
  const token = process.env.JIRA_API_TOKEN?.trim();
  if (!site || !email || !token) return null;
  return { site, email, token };
}

export function isConfigured(): boolean {
  return readConfig() !== null;
}

// ============================================================================
// HTTP
// ============================================================================

function request<T = unknown>(
  cfg: Config,
  pathAndQuery: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const authHeader =
      "Basic " + Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");

    const req = https.request(
      {
        hostname: cfg.site,
        path: pathAndQuery,
        method: "GET",
        headers: {
          "Authorization": authHeader,
          "Accept": "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error(`Failed to parse Jira response: ${err}`));
            }
          } else {
            reject(new Error(`Jira API ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Jira API request timeout"));
    });
    req.end();
  });
}

// ============================================================================
// Public API
// ============================================================================

interface SearchResponse {
  issues?: RawIssue[];
}

interface RawIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { name?: string } };
    priority?: { name?: string };
    updated?: string;
    project?: { key?: string };
  };
}

/** Run a JQL search. Returns the parsed issues in a stable shape. */
export async function searchByJQL(
  jql: string,
  fields: string[] = ["summary", "status", "priority", "updated", "project"],
  maxResults = 50,
): Promise<JiraIssue[]> {
  const cfg = readConfig();
  if (!cfg) throw new Error("Jira not configured (missing JIRA_SITE / JIRA_EMAIL / JIRA_API_TOKEN)");

  const params = new URLSearchParams({
    jql,
    fields: fields.join(","),
    maxResults: String(maxResults),
  });

  const data = await request<SearchResponse>(cfg, `/rest/api/3/search/jql?${params}`);
  const rawIssues = data.issues ?? [];

  return rawIssues.map((it) => ({
    key: it.key,
    summary: it.fields.summary ?? "",
    statusName: it.fields.status?.name ?? "Unknown",
    statusCategory: it.fields.status?.statusCategory?.name ?? "Unknown",
    priority: it.fields.priority?.name,
    updated: it.fields.updated ?? "",
    url: `https://${cfg.site}/browse/${it.key}`,
    projectKey: it.fields.project?.key ?? "",
  }));
}

/** Sanity check: returns the authenticated user, or throws. */
export async function getCurrentUser(): Promise<{ accountId: string; emailAddress: string; displayName: string }> {
  const cfg = readConfig();
  if (!cfg) throw new Error("Jira not configured");
  return request<{ accountId: string; emailAddress: string; displayName: string }>(cfg, "/rest/api/3/myself");
}

interface RawIssueDetailed {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { name?: string } };
    priority?: { name?: string };
    updated?: string;
    project?: { key?: string };
    issuetype?: { name?: string };
    description?: unknown;
    labels?: string[];
    components?: { name?: string }[];
  };
}

/** Fetch one issue with full description + classification fields. */
export async function getIssue(key: string): Promise<JiraIssueDetailed> {
  const cfg = readConfig();
  if (!cfg) throw new Error("Jira not configured");

  const params = new URLSearchParams({
    fields: "summary,status,priority,updated,project,issuetype,description,labels,components",
  });
  const it = await request<RawIssueDetailed>(cfg, `/rest/api/3/issue/${encodeURIComponent(key)}?${params}`);

  return {
    key: it.key,
    summary: it.fields.summary ?? "",
    statusName: it.fields.status?.name ?? "Unknown",
    statusCategory: it.fields.status?.statusCategory?.name ?? "Unknown",
    priority: it.fields.priority?.name,
    updated: it.fields.updated ?? "",
    url: `https://${cfg.site}/browse/${it.key}`,
    projectKey: it.fields.project?.key ?? "",
    issueType: it.fields.issuetype?.name ?? "",
    descriptionText: adfToPlainText(it.fields.description),
    labels: it.fields.labels ?? [],
    components: (it.fields.components ?? []).map(c => c.name ?? "").filter(Boolean),
  };
}

/**
 * Flatten Atlassian Document Format (rich text JSON) into plain text.
 * Handles the common nodes (paragraph, text, heading, listItem) — anything
 * fancier (mentions, embeds) is rendered as best-effort text.
 */
export function adfToPlainText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = node as any;

  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (n.type === "hardBreak") return "\n";

  const childText: string = Array.isArray(n.content)
    ? n.content.map((c: unknown) => adfToPlainText(c)).join("")
    : "";

  switch (n.type) {
    case "paragraph":
    case "heading":
      return childText + "\n\n";
    case "listItem":
      return "- " + childText.trim() + "\n";
    case "bulletList":
    case "orderedList":
    case "blockquote":
    case "codeBlock":
      return childText + "\n";
    case "mention":
      return n.attrs?.text ? `@${n.attrs.text}` : "@unknown";
    case "inlineCard":
    case "link":
      return n.attrs?.url ?? childText;
    default:
      return childText;
  }
}
