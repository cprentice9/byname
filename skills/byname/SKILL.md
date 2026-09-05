---
name: byname
description: Show the Byname roster: every subagent in this session by name, what it did, and its context use.
---

# Byname roster

Find the "Roster file:" line in the Byname roster context in this session. If there is no Byname context, or it has no "Roster file:" line, say "Byname has no agents in this session yet." and stop.

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/byname.ts" "<roster path>" --html
```

It writes the page next to the roster and prints the path.

Then show the page. If a tool for sending files to the user is available, such as SendUserFile, call it with that path and display set to render. If not, open the file with the operating system:

- Windows: `cmd /c start "" "<path>"`
- macOS: `open "<path>"`
- Linux: `xdg-open "<path>"`

Tell the user in one line where the file is, then stop.

If the user asked for text, for example "/byname text", run the same command without `--html` and print the output in a code block instead. Add `--tools` after the path if the user asks for the tool calls.
