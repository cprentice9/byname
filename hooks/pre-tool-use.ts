import {
  PROMPT_LIMIT,
  briefing,
  findByName,
  load,
  rosterPath,
  run,
  save,
  sessionDir,
  trunc,
} from "../lib/roster.ts";

const firstWord = (text: unknown): string =>
  String(text ?? "")
    .trim()
    .split(/\s+/)[0]
    .replace(/[:,]+$/, "");

run((payload) => {
  const path = rosterPath(payload);
  const roster = load(path);
  const input = payload.tool_input ?? {};

  if (payload.tool_name === "Agent") {
    // Without SendMessage the only way back to an agent is a fresh Agent call
    // addressed to its name, so a leading name means resume, not a new agent.
    const lead = firstWord(input.description);
    let id = findByName(roster, lead);
    let description = String(input.description ?? "");
    if (id) description = description.trim().slice(lead.length).replace(/^[:,\s]+/, "");
    else id = findByName(roster, firstWord(input.prompt));

    const prompt = String(input.prompt ?? "");
    roster.pending.push({
      tool_use_id: payload.tool_use_id,
      description,
      prompt: trunc(prompt, PROMPT_LIMIT),
      model: input.model ?? "",
      type: input.subagent_type ?? "",
      at: new Date().toISOString(),
      ...(id ? { resume_of: id } : {}),
    });
    save(path, roster);

    if (!id) return null;
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...input, prompt: briefing(sessionDir(payload), roster, id) + prompt },
      },
    };
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
