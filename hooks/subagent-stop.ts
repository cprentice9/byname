import { readFileSync } from "node:fs";
import { REPORT_LIMIT, load, rosterPath, run, save, trunc } from "../lib/roster.ts";

function contextTokens(transcript: string): number | undefined {
  let total: number | undefined;
  for (const line of readFileSync(transcript, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "assistant") continue;
      const usage = entry.message?.usage;
      if (!usage) continue;
      total =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
    } catch {}
  }
  return total;
}

run((payload) => {
  const path = rosterPath(payload);
  const roster = load(path);
  const agent = roster.agents[payload.agent_id];
  if (!agent) return null;

  agent.status = "done";
  const task = agent.tasks[agent.tasks.length - 1];
  if (task) {
    task.finished_at = new Date().toISOString();
    task.report = trunc(payload.last_assistant_message, REPORT_LIMIT);
  }
  if (payload.agent_transcript_path) {
    try {
      agent.context_tokens = contextTokens(payload.agent_transcript_path);
    } catch {}
  }
  save(path, roster);
  return null;
});
