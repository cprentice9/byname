import { join } from "node:path";
import { activityPath, appendActivity, contextTokens, run, sessionDir } from "../lib/roster.ts";

run((payload) => {
  const id = payload.agent_id;
  if (!id) return null;

  const dir = sessionDir(payload);
  const path = activityPath(dir, id);
  const at = new Date().toISOString();
  appendActivity(path, {
    at,
    event: "done",
    tool: payload.tool_name,
    tool_use_id: payload.tool_use_id,
    duration_ms: payload.duration_ms,
    ok: payload.hook_event_name !== "PostToolUseFailure",
  });

  // Context grows with every tool result, so take a reading after each call.
  // A subagent payload carries the main transcript path, not its own, so the
  // agent transcript has to be built from the id.
  const transcript = join(dir, "subagents", "agent-" + id + ".jsonl");
  try {
    const tokens = contextTokens(transcript);
    if (tokens) appendActivity(path, { at, event: "context", tokens });
  } catch {}
  return null;
});
