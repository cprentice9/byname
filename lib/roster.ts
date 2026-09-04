import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NAMES } from "./names.ts";

export type Task = {
  description: string;
  prompt: string;
  started_at: string;
  finished_at?: string;
  report?: string;
};

export type Agent = {
  name: string;
  type: string;
  model: string;
  status: "working" | "done";
  context_tokens?: number;
  tasks: Task[];
};

export type Pending = {
  tool_use_id: string;
  description: string;
  prompt: string;
  model: string;
  type: string;
  at: string;
};

export type Roster = {
  version: number;
  agents: Record<string, Agent>;
  pending: Pending[];
};

export const PROMPT_LIMIT = 500;
export const REPORT_LIMIT = 2000;

export function trunc(text: unknown, limit: number): string {
  const s = typeof text === "string" ? text : "";
  return s.length > limit ? s.slice(0, limit) : s;
}

// The session folder that already holds subagents/. It survives restarts,
// so the roster outlives the process that made the names.
export function rosterPath(payload: any): string {
  return join(dirname(payload.transcript_path), payload.session_id, "byname.json");
}

export function load(path: string): Roster {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (data && data.version === 1 && data.agents) {
      return { version: 1, agents: data.agents, pending: data.pending ?? [] };
    }
  } catch {}
  return { version: 1, agents: {}, pending: [] };
}

export function save(path: string, roster: Roster): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + "." + process.pid + ".tmp";
  writeFileSync(temp, JSON.stringify(roster, null, 2));
  renameSync(temp, path);
}

export function pickName(roster: Roster): string {
  const used = new Set(Object.values(roster.agents).map((a) => a.name.toLowerCase()));
  for (const name of NAMES) if (!used.has(name.toLowerCase())) return name;
  for (let round = 2; ; round++) {
    for (const name of NAMES) {
      const candidate = name + " " + round;
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
  }
}

export function findByName(roster: Roster, name: string): string | undefined {
  const wanted = String(name ?? "").trim().toLowerCase();
  return Object.keys(roster.agents).find((id) => roster.agents[id].name.toLowerCase() === wanted);
}

// Every hook runs through this. An error on our side must never block the
// user's session, so we log to stderr and still exit 0.
export async function run(handler: (payload: any) => unknown): Promise<void> {
  try {
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const output = handler(JSON.parse(raw));
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (error) {
    console.error("byname: " + (error instanceof Error ? error.message : String(error)));
  }
}

export function additionalContext(event: string, text: string): unknown {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}
