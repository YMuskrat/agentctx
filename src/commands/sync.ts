import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { nanoid } from "nanoid";
import { readContext, writeContext, appendHistory } from "../storage.js";
import type { ContextEntry } from "../storage.js";
import { runAllScanners } from "../scanners/index.js";

export async function syncCommand(): Promise<void> {
  const store = readContext();

  const spinner = ora("Scanning project...").start();
  const suggestions = await runAllScanners();
  spinner.stop();

  console.log(chalk.dim(`Found ${suggestions.length} suggestion(s).`));

  // Deduplicate against existing entries
  const existingContents = new Set(
    store.entries.map((e) => e.content.toLowerCase())
  );

  const newSuggestions = suggestions.filter(
    (s) => !existingContents.has(s.content.toLowerCase())
  );

  if (newSuggestions.length === 0) {
    console.log(chalk.yellow("No new suggestions — everything is already tracked."));
    store.lastSync = new Date().toISOString();
    writeContext(store);
    return;
  }

  console.log(
    chalk.cyan(
      `${newSuggestions.length} new suggestion(s) after deduplication:\n`
    )
  );

  const approved: ContextEntry[] = [];

  for (const suggestion of newSuggestions) {
    const confidenceColor =
      suggestion.confidence === "high" ? chalk.green : chalk.yellow;

    const label = `${chalk.bold(suggestion.type)}: ${suggestion.content} ${chalk.dim(`(from ${suggestion.source})`)} ${confidenceColor(`[${suggestion.confidence}]`)}`;

    const answer = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: "confirm",
        name: "confirm",
        message: label,
        default: true,
      },
    ]);

    if (answer.confirm) {
      const entry: ContextEntry = {
        id: nanoid(),
        type: suggestion.type,
        content: suggestion.content,
        source: suggestion.source,
        addedAt: new Date().toISOString(),
      };
      approved.push(entry);
      store.entries.push(entry);
    }
  }

  store.lastSync = new Date().toISOString();
  writeContext(store);

  appendHistory({
    action: "sync",
    timestamp: new Date().toISOString(),
    count: approved.length,
  });

  console.log(chalk.green(`\nAdded ${approved.length} entries.`));
}
