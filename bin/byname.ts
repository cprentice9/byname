import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { activity, activityPath, extractSummary, load } from "../lib/roster.ts";

const CONTEXT_LIMIT = 200000;

type Call = { at: string; tool: string; summary: string; ok: boolean };
type TaskView = {
  started_at: string;
  finished_at?: string;
  description: string;
  summary: string;
  calls: Call[];
};
type AgentView = {
  name: string;
  model: string;
  type: string;
  status: string;
  instances: number;
  context_tokens?: number;
  tasks: TaskView[];
};
type RosterView = { project: string; agents: AgentView[] };

const flat = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();
const clock = (iso?: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "--:--");

function span(from?: string, to?: string): string {
  if (!from || !to) return "";
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  return seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m" + (seconds % 60) + "s";
}

// The main transcript sits beside the session folder under the same name, and
// its header lines carry the project folder the session runs in.
function projectName(dir: string): string {
  try {
    const head = readFileSync(dir + ".jsonl", "utf8").slice(0, 65536);
    const found = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    if (!found) return "";
    const cwd = JSON.parse('"' + found[1] + '"') as string;
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? "";
  } catch {
    return "";
  }
}

function gather(path: string): RosterView {
  const roster = load(path);
  const dir = dirname(path);
  const first = (id: string) => Date.parse(roster.agents[id].tasks[0]?.started_at ?? "") || 0;
  const ids = Object.keys(roster.agents).sort((a, b) => first(a) - first(b));

  const agents = ids.map((id) => {
    const agent = roster.agents[id];
    const events = activity(activityPath(dir, id));
    const failed = new Set<string>();
    for (const event of events) {
      if (event.event === "done" && event.ok === false && event.tool_use_id) {
        failed.add(event.tool_use_id);
      }
    }
    const starts = events.filter((e) => e.event === "start");

    const tasks = agent.tasks.map((task) => {
      const from = Date.parse(task.started_at) || 0;
      const to = task.finished_at ? Date.parse(task.finished_at) : Date.now();
      const calls = starts
        .filter((e) => {
          const at = Date.parse(e.at) || 0;
          return at >= from && at <= to;
        })
        .map((e) => ({
          at: String(e.at ?? ""),
          tool: String(e.tool ?? "?"),
          summary: flat(e.summary),
          ok: !failed.has(e.tool_use_id),
        }));
      // Older rosters have no summary, so read one out of the report here.
      const summary = task.summary ?? (task.report ? extractSummary(agent.name, task.report).summary : "");
      return {
        started_at: task.started_at,
        finished_at: task.finished_at,
        description: flat(task.description),
        summary: flat(summary) || (task.report ? flat(task.report).slice(0, 120) : ""),
        calls,
      };
    });

    return {
      name: agent.name,
      model: String(agent.model || "?"),
      type: String(agent.type || "?"),
      status: agent.status,
      instances: agent.ids.length,
      context_tokens: agent.context_tokens,
      tasks,
    };
  });

  return { project: projectName(dir), agents };
}

function renderText(view: RosterView, withTools: boolean): string {
  if (!view.agents.length) return "No agents yet.";
  const out: string[] = [];
  for (const agent of view.agents) {
    const size = agent.context_tokens ? (agent.context_tokens / 1000).toFixed(1) + "k" : "";
    const copies = agent.instances > 1 ? agent.instances + " instances" : "";
    out.push(
      [
        agent.name.padEnd(10),
        agent.model.padEnd(10),
        agent.type.padEnd(18),
        agent.status.padEnd(8),
        size.padEnd(7),
        copies,
      ]
        .join(" ")
        .trimEnd(),
    );

    for (const task of agent.tasks) {
      const count = task.calls.length;
      out.push(
        "  " +
          [
            clock(task.started_at),
            span(task.started_at, task.finished_at).padEnd(6),
            (count + (count === 1 ? " call" : " calls")).padEnd(9),
            task.description,
          ]
            .join(" ")
            .trimEnd(),
      );
      if (task.summary) out.push("      " + task.summary);
      if (!withTools) continue;
      for (const call of task.calls) {
        out.push("      " + clock(call.at) + "  " + call.tool.padEnd(12) + call.summary);
      }
    }
    out.push("");
  }
  return out.join("\n");
}

