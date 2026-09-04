import { additionalContext, load, rosterPath, run } from "../lib/roster.ts";

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const HEADER = [
  "Byname roster for this session. Attribute every subagent report to its agent by name.",
  "To continue an agent: if the SendMessage tool is available, call it with \"to\" set to the name.",
  "If SendMessage is not available, call Agent with the same subagent_type and model and put the name",
  'first in the description, for example "Otto: cut one sentence". Byname then briefs the new instance',
  "on its earlier work. Agents:",
].join(" ");

run((payload) => {
  const roster = load(rosterPath(payload));
  const ids = Object.keys(roster.agents);
  if (!ids.length) return null;

  const lines = ids.map((id) => {
    const agent = roster.agents[id];
    const size = agent.context_tokens ? `, ${(agent.context_tokens / 1000).toFixed(1)}k context` : "";
    const count = agent.ids.length > 1 ? `, ${agent.ids.length} instances` : "";
    const task = agent.tasks[agent.tasks.length - 1];
    const last = task ? ` Last task: ${flat(task.description)}.` : "";
    const report = task?.report ? ` Report: ${flat(task.report).slice(0, 200)}` : "";
    return `- ${agent.name} (${agent.model}, ${agent.type}, ${agent.status}${size}${count}).${last}${report}`;
  });

  return additionalContext(payload.hook_event_name, HEADER + "\n" + lines.join("\n"));
});
