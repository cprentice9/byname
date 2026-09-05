import { REPORT_LIMIT, contextTokens, extractSummary, rosterPath, run, trunc, update } from "../lib/roster.ts";

run((payload) => {
  update(rosterPath(payload), (roster) => {
    const agent = roster.agents[payload.agent_id];
    if (!agent) return false;

    agent.status = "done";
    const task = agent.tasks[agent.tasks.length - 1];
    if (task) {
      task.finished_at = new Date().toISOString();
      const found = extractSummary(agent.name, String(payload.last_assistant_message ?? ""));
      task.report = trunc(found.report, REPORT_LIMIT);
      if (found.summary) task.summary = found.summary;
    }
    if (payload.agent_transcript_path) {
      try {
        agent.context_tokens = contextTokens(payload.agent_transcript_path);
      } catch {}
    }
  });
  return null;
});
