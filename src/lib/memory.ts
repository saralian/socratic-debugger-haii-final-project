/**
 * lib/memory.ts
 *
 * Lightweight per-user cross-session memory for the Socratic Debugging Tutor.
 *
 * Storage: one JSON file per user at data/users/{userId}.json
 * The data/ directory should be gitignored.
 *
 * This module is the only place in the app that touches the filesystem for
 * user memory — route.ts calls these functions; nothing else does.
 *
 * For the pilot, userId is a browser-local UUID. Swapping in real auth later
 * only requires changing how userId is generated on the client — this module
 * is unchanged.
 */

import fs from "fs";
import path from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionSummary {
  timestamp: number;         // Unix ms — when the session ended
  bugCategory: string;       // e.g. "off-by-one", "null-reference"
  finalHypothesis: string;   // student's last committed possibleCause
  fixSuccessful: boolean;    // whether the student produced a correct fix
  summary: string;           // 2-3 sentence memory entry (third person)
}

export interface UserMemory {
  sessions: SessionSummary[];
}

// ── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data", "users");

function userFilePath(userId: string): string {
  // Sanitise userId — only allow alphanumeric and hyphens (UUID shape).
  // This prevents path traversal from a malicious userId value.
  const safe = userId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe || safe !== userId) {
    throw new Error(`Invalid userId: ${userId}`);
  }
  return path.join(DATA_DIR, `${safe}.json`);
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Load a user's session history. Returns an empty history if the file does
 * not exist yet (first-time user).
 */
export function loadUserMemory(userId: string): UserMemory {
  const filePath = userFilePath(userId);
  if (!fs.existsSync(filePath)) {
    return { sessions: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as UserMemory;
    return { sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [] };
  } catch {
    // Corrupt or unreadable file — treat as empty rather than crashing.
    console.warn(`[memory] Failed to read ${filePath}, starting fresh`);
    return { sessions: [] };
  }
}

/**
 * Return the last N session summaries as a formatted string for injection
 * into a system prompt. Returns an empty string if there are no sessions.
 *
 * Format:
 *   --- Previous session context (for tutor use only — do not share directly with student) ---
 *   [2025-04-14] The student debugged an off-by-one error...
 *   [2025-04-18] The student encountered an integer division issue...
 */
export function buildSessionContext(userId: string, n = 5): string {
  const memory = loadUserMemory(userId);
  if (memory.sessions.length === 0) return "";

  const recent = memory.sessions
    .slice(-n)  // most recent n entries
    .map((s) => {
      const date = new Date(s.timestamp).toISOString().split("T")[0];
      return `[${date}] ${s.summary}`;
    })
    .join("\n");

  return (
    "--- Previous session context (for tutor use only — do not share directly with student) ---\n" +
    recent
  );
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Append a new session summary to the user's history and persist to disk.
 * Creates the data/users directory if it doesn't exist.
 * This is fire-and-forget — errors are logged but not thrown.
 */
export function saveSessionSummary(
  userId: string,
  entry: SessionSummary
): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const memory = loadUserMemory(userId);
    memory.sessions.push(entry);

    // Cap stored sessions at 50 to prevent unbounded file growth.
    if (memory.sessions.length > 50) {
      memory.sessions = memory.sessions.slice(-50);
    }

    const filePath = userFilePath(userId);
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
  } catch (err) {
    console.error("[memory] Failed to save session summary:", err);
  }
}