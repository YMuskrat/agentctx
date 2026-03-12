import chalk from "chalk";
import { readContext } from "../storage.js";

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function pad(str: string, len: number): string {
  return str.padEnd(len, " ");
}

export function listCommand(): void {
  const store = readContext();
  const entries = store.entries;

  if (entries.length === 0) {
    console.log(chalk.dim("No entries. Run `agentctx add` or `agentctx sync`."));
    return;
  }

  const COL_ID = 8;
  const COL_TYPE = 10;
  const COL_CONTENT = 60;
  const COL_DATE = 12;

  const header =
    chalk.bold(pad("ID", COL_ID)) +
    "  " +
    chalk.bold(pad("TYPE", COL_TYPE)) +
    "  " +
    chalk.bold(pad("CONTENT", COL_CONTENT)) +
    "  " +
    chalk.bold("DATE");

  const divider =
    "-".repeat(COL_ID) +
    "  " +
    "-".repeat(COL_TYPE) +
    "  " +
    "-".repeat(COL_CONTENT) +
    "  " +
    "-".repeat(COL_DATE);

  console.log(header);
  console.log(chalk.dim(divider));

  for (const entry of entries) {
    const id = entry.id.slice(0, COL_ID);
    const type = pad(entry.type, COL_TYPE);
    const content = pad(truncate(entry.content, COL_CONTENT), COL_CONTENT);
    const date = new Date(entry.addedAt).toISOString().slice(0, 10);

    console.log(
      chalk.cyan(id) +
        "  " +
        chalk.yellow(type) +
        "  " +
        content +
        "  " +
        chalk.dim(date)
    );
  }

  console.log();
  console.log(chalk.dim(`Total: ${entries.length} entries`));
}
