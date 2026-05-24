/**
 * Claudine Bot - Runtime State
 *
 * Tracks bot-process state across restarts so we can:
 *   - suppress the noisy "Claudine is online" greeting when nothing changed;
 *   - announce a one-line update notice when the git SHA moves.
 *
 * Persisted to ~/.claude-telegram-runtime.json (gitignored by living outside repo).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

const STATE_FILE = path.join(os.homedir(), ".claude-telegram-runtime.json");

export interface RuntimeState {
  gitSha?: string;
  gitSubject?: string;
}

export function loadState(): RuntimeState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Failed to load runtime state:", err);
  }
  return {};
}

export function saveState(state: RuntimeState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("Failed to save runtime state:", err);
  }
}

export interface GitInfo {
  sha: string;
  shortSha: string;
  subject: string;
}

/** Return the current commit's SHA + subject, or null if not in a git repo. */
export function getGitInfo(repoDir: string): GitInfo | null {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    const subject = execSync("git log -1 --format=%s", {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return { sha, shortSha: sha.slice(0, 7), subject };
  } catch {
    return null;
  }
}
