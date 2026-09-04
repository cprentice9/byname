import { PROMPT_LIMIT, findByName, load, rosterPath, run, save, trunc } from "../lib/roster.ts";

run((payload) => {
  const path = rosterPath(payload);
  const roster = load(path);
  const input = payload.tool_input ?? {};

  if (payload.tool_name === "Agent") {
    roster.pending.push({
      tool_use_id: payload.tool_use_id,
      description: input.description ?? "",
      prompt: trunc(input.prompt, PROMPT_LIMIT),
      model: input.model ?? "",
      type: input.subagent_type ?? "",
      at: new Date().toISOString(),
    });
    save(path, roster);
    return null;
  }

  if (payload.tool_name !== "SendMessage") return null;

  const to = String(input.to ?? "");
  const id = roster.agents[to] ? to : findByName(roster, to);
  if (!id) return null;

  const message = String(input.message ?? "");
  roster.agents[id].status = "working";
  roster.agents[id].tasks.push({
    description: input.summary ? String(input.summary) : message.slice(0, 80),
    prompt: trunc(message, PROMPT_LIMIT),
    started_at: new Date().toISOString(),
  });
  save(path, roster);

  if (id === to) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...input, to: id },
    },
  };
});
