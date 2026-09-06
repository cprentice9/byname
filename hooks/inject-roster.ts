import { activity, activityPath, additionalContext, extractSummary, load, rosterPath, run, sessionDir, update } from "../lib/roster.ts";

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

// 32-bit FNV-1a. Short enough to store, and no crypto import for a value that
// only has to change when the roster text changes.
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

const HEADER = [
  "Byname roster for this session. Attribute every subagent report to its agent by name.",
  "To continue an agent: if the SendMessage tool is available, call it with \"to\" set to the name.",
  "If SendMessage is not available, call Agent with the same subagent_type and model and put the name",
  'first in the description, for example "Otto: cut one sentence". Byname then briefs the new instance',
  "on its earlier work. Agents:",
].join(" ");

run((payload) => {
  const path = rosterPath(payload);
  const roster = load(path);
  const ids = Object.keys(roster.agents);
  if (!ids.length) return null;

  const lines = ids.map((id) => {
    const agent = roster.agents[id];
    const size = agent.context_tokens ? `, ${(agent.context_tokens / 1000).toFixed(1)}k context` : "";
    const count = agent.ids.length > 1 ? `, ${agent.ids.length} instances` : "";
    const calls = activity(activityPath(sessionDir(payload), id)).filter((e) => e.event === "start").length;
    const tools = calls ? `, ${calls} tool calls` : "";
    const task = agent.tasks[agent.tasks.length - 1];
    const last = task ? ` Last task: ${flat(task.description)}.` : "";
    // Rosters written before summaries existed still have a report, so read
    // one out of it here rather than rewriting the file.
    const summary = task?.summary ?? (task?.report ? extractSummary(agent.name, task.report).summary : "");
    const did = summary
      ? ` Did: ${flat(summary)}`
      : task?.report
        ? ` Report: ${flat(task.report).slice(0, 200)}`
        : "";
    return `- ${agent.name} (${agent.model}, ${agent.type}, ${agent.status}${size}${count}${tools}).${last}${did}`;
  });

  const mark = fingerprint(lines.join("\n"));
  const fresh = payload.hook_event_name === "SessionStart" || payload.hook_event_name === "PostCompact";
  // The /byname skill reads this line to find the roster it should print, so
  // both the full text and the short one end with it.
  const file = "Roster file: " + path;

  // A copy of the roster is already in the transcript and nothing in it has
  // changed, so send a reminder that it is there instead of repeating it.
  if (!fresh && roster.injected === mark) {
    const names = ids.map((id) => roster.agents[id].name).join(", ");
    const count = ids.length === 1 ? "1 agent" : ids.length + " agents";
    return additionalContext(
      payload.hook_event_name,
      `Byname: ${count} on the roster: ${names}. Run /byname for details. ${file}`,
    );
  }

  update(path, (r) => {
    r.injected = mark;
  });
  return additionalContext(payload.hook_event_name, HEADER + "\n" + lines.join("\n") + "\n" + file);
});
