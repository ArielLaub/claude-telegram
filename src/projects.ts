/**
 * Claudine Bot - Project Registry
 *
 * Loads ~/.claudine/projects.yml and resolves user input ("alze", "BE-123",
 * a repo name, etc.) to a concrete project entry that points at a repo on
 * disk and lists the agents/MCPs that should be active when working in it.
 *
 * Schema (see ~/.claudine/projects.yml header for the full reference).
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
  /** Fully-qualified name. For children: "<parent>/<short>". For top-level: same as short. */
  name: string;
  /** Last segment only. */
  shortName: string;
  /** Absolute path on disk. */
  path: string;
  /** Parent workspace name, if this is a child. */
  parent?: string;
  tracker: Tracker;
  figmaFiles: string[];
  agents: string[];
  mcps: string[];
  sensitivePaths: string[];
  /** Fully-qualified names of children, if this is a workspace. */
  children: string[];
}

interface RawProject {
  path?: string;
  tracker?: Tracker;
  figma_files?: string[];
  agents?: string[];
  mcps?: string[];
  sensitive_paths?: string[];
  children?: Record<string, RawProject>;
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

/** Load and flatten the registry. Returns a name → Project map. */
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
    flatten(name, entry, undefined, projects);
  }

  cache = projects;
  return projects;
}

/** Recursively flatten a project entry (and its children) into the map. */
function flatten(
  name: string,
  entry: RawProject,
  parent: Project | undefined,
  out: Map<string, Project>,
): void {
  const fullName = parent ? `${parent.name}/${name}` : name;
  const shortName = name;

  // Resolve path relative to parent if relative
  const rawPath = entry.path ?? `./${name}`;
  const absPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(parent?.path ?? process.cwd(), rawPath);

  const childRawEntries = entry.children ?? {};
  const childNames: string[] = [];

  const project: Project = {
    name: fullName,
    shortName,
    path: absPath,
    parent: parent?.name,
    tracker: entry.tracker ?? parent?.tracker ?? { type: "none" },
    figmaFiles: entry.figma_files ?? parent?.figmaFiles ?? [],
    agents: entry.agents ?? parent?.agents ?? [],
    mcps: entry.mcps ?? parent?.mcps ?? [],
    sensitivePaths: entry.sensitive_paths ?? parent?.sensitivePaths ?? [],
    children: [],  // filled in below
  };

  out.set(fullName, project);

  for (const [childName, childEntry] of Object.entries(childRawEntries)) {
    flatten(childName, childEntry, project, out);
    childNames.push(`${fullName}/${childName}`);
  }

  project.children = childNames;
}

// ============================================================================
// Public API
// ============================================================================

/** Returns the path the registry is loaded from. */
export function getRegistryPath(): string {
  return REGISTRY_PATH;
}

/** Returns the last load error, or null if the registry loaded cleanly. */
export function getLoadError(): string | null {
  loadRegistry();
  return loadError;
}

/** All projects, flat. Workspace + children both appear. */
export function listProjects(): Project[] {
  return Array.from(loadRegistry().values());
}

/** Top-level projects only (workspaces and standalone projects, no children). */
export function listTopLevel(): Project[] {
  return listProjects().filter(p => !p.parent);
}

/** Children of a given workspace, by full or short name. */
export function listChildren(workspaceRef: string): Project[] {
  const ws = getProject(workspaceRef);
  if (!ws) return [];
  return ws.children
    .map(c => loadRegistry().get(c))
    .filter((p): p is Project => p !== undefined);
}

/** Look up by full name ("alze-dev/admin-client") or short name ("admin-client"). */
export function getProject(ref: string): Project | undefined {
  const registry = loadRegistry();
  if (!ref) return undefined;

  // Exact full-name match
  const exact = registry.get(ref);
  if (exact) return exact;

  // Case-insensitive full-name match
  const refLower = ref.toLowerCase();
  for (const project of registry.values()) {
    if (project.name.toLowerCase() === refLower) return project;
  }

  // Short-name match — only if unique
  const shortMatches = Array.from(registry.values()).filter(
    p => p.shortName.toLowerCase() === refLower,
  );
  if (shortMatches.length === 1) return shortMatches[0];

  return undefined;
}

/**
 * Resolve a fuzzy input (repo name, Jira key like "BE-123", workspace name)
 * into a project. Returns `{project, ambiguous}` — if ambiguous is non-empty,
 * the caller should disambiguate via Telegram picker.
 */
export function resolve(input: string): { project?: Project; ambiguous: Project[] } {
  const trimmed = input.trim();
  if (!trimmed) return { ambiguous: [] };

  // Exact full or short name
  const direct = getProject(trimmed);
  if (direct) return { project: direct, ambiguous: [] };

  // Jira key prefix ("BE-123" → find child whose tracker.key === "BE")
  const jiraMatch = trimmed.match(/^([A-Z][A-Z0-9]+)-\d+$/i);
  if (jiraMatch) {
    const key = jiraMatch[1].toUpperCase();
    const matches = listProjects().filter(
      p => p.tracker.type === "jira" && p.tracker.key?.toUpperCase() === key,
    );
    if (matches.length === 1) return { project: matches[0], ambiguous: [] };
    if (matches.length > 1) return { ambiguous: matches };
  }

  // Workspace reference without a child ("alze") → ambiguous if it has children
  const partialMatches = listTopLevel().filter(p =>
    p.shortName.toLowerCase().includes(trimmed.toLowerCase()),
  );
  if (partialMatches.length === 1) {
    const p = partialMatches[0];
    // If it's a workspace with children, the caller needs to pick a child
    if (p.children.length > 0) return { ambiguous: listChildren(p.name) };
    return { project: p, ambiguous: [] };
  }

  return { ambiguous: partialMatches };
}
