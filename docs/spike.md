# Spike findings

Tested 2026-09-04 on Claude Code 2.1.261, Windows 11, Node 24. Everything below comes from real hook payloads and transcript files, captured with the hook in `.claude/hooks/dump.mjs` while running headless sessions with `claude -p`.

## What works natively

- A subagent can be resumed after the main session has fully exited and been resumed with `--resume`. `SendMessage` with `to` set to the agent id appended the new question to the subagent's own transcript and it answered from prior context.
- `SubagentStart` fires again on resume, with the same `agent_id`. So a hook sees both fresh spawns and resumes, and can tell them apart by whether it has seen the id before.
- `additionalContext` returned from a `SubagentStart` hook reaches the subagent. Told "your name is Maya, begin your report with 'Maya here.'", the agent did exactly that, on the first run and on resume.
- Every hook event carries `session_id`, `transcript_path`, and `cwd`. Events inside a subagent also carry `agent_id` and `agent_type`.
- `SubagentStop` carries `agent_transcript_path` and `last_assistant_message`, so the final report needs no transcript parsing.

## What does not work natively

- Asking for an agent by name after resume fails. `SendMessage` to "Maya" returned "No agent named 'Maya' is reachable" and `ListAgents` did not list her. Names live only in the live process. Byname has to own the name to id mapping and hand it back to the main agent.
- The Agent tool in this build has no `name` parameter. The model was asked to pass `name: 'Maya'` and the recorded `tool_input` had only description, prompt, subagent_type, model, and run_in_background. Naming has to happen in a hook.

## Files on disk

```
~/.claude/projects/<project>/<session-id>.jsonl                          main transcript
~/.claude/projects/<project>/<session-id>/subagents/agent-<id>.jsonl     subagent transcript
~/.claude/projects/<project>/<session-id>/subagents/agent-<id>.meta.json {agentType, description, toolUseId, spawnDepth, model}
```

The meta file already records the agent's type, the one line description the main agent gave it, and its model. The roster only needs to add the name, the task history, and context counts.

## Context size

Each `assistant` line in a subagent transcript has `message.usage`. Context in use at that turn is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Maya's single turn came to 41,620 tokens, almost all of it the system prompt and tool definitions. Read the last assistant line to get the current figure.

## Hook payload shapes

`PreToolUse` on Agent, main session:

```json
{
  "session_id": "...", "transcript_path": "...", "cwd": "...", "prompt_id": "...",
  "hook_event_name": "PreToolUse", "tool_name": "Agent", "tool_use_id": "toolu_...",
  "tool_input": { "description": "...", "prompt": "...", "subagent_type": "general-purpose", "model": "sonnet", "run_in_background": false }
}
```

`SubagentStart`:

```json
{ "session_id": "...", "transcript_path": "...", "cwd": "...", "prompt_id": "...",
  "agent_id": "a1dfcc3972f2c3795", "agent_type": "general-purpose", "hook_event_name": "SubagentStart" }
```

`SubagentStop` adds `agent_transcript_path`, `last_assistant_message`, `stop_hook_active`, `permission_mode`, `effort`, `background_tasks`, `session_crons`.

## What this means for the design

1. Name at `SubagentStart`, not at the Agent call. The hook picks the next unused name for a new id, or looks up the existing name for a resumed id, and returns it as `additionalContext`.
2. Persist the roster next to the session's subagents folder, keyed by agent id. It survives restarts because that folder does.
3. Inject the roster into the main session at `SessionStart` and `UserPromptSubmit`, so "ask Maya" resolves to the id even after compaction or a restart. Since name lookup is not native, this is the whole feature.
4. Link the `PreToolUse` Agent call to the `SubagentStart` that follows it by `prompt_id`, or by `toolUseId` in the meta file, to attach the task description to the name.
