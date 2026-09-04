import { additionalContext, load, rosterPath, run } from "../lib/roster.ts";

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

run((payload) => {
  const roster = load(rosterPath(payload));
  const ids = Object.keys(roster.agents);
  if (!ids.length) return null;

  const lines = ids.map((id) => {
    const agent = roster.agents[id];
    const size = agent.context_tokens ? `, ${(agent.context_tokens / 1000).toFixed(1)}k context` : "";
    const task = agent.tasks[agent.tasks.length - 1];
    const last = task ? ` Last task: ${flat(task.description)}.` : "";
    const report = task?.report ? ` Report: ${flat(task.report).slice(0, 200)}` : "";
    return `- ${agent.name} (${agent.model}, ${agent.type}, ${agent.status}${size}).${last}${report}`;
  });

  return additionalContext(
    payload.hook_event_name,
    'Byname roster for this session. To continue an agent, call SendMessage with "to" set to its name; Byname resolves it. Agents:\n' +
      lines.join("\n"),
  );
});
