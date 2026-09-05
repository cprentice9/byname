# byname

Call your Claude Code subagents back by name.

Byname is a Claude Code plugin. When the main agent delegates work to a subagent, Byname gives that subagent a human name, records what it is working on and how much context it has used, and keeps the list across sessions. Come back later, resume the session, and ask for the same agent by name to pick up where it left off.

## How it works

A hook on `SubagentStart` picks the next unused name and tells the subagent to sign its report with it. Another hook injects the roster into the main session at every prompt, so the names survive compaction and restarts. A hook after each Agent call tells the main agent whose report it just read.

There are two ways to continue an agent. If the `SendMessage` tool is available, Byname turns the name into the agent id and the message goes to the live agent. If it is not, the main agent puts the name first in an Agent call description. Byname then reads that agent's earlier transcript, puts a short briefing at the top of the new prompt, and the roster treats the new instance as the same named agent.

Every tool call a subagent makes goes into a per-agent activity log next to its transcript, with a context reading after each call. `/byname` writes a self-contained HTML page into the session folder and shows it, with a context bar per agent and the tool calls behind a toggle. `/byname text` prints the plain version instead.

The roster is a `byname.json` file in the session folder that already holds the subagent transcripts, so it lasts as long as the session does.

## Install

```
claude plugin marketplace add cprentice9/byname
claude plugin install byname@cprentice9
```
