import { additionalContext, rosterPath, run, update } from "../lib/roster.ts";

// The main agent tends to drop the signature when it relays a report, so the
// name has to reach it as hook context instead.
run((payload) => {
  const agentId = payload.tool_response?.agentId;
  let text: string | null = null;
  let changed = false;

  update(rosterPath(payload), (roster) => {
    const ids = Object.keys(roster.agents);
    const mine = agentId ? ids.find((key) => roster.agents[key].ids.at(-1) === agentId) : undefined;
    const owner = ids.find((key) =>
      roster.agents[key].tasks.some(
        (task) => task.tool_use_id && task.tool_use_id === payload.tool_use_id,
      ),
    );

    // Two agents spawned in one turn can each be handed the other's task,
    // because a SubagentStart cannot tell which pending Agent call made it.
    // The tool result names the agent, so swap the tasks back here.
    if (mine && owner && mine !== owner) {
      const theirs = roster.agents[owner].tasks.find((t) => t.tool_use_id === payload.tool_use_id);
      const near = (t: { started_at: string }) =>
        Math.abs(Date.parse(t.started_at) - Date.parse(theirs?.started_at ?? ""));
      const candidates = roster.agents[mine].tasks.filter(
        (t) => t.tool_use_id !== payload.tool_use_id,
      );
      candidates.sort((a, b) => near(a) - near(b));
      const ours = candidates[0] ?? roster.agents[mine].tasks.at(-1);
      if (theirs && ours) {
        const swap = {
          description: ours.description,
          prompt: ours.prompt,
          started_at: ours.started_at,
          tool_use_id: ours.tool_use_id,
        };
        ours.description = theirs.description;
        ours.prompt = theirs.prompt;
        ours.started_at = theirs.started_at;
        ours.tool_use_id = theirs.tool_use_id;
        Object.assign(theirs, swap);
        changed = true;
      }
    }

    const id = mine ?? owner;
    if (!id) return false;
    const agent = roster.agents[id];
    const lead = agent.status === "done" ? "that report was from" : "that agent is";
    text = `Byname: ${lead} ${agent.name} (${agent.model}). When you relay its report, attribute it to ${agent.name}.`;
    if (!changed) return false;
  });

  return text ? additionalContext(payload.hook_event_name, text) : null;
});