const esc = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const STYLE = `
:root {
  --page: #fcfcfb;
  --ink: #0b0b0b;
  --muted: #52514e;
  --rule: #e8e7e3;
  --track: #f0efec;
  --accent: #d97757;
  --red: #B42318;
  --serif: "Charter", "Iowan Old Style", "Georgia", serif;
  --sans: "Segoe UI", system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #151515;
    --ink: #f0efec;
    --muted: #a3a19c;
    --rule: #2c2c2c;
    --track: #262626;
    --accent: #d97757;
    --red: #F97066;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font: 15px/1.5 var(--sans);
}
main { max-width: 720px; padding: 40px 32px 64px; }
h1 { font: 400 2rem/1.2 var(--serif); margin: 0 0 8px; }
.written { color: var(--muted); margin: 0 0 40px; font-variant-numeric: tabular-nums; }
.empty { margin: 0; }
.agent + .agent { border-top: 1px solid var(--rule); margin-top: 32px; padding-top: 32px; }
h2 { font: 400 1.6rem/1.2 var(--serif); color: var(--accent); margin: 0 0 8px; }
.meta { color: var(--muted); margin: 0 0 16px; white-space: pre-wrap; }
.meta .working { color: var(--ink); }
.context { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.track { flex: 1; height: 6px; border-radius: 3px; background: var(--track); }
.fill { height: 6px; border-radius: 3px; background: var(--accent); }
.figure { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tasks { list-style: none; margin: 0; padding: 0; }
.tasks > li + li { margin-top: 24px; }
.row > .when { white-space: pre; }
.row { display: grid; grid-template-columns: 7rem 1fr; gap: 16px; align-items: baseline; }
.when { color: var(--muted); font-variant-numeric: tabular-nums; }
.what { overflow-wrap: anywhere; }
details { margin: 8px 0 0 calc(7rem + 16px); }
summary { color: var(--muted); cursor: pointer; width: fit-content; }
summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.calls { list-style: none; margin: 8px 0 0; padding: 0; color: var(--muted); }
.calls li { display: flex; gap: 8px; padding: 2px 0; overflow-wrap: anywhere; min-width: 0; }
.calls .when { flex: none; }
.calls .tool { flex: none; color: var(--ink); }
.failed { color: var(--red); flex: none; }
@media (max-width: 600px) {
  main { padding: 32px 16px 48px; }
  .context { flex-wrap: wrap; gap: 8px; }
  .track { flex-basis: 100%; }
  .row { grid-template-columns: 1fr; gap: 0; }
  details { margin-left: 0; }
  .calls li { flex-wrap: wrap; gap: 4px 8px; }
}
`;

function renderHtml(view: RosterView): string {
  const line = [view.project, "written " + new Date().toTimeString().slice(0, 5)]
    .filter(Boolean)
    .join(", ");

  const blocks = view.agents.map((agent) => {
    const status =
      agent.status === "working" ? '<span class="working">working</span>' : esc(agent.status);
    const meta = [esc(agent.model), esc(agent.type), status]
      .concat(agent.instances > 1 ? [agent.instances + " instances"] : [])
      .join(",  ");

    let context = "";
    if (agent.context_tokens) {
      const share = Math.min(1, agent.context_tokens / CONTEXT_LIMIT) * 100;
      context =
        '<div class="context"><div class="track"><div class="fill" style="width: ' +
        share.toFixed(1) +
        '%"></div></div><span class="figure">' +
        (agent.context_tokens / 1000).toFixed(1) +
        "k of 200k</span></div>";
    }

    const tasks = agent.tasks
      .map((task) => {
        const when = [clock(task.started_at), span(task.started_at, task.finished_at)]
          .filter(Boolean)
          .join("  ");
        const count = task.calls.length;
        const calls = task.calls
          .map(
            (call) =>
              '<li><span class="when">' +
              clock(call.at) +
              '</span><span class="tool">' +
              esc(call.tool) +
              "</span><span>" +
              esc(call.summary) +
              "</span>" +
              (call.ok ? "" : '<span class="failed">failed</span>') +
              "</li>",
          )
          .join("");
        const details = count
          ? "<details><summary>" +
            count +
            (count === 1 ? " tool call" : " tool calls") +
            '</summary><ul class="calls">' +
            calls +
            "</ul></details>"
          : "";
        return (
          '<li><div class="row"><span class="when">' +
          when +
          '</span><span class="what">' +
          esc(task.summary || task.description) +
          "</span></div>" +
          details +
          "</li>"
        );
      })
      .join("");

    return (
      '<section class="agent"><h2>' +
      esc(agent.name) +
      '</h2><p class="meta">' +
      meta +
      "</p>" +
      context +
      '<ol class="tasks">' +
      tasks +
      "</ol></section>"
    );
  });

  const body = view.agents.length
    ? blocks.join("\n")
    : '<p class="empty">No agents in this session yet. Delegate a task and run /byname again.</p>';

  return (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    "<title>Byname roster</title>\n<style>" +
    STYLE +
    "</style>\n</head>\n<body>\n<main>\n<h1>Byname roster</h1>\n" +
    (line ? '<p class="written">' + esc(line) + "</p>\n" : "") +
    body +
    "\n</main>\n</body>\n</html>\n"
  );
}

const path = process.argv[2] ?? "";
const view = gather(path);

if (process.argv.includes("--html")) {
  const out = resolve(join(dirname(path), "byname.html"));
  writeFileSync(out, renderHtml(view));
  console.log(out);
} else {
  console.log(renderText(view, process.argv.includes("--tools")));
}
