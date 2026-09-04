---
name: byname
description: Show the Byname roster: every subagent in this session by name, what it did, and its context use.
---

# Byname roster

Find the "Roster file:" line in the Byname roster context in this session. Run:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/byname.ts" "<roster path>"
```

Print the output to the user verbatim inside a code block, then stop. Add `--tools` after the path if the user asks for the tool calls.

If there is no Byname context, or it has no "Roster file:" line, say "Byname has no agents in this session yet."
