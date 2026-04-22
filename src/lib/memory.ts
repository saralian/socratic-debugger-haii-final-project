import fs from "fs";
import path from "path";

interface SessionEntry {
  date: string;
  bugCategory: string;
  sessionMemory: string;
}

const DATA_DIR = path.join(process.cwd(), "data", "users");

function userFilePath(userId: string): string {
  return path.join(DATA_DIR, `${userId}.json`);
}

export function loadUserContext(userId: string): string | null {
  if (!userId) return null;
  try {
    const p = userFilePath(userId);
    if (!fs.existsSync(p)) return null;
    const entries: SessionEntry[] = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!entries.length) return null;
    const recent = entries.slice(-5);
    return recent.map((e) => `[${e.date}] ${e.sessionMemory}`).join("\n");
  } catch {
    return null;
  }
}

export function saveSessionMemory(
  userId: string,
  entry: { bugCategory: string; sessionMemory: string }
): void {
  if (!userId) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const p = userFilePath(userId);
    let entries: SessionEntry[] = [];
    if (fs.existsSync(p)) {
      entries = JSON.parse(fs.readFileSync(p, "utf-8"));
    }
    entries.push({
      date: new Date().toISOString().split("T")[0],
      bugCategory: entry.bugCategory,
      sessionMemory: entry.sessionMemory,
    });
    fs.writeFileSync(p, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error("Failed to save session memory:", err);
  }
}
