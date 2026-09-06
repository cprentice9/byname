# Byname

Names for your Claude Code subagents, and a way to call them back.

When Claude Code delegates work to a subagent, that agent is an anonymous hex id that vanishes when the session ends. Byname gives each one a human name, keeps a roster of who did what, and lets you say "ask Otto to finish that" days later and have Otto pick up where he left off.

## What it looks like

```
You:    Delegate two tasks to Sonnet agents: count the files in this repo,
        and summarise the README in two sentences.

Claude: Maya counted 389 tracked files. The three largest are ...
        Otto's summary: The README documents a Django 5.2 site that ...

You:    /byname
```

`/byname` opens a page listing every agent in the session, with the model it ran on, what it was asked, one sentence on what it did, how many tool calls it made, and how much context it used.

Close the session. Come back tomorrow, resume it, and:

```
You:    Ask Otto which sentence of his summary he would cut.

Claude: Otto would cut the second sentence, because ...
```

## What you get

- Every subagent gets a first name from a fixed list, in order: Maya, Otto, Iris, Felix, Nadia, and so on.
- The main agent always knows who exists. It attributes reports by name and can address any agent by name, even after a restart or a context compaction.
- A roster per session with each agent's tasks, one line summaries, tool call counts, and context use. `/byname` shows it as a page, `/byname text` prints it plain.
- Two ways to continue an agent. In the CLI the live agent resumes with its full history. In the desktop app, where Claude Code has no tool for messaging a subagent, Byname spawns a new instance of the same name and briefs it with a digest of its earlier transcript.

## Install

```
claude plugin marketplace add cprentice9/byname
claude plugin install byname@cprentice9
```

Works in the CLI and the desktop app. Needs Node 22.18 or later, so it can run the TypeScript files directly. No other dependencies.

## How it works

Byname is a set of hooks, small scripts Claude Code runs at fixed moments, plus one JSON file per session.

1. When the main agent starts a subagent, a hook records the task.
2. When the subagent starts, a hook assigns the next unused name and tells the agent to end its report with "Name: one sentence on what I did".
3. Every tool call the subagent makes goes into an activity log next to its transcript, with a context reading after each call.
4. When the subagent finishes, a hook stores its report and summary.
5. When the report reaches the main agent, a hook says which agent it came from, so the name survives even if the report text gets trimmed.
6. On each prompt, a hook reminds the main agent who is on the roster. The full roster goes in only when something changed, otherwise one short line.
7. When the main agent messages an agent by name, a hook swaps the name for the id Claude Code expects. When no messaging tool exists, a name at the front of a new Agent call triggers the briefing path instead.

The roster lives at `~/.claude/projects/<project>/<session>/byname.json`, beside the subagent transcripts, so it lasts exactly as long as the session does.

## Cost

About 50 tokens per prompt for the roster reminder, about 300 when the roster changes, and about 60 tokens per subagent for the name instruction and the closing line. A briefing resume adds up to 2,000 tokens to that one call. The hooks themselves cost no tokens, only a short Node process per tool call.

## Limits

- An agent belongs to one session. Otto from Tuesday's session does not exist in Wednesday's.
- The briefing resume is a new instance with notes, not the original agent's memory. The roster shows which kind of resume happened.
- Explore and Plan agents return no id, so Claude Code cannot resume them. Use general-purpose or a custom agent for work you might want to continue.

## Development

```
claude --plugin-dir /path/to/byname
```

Run that from any project other than this repo. After pushing a change, bump the version in `.claude-plugin/plugin.json`, then:

```
claude plugin marketplace update cprentice9
claude plugin update byname@cprentice9
```

`docs/spike.md` records what was tested against Claude Code 2.1.261 before the first line of the plugin was written.
