import { additionalContext, load, rosterPath, run } from "../lib/roster.ts";

// The main agent tends to drop the signature when it relays a report, so the
// name has to reach it as hook context instead.
run((payload) => {
  const roster = load(rosterPath(payload));
  const id = Object.keys(roster.agents).find((key) =>
    roster.agents[key].tasks.some((task) => task.tool_use_id && task.tool_use_id === payload.tool_use_id),
  );
  if (!id) return null;

  const agent = roster.agents[id];
  const lead = agent.status === "done" ? "that report was from" : "that agent is";
  return additionalContext(
    payload.hook_event_name,
    `Byname: ${lead} ${agent.name} (${agent.model}). When you relay its report, attribute it to ${agent.name}.`,
  );
});
