import { additionalContext, load, pickName, rosterPath, run, save } from "../lib/roster.ts";

run((payload) => {
  const path = rosterPath(payload);
  const roster = load(path);
  const id = payload.agent_id;
  const existing = roster.agents[id];

  if (existing) {
    existing.status = "working";
    save(path, roster);
    return additionalContext(
      payload.hook_event_name,
      `Byname: welcome back, ${existing.name}. Sign your final report as ${existing.name}.`,
    );
  }

  // The Agent call that spawned us is the oldest pending entry, preferring one
  // whose subagent_type matches, since several can be in flight at once.
  let index = roster.pending.findIndex((p) => p.type === payload.agent_type);
  if (index < 0) index = roster.pending.length ? 0 : -1;
  const pending = index >= 0 ? roster.pending.splice(index, 1)[0] : undefined;

  const name = pickName(roster);
  roster.agents[id] = {
    name,
    type: payload.agent_type ?? pending?.type ?? "",
    model: pending?.model ?? "",
    status: "working",
    tasks: pending
      ? [{ description: pending.description, prompt: pending.prompt, started_at: pending.at }]
      : [],
  };
  save(path, roster);

  return additionalContext(
    payload.hook_event_name,
    `Byname: your name is ${name}. Sign your final report as ${name}.`,
  );
});
