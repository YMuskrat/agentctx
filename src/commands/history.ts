import chalk from "chalk";
import { readHistory } from "../storage.js";

export function historyCommand(): void {
  const log = readHistory();

  if (log.length === 0) {
    console.log(chalk.dim("No history yet."));
    return;
  }

  const reversed = [...log].reverse();

  for (const event of reversed) {
    const date = chalk.dim(new Date(event.timestamp).toLocaleString());
    const action = chalk.bold(event.action.toUpperCase());

    let description = "";
    if (event.action === "add" && event.entry) {
      description = `${event.entry.type}: "${event.entry.content}"`;
    } else if (event.action === "remove" && event.entry) {
      description = `${event.entry.type}: "${event.entry.content}"`;
    } else if (event.action === "sync") {
      description = `${event.count ?? 0} entries added`;
    }

    console.log(`${date} ${action}: ${description}`);
  }
}
