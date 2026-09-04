import { dirname } from "node:path";
import { activity, activityPath, load } from "../lib/roster.ts";

const path = process.argv[2] ?? "";
const withTools = process.argv.includes("--tools");
const roster = load(path);
const dir = dirname(path);

const flat = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();
const clock = (iso?: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "--:--");

function span(from?: string, to?: string): string {
  if (!from || !to) return "";
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  return seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m" + (seconds % 60) + "s";
}

const first = (id: string) => Date.parse(roster.agents[id].tasks[0]?.started_at ?? "") || 0;
const ids = Object.keys(roster.agents).sort((a, b) => first(a) - first(b));

if (!ids.length) {
  console.log("No agents yet.");
} else {
  for (const id of ids) {
    const agent = roster.agents[id];
    const starts = activity(activityPath(dir, id)).filter((e) => e.event === "start");
    const size = agent.context_tokens ? (agent.context_tokens / 1000).toFixed(1) + "k" : "";
    const copies = agent.ids.length > 1 ? agent.ids.length + " instances" : "";
    console.log(
      [
        agent.name.padEnd(10),
        String(agent.model || "?").padEnd(10),
        String(agent.type || "?").padEnd(18),
        agent.status.padEnd(8),
        size.padEnd(7),
        copies,
      ]
        .join(" ")
        .trimEnd(),
    );

    for (const task of agent.tasks) {
      const from = Date.parse(task.started_at) || 0;
      const to = task.finished_at ? Date.parse(task.finished_at) : Date.now();
      const calls = starts.filter((e) => {
        const at = Date.parse(e.at) || 0;
        return at >= from && at <= to;
      });
      const time = clock(task.started_at);
      const took = span(task.started_at, task.finished_at);
      console.log(
        "  " +
          [time, took.padEnd(6), (calls.length + (calls.length === 1 ? " call" : " calls")).padEnd(9), flat(task.description)]
            .join(" ")
            .trimEnd(),
      );
      if (task.report) console.log("      " + flat(task.report).slice(0, 120));
      if (!withTools) continue;
      for (const call of calls) {
        console.log(
          "      " + clock(call.at) + "  " + String(call.tool ?? "?").padEnd(12) + flat(call.summary),
        );
      }
    }
    console.log("");
  }
}
