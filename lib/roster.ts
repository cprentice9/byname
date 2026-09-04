import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NAMES } from "./names.ts";

export type Task = {
  description: string;
  prompt: string;
  started_at: string;
  finished_at?: string;
  report?: string;
  tool_use_id?: string;
};

export type Agent = {
  name: string;
  // Every instance id this agent has had, oldest first. The record is keyed
  // by the latest one.
  ids: string[];
  type: string;
  model: string;
  status: "working" | "done";
  context_tokens?: number;
  tasks: Task[];
};

export type Pending = {
  tool_use_id?: string;
  description: string;
  prompt: string;
  model: string;
  type: string;
  at: string;
  resume_of?: string;
};

export type Roster = {
  version: number;
  agents: Record<string, Agent>;
  pending: Pending[];
};

export const PROMPT_LIMIT = 500;
export const REPORT_LIMIT = 2000;
const BRIEF_ITEM_LIMIT = 1500;

export function trunc(text: unknown, limit: number): string {
  const s = typeof text === "string" ? text : "";
  return s.length > limit ? s.slice(0, limit) : s;
}

// The session folder that already holds subagents/. It survives restarts,
// so the roster outlives the process that made the names.
export function sessionDir(payload: any): string {
  return join(dirname(payload.transcript_path), payload.session_id);
}

export function rosterPath(payload: any): string {
  return join(sessionDir(payload), "byname.json");
}

export function load(path: string): Roster {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (data && data.version === 1 && data.agents) {
      for (const id of Object.keys(data.agents)) {
        if (!Array.isArray(data.agents[id].ids)) data.agents[id].ids = [id];
      }
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
  if (!wanted) return undefined;
  return Object.keys(roster.agents).find((id) => roster.agents[id].name.toLowerCase() === wanted);
}

// A new instance of an agent cannot see the old one's context, so we hand it a
// digest of its own earlier transcript instead.
export function briefing(sessionDir: string, roster: Roster, agentId: string, limit = 8000): string {
  const agent = roster.agents[agentId];
  const items: string[] = [];
  const tools = new Set<string>();
  const files = new Set<string>();

  try {
    const raw = readFileSync(join(sessionDir, "subagents", "agent-" + agentId + ".jsonl"), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const content = entry.message?.content;
      if (entry.type === "user" && typeof content === "string") {
        items.push("[Task] " + trunc(content, BRIEF_ITEM_LIMIT));
      } else if (entry.type === "assistant" && Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "text" && block.text) {
            items.push("[You] " + trunc(block.text, BRIEF_ITEM_LIMIT));
          } else if (block?.type === "tool_use") {
            if (block.name) tools.add(String(block.name));
            const input = block.input ?? {};
            for (const key of ["file_path", "path", "notebook_path"]) {
              if (typeof input[key] === "string") files.add(input[key]);
            }
          }
        }
      }
    }
  } catch {}

  if (!items.length) {
    for (const task of agent?.tasks ?? []) {
      if (task.description) items.push("[Task] " + trunc(task.description, BRIEF_ITEM_LIMIT));
      if (task.report) items.push("[You] " + trunc(task.report, BRIEF_ITEM_LIMIT));
    }
  }

  // Recent work matters most, so overflow drops the oldest items.
  let total = items.reduce((sum, item) => sum + item.length + 1, 0);
  while (items.length > 1 && total > limit) total -= (items.shift() as string).length + 1;

  const trailer = [
    tools.size ? "Tools you used: " + [...tools].join(", ") + "." : "",
    files.size ? "Files you touched: " + [...files].join(", ") + "." : "",
  ]
    .filter(Boolean)
    .join(" ");

  const lines = [
    `Byname briefing. You are ${agent?.name ?? "this agent"}. You worked earlier in this session and this is a new instance of you, so here is what you did.`,
    ...items,
  ];
  if (trailer) lines.push(trailer);
  lines.push("End of briefing. New request follows.", "");
  return lines.join("\n") + "\n";
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
