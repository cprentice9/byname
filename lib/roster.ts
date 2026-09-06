import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { NAMES } from "./names.ts";

export type Task = {
  description: string;
  prompt: string;
  started_at: string;
  finished_at?: string;
  report?: string;
  summary?: string;
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
  // Fingerprint of the agent lines in the last full injection. While it
  // matches, prompts get a one line reminder instead of the whole roster.
  injected?: string;
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
      return { version: 1, agents: data.agents, pending: data.pending ?? [], injected: data.injected };
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

const LOCK_WAIT_MS = 500;
const LOCK_STALE_MS = 5000;
const TAIL_BYTES = 65536;

function takeLock(lock: string): boolean {
  const deadline = Date.now() + LOCK_WAIT_MS;
  const idle = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(lock, { recursive: false });
      return true;
    } catch (error: any) {
      if (error?.code !== "EEXIST") return false;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {}
      if (Date.now() >= deadline) return false;
      // No sleep in sync node, so park the thread on a buffer nobody wakes.
      Atomics.wait(idle, 0, 0, 10);
    }
  }
}

// Several hooks can write the roster at once when agents run in parallel.
// Load, change and save under one lock so an update cannot lose another.
export function update(path: string, fn: (roster: Roster) => unknown): void {
  const lock = path + ".lock";
  const locked = takeLock(lock);
  if (!locked) console.error("byname: roster lock busy, writing without it");
  try {
    const roster = load(path);
    if (fn(roster) !== false) save(path, roster);
  } finally {
    if (locked) {
      try {
        rmSync(lock, { recursive: true, force: true });
      } catch {}
    }
  }
}

export function activityPath(sessionDir: string, agentId: string): string {
  return join(sessionDir, "subagents", "agent-" + agentId + ".byname.jsonl");
}

export function appendActivity(path: string, entry: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n");
}

export function activity(path: string): any[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Context in use is the last assistant turn's input plus both cache figures.
// Only the tail of the transcript can hold that line, so read no more.
export function contextTokens(transcript: string): number | undefined {
  const fd = openSync(transcript, "r");
  let text: string;
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    text = buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }

  let total: number | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const usage = entry.type === "assistant" ? entry.message?.usage : undefined;
      if (!usage) continue;
      total =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
    } catch {}
  }
  return total;
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

// Agents are asked to end a report with "Name: what I did". When they do, that
// line is the summary and it leaves the report. When they do not, take the
// first sentence with the markdown noise stripped out.
export function extractSummary(name: string, report: string): { summary: string; report: string } {
  const text = typeof report === "string" ? report : "";
  const lines = text.split("\n");
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  const line = last >= 0 ? lines[last] : "";
  const colon = line.indexOf(":");
  const head = colon > 0 ? line.slice(0, colon).trim().toLowerCase() : "";
  const tail = colon > 0 ? line.slice(colon + 1).trim() : "";
  if (tail && head && head === String(name ?? "").trim().toLowerCase()) {
    lines.splice(last, 1);
    return { summary: tail, report: lines.join("\n").trim() };
  }

  const plain = text
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const end = plain.search(/[.!?] /);
  return { summary: trunc(end >= 0 ? plain.slice(0, end + 1) : plain, 160), report: text };
}
