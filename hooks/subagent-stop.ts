import { REPORT_LIMIT, contextTokens, rosterPath, run, trunc, update } from "../lib/roster.ts";

run((payload) => {
  update(rosterPath(payload), (roster) => {
    const agent = roster.agents[payload.agent_id];
    if (!agent) return false;

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
  });
  return null;
});
