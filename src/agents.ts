/**
 * Claudine Bot - Agent Definitions
 *
 * Loads agent profiles from ~/.claudine/agents/*.md. Each file has YAML
 * frontmatter (name, description, allowed_tools, mcps) followed by a
 * Markdown body that becomes the agent's system prompt.
 *
 * This module only loads/inspects agents. Dispatch into the SDK happens in
 * Phase 1 when claude.ts learns to accept a named agent.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";

// ============================================================================
// Types
// ============================================================================

export interface AgentFrontmatter {
  name: string;
  description?: string;
  allowed_tools?: string[];
  mcps?: string[];
}

export interface Agent {
  name: string;
  description: string;
  allowedTools: string[];
  mcps: string[];
  /** The full Markdown body — used as the SDK system prompt. */
  systemPrompt: string;
  /** Where the file lives, for debugging / reload. */
  sourcePath: string;
}

// ============================================================================
// Loading
// ============================================================================

const AGENTS_DIR = path.join(os.homedir(), ".claudine", "agents");
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

let cache: Map<string, Agent> | null = null;
let loadError: string | null = null;

export function invalidateCache(): void {
  cache = null;
  loadError = null;
}

function loadAgents(): Map<string, Agent> {
  if (cache) return cache;

  const agents = new Map<string, Agent>();

  if (!fs.existsSync(AGENTS_DIR)) {
    loadError = `Agents directory not found at ${AGENTS_DIR}`;
    cache = agents;
    return agents;
  }

  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith(".md"));

  for (const file of files) {
    const filePath = path.join(AGENTS_DIR, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const agent = parseAgent(content, filePath);
      if (agent) agents.set(agent.name, agent);
    } catch (err) {
      console.error(`Failed to load agent ${file}:`, err);
    }
  }

  cache = agents;
  return agents;
}

function parseAgent(content: string, sourcePath: string): Agent | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    console.error(`Agent file ${sourcePath} missing YAML frontmatter`);
    return null;
  }

  const [, frontmatterStr, body] = match;
  let frontmatter: AgentFrontmatter;
  try {
    frontmatter = yaml.load(frontmatterStr) as AgentFrontmatter;
  } catch (err) {
    console.error(`Bad frontmatter in ${sourcePath}:`, err);
    return null;
  }

  if (!frontmatter?.name) {
    console.error(`Agent file ${sourcePath} missing 'name' in frontmatter`);
    return null;
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description ?? "",
    allowedTools: frontmatter.allowed_tools ?? [],
    mcps: frontmatter.mcps ?? [],
    systemPrompt: body.trim(),
    sourcePath,
  };
}

// ============================================================================
// Public API
// ============================================================================

export function getAgentsDir(): string {
  return AGENTS_DIR;
}

export function getLoadError(): string | null {
  loadAgents();
  return loadError;
}

export function listAgents(): Agent[] {
  return Array.from(loadAgents().values());
}

export function getAgent(name: string): Agent | undefined {
  return loadAgents().get(name);
}
