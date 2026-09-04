import {
  PROMPT_LIMIT,
  activityPath,
  appendActivity,
  briefing,
  findByName,
  rosterPath,
  run,
  sessionDir,
  trunc,
  update,
} from "../lib/roster.ts";

const firstWord = (text: unknown): string =>
  String(text ?? "")
    .trim()
    .split(/\s+/)[0]
    .replace(/[:,]+$/, "");

const flat = (text: unknown): string => String(text ?? "").replace(/\s+/g, " ").trim();

function summarize(tool: string, input: any): string {
  if (tool === "Read" || tool === "Edit" || tool === "Write") return flat(input.file_path);
  if (tool === "NotebookEdit") return flat(input.notebook_path);
  if (tool === "Grep" || tool === "Glob") return flat(input.pattern);
  if (tool === "Agent") return flat(input.description);
  if (tool === "SendMessage") return flat(input.summary ?? input.to);
  if (tool === "WebFetch") return flat(input.url);
  if (tool === "Bash") return flat(input.command).slice(0, 80);
  return flat(JSON.stringify(input)).slice(0, 80);
}

run((payload) => {
  const path = rosterPath(payload);
  const input = payload.tool_input ?? {};

  // A tool call carrying an agent id is a call the subagent made, so it goes
  // in that agent's activity log whatever the tool is.
  if (payload.agent_id) {
    appendActivity(activityPath(sessionDir(payload), payload.agent_id), {
      at: new Date().toISOString(),
      event: "start",
      tool: payload.tool_name,
      summary: summarize(payload.tool_name, input),
      tool_use_id: payload.tool_use_id,
    });
  }

  if (payload.tool_name === "Agent") {
    // Without SendMessage the only way back to an agent is a fresh Agent call
    // addressed to its name, so a leading name means resume, not a new agent.
    let output: unknown = null;
    update(path, (roster) => {
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

      if (!id) return;
      output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: { ...input, prompt: briefing(sessionDir(payload), roster, id) + prompt },
        },
      };
    });
    return output;
  }

  if (payload.tool_name !== "SendMessage") return null;

  const to = String(input.to ?? "");
  let resolved: string | undefined;
  update(path, (roster) => {
    const id = roster.agents[to] ? to : findByName(roster, to);
    if (!id) return false;
    resolved = id;
    const message = String(input.message ?? "");
    roster.agents[id].status = "working";
    roster.agents[id].tasks.push({
      description: input.summary ? String(input.summary) : message.slice(0, 80),
      prompt: trunc(message, PROMPT_LIMIT),
      started_at: new Date().toISOString(),
    });
  });

  if (!resolved || resolved === to) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...input, to: resolved },
    },
  };
});
