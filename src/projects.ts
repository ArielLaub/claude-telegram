/**
 * Claudine Bot - Project Registry
 *
 * Loads ~/.claudine/projects.yml and resolves user input ("alze", a Jira
 * key, etc.) to a project entry pointing at a directory on disk.
 *
 * Each project is flat. If the directory is a workspace containing nested
 * git repos, the project lists them in `subRepos` — but Claudine still
 * treats the whole workspace as one project; the agent navigates between
 * sub-repos as the ticket requires.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";

// ============================================================================
// Types
// ============================================================================

export interface Tracker {
  type: "jira" | "trello" | "none";
  key?: string;
}

export interface Project {
  /** Unique short name from the registry (e.g. "alze-dev"). */
  name: string;
  /** Absolute path on disk. */
  path: string;
  tracker: Tracker;
  figmaFiles: string[];
  agents: string[];
  mcps: string[];
  sensitivePaths: string[];
  /** Names of nested sub-repos under `path` (descriptive only). */
  subRepos: string[];
}

interface RawProject {
  path?: string;
  tracker?: Tracker;
  figma_files?: string[];
  agents?: string[];
  mcps?: string[];
  sensitive_paths?: string[];
  sub_repos?: string[];
}

interface RawRegistry {
  version?: number;
  projects?: Record<string, RawProject>;
}

// ============================================================================
// Loading
// ============================================================================

const REGISTRY_PATH = path.join(os.homedir(), ".claudine", "projects.yml");

let cache: Map<string, Project> | null = null;
let loadError: string | null = null;

/** Force a reload from disk on next access. */
export function invalidateCache(): void {
  cache = null;
  loadError = null;
}

function loadRegistry(): Map<string, Project> {
  if (cache) return cache;

  const projects = new Map<string, Project>();

  if (!fs.existsSync(REGISTRY_PATH)) {
    loadError = `Registry not found at ${REGISTRY_PATH}`;
    cache = projects;
    return projects;
  }

  let raw: RawRegistry;
  try {
    const content = fs.readFileSync(REGISTRY_PATH, "utf-8");
    raw = (yaml.load(content) as RawRegistry) ?? {};
  } catch (err) {
    loadError = `Failed to parse ${REGISTRY_PATH}: ${err instanceof Error ? err.message : String(err)}`;
    cache = projects;
    return projects;
  }

  if (!raw.projects) {
    cache = projects;
    return projects;
  }

  for (const [name, entry] of Object.entries(raw.projects)) {
    const rawPath = entry.path ?? `./${name}`;
    const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);

    projects.set(name, {
      name,
      path: absPath,
      tracker: entry.tracker ?? { type: "none" },
      figmaFiles: entry.figma_files ?? [],
      agents: entry.agents ?? [],
      mcps: entry.mcps ?? [],
      sensitivePaths: entry.sensitive_paths ?? [],
      subRepos: entry.sub_repos ?? [],
    });
  }

  cache = projects;
  return projects;
}

// ============================================================================
// Public API
// ============================================================================

export function getRegistryPath(): string {
  return REGISTRY_PATH;
}

export function getLoadError(): string | null {
  loadRegistry();
  return loadError;
}

export function listProjects(): Project[] {
  return Array.from(loadRegistry().values());
}

/** Look up by exact name (case-insensitive). */
export function getProject(ref: string): Project | undefined {
  const registry = loadRegistry();
  if (!ref) return undefined;

  const exact = registry.get(ref);
  if (exact) return exact;

  const refLower = ref.toLowerCase();
  for (const project of registry.values()) {
    if (project.name.toLowerCase() === refLower) return project;
  }

  return undefined;
}

/**
 * Resolve a fuzzy input — project name (exact or partial) or a Jira key
 * like "ONIT-123" — into a project. Returns `{project, ambiguous}` — if
 * ambiguous is non-empty, the caller should disambiguate via a picker.
 */
export function resolve(input: string): { project?: Project; ambiguous: Project[] } {
  const trimmed = input.trim();
  if (!trimmed) return { ambiguous: [] };

  // Exact name match
  const direct = getProject(trimmed);
  if (direct) return { project: direct, ambiguous: [] };

  // Jira key match ("ONIT-123" → project whose tracker.key === "ONIT")
  const jiraMatch = trimmed.match(/^([A-Z][A-Z0-9]+)-\d+$/i);
  if (jiraMatch) {
    const key = jiraMatch[1].toUpperCase();
    const matches = listProjects().filter(
      p => p.tracker.type === "jira" && p.tracker.key?.toUpperCase() === key,
    );
    if (matches.length === 1) return { project: matches[0], ambiguous: [] };
    if (matches.length > 1) return { ambiguous: matches };
  }

  // Partial name match
  const partial = listProjects().filter(p =>
    p.name.toLowerCase().includes(trimmed.toLowerCase()),
  );
  if (partial.length === 1) return { project: partial[0], ambiguous: [] };

  return { ambiguous: partial };
}
