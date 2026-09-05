import { additionalContext, pickName, rosterPath, run, update } from "../lib/roster.ts";

run((payload) => {
  const id = payload.agent_id;
  let text = "";

  update(rosterPath(payload), (roster) => {
    const existing = roster.agents[id];
    if (existing) {
      existing.status = "working";
      text = `Byname: welcome back, ${existing.name}. End your final report with one line in exactly this form: "${existing.name}: <one plain sentence saying what you did>".`;
      return;
    }

    // The Agent call that spawned us is the oldest pending entry, preferring one
    // whose subagent_type matches, since several can be in flight at once.
    let index = roster.pending.findIndex((p) => p.type === payload.agent_type);
    if (index < 0) index = roster.pending.length ? 0 : -1;
    const pending = index >= 0 ? roster.pending.splice(index, 1)[0] : undefined;

    const task = pending
      ? [
          {
            description: pending.description,
            prompt: pending.prompt,
            started_at: pending.at,
            tool_use_id: pending.tool_use_id,
          },
        ]
      : [];

    const prior = pending?.resume_of ? roster.agents[pending.resume_of] : undefined;
    if (prior && pending) {
      // A new instance of a known agent. Rekey the record so the roster keeps
      // pointing at the live id and the name carries over.
      delete roster.agents[pending.resume_of as string];
      prior.ids.push(id);
      prior.status = "working";
      prior.tasks.push(...task);
      roster.agents[id] = prior;
      text = `Byname: welcome back, ${prior.name}. Your briefing is at the top of your prompt. End your final report with one line in exactly this form: "${prior.name}: <one plain sentence saying what you did>".`;
      return;
    }

    const name = pickName(roster);
    roster.agents[id] = {
      name,
      ids: [id],
      type: payload.agent_type ?? pending?.type ?? "",
      model: pending?.model ?? "",
      status: "working",
      tasks: task,
    };
    text = `Byname: your name is ${name}. End your final report with one line in exactly this form: "${name}: <one plain sentence saying what you did>".`;
  });

  return text ? additionalContext(payload.hook_event_name, text) : null;
});
