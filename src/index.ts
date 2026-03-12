#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";
import { listCommand } from "./commands/list.js";
import { forgetCommand } from "./commands/forget.js";
import { historyCommand } from "./commands/history.js";
import { dumpCommand } from "./commands/dump.js";

function handleError(err: unknown): void {
  if (err instanceof Error) {
    console.error(chalk.red("Error: " + err.message));
  } else {
    console.error(chalk.red("An unknown error occurred."));
  }
  process.exit(1);
}

function collectList(value: string, previous: string[]): string[] {
  return previous.concat(
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  );
}

const program = new Command();

program
  .name("agentctx")
  .description("Manage AI coding context for your project")
  .version("1.0.0");

program
  .command("init")
  .description("Initialize agentctx in the current project")
  .action(() => {
    initCommand();
  });

program
  .command("add [content]")
  .description("Add a context entry")
  .option("-t, --type <type>", "Entry type (stack|decision|pattern|env|note)")
  .action(async (content: string | undefined, options: { type?: string }) => {
    try {
      await addCommand(content, options);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("sync")
  .description("Scan project and suggest new context entries")
  .action(async () => {
    try {
      await syncCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("status")
  .description("Show current context status")
  .action(() => {
    try {
      statusCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("list")
  .description("List all context entries")
  .action(() => {
    try {
      listCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("forget [id]")
  .description("Remove a context entry by ID")
  .option("--undo", "Restore last removed entry")
  .action((id: string | undefined, options: { undo?: boolean }) => {
    try {
      forgetCommand(id, options);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("history")
  .description("Show history of changes")
  .action(() => {
    try {
      historyCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("dump")
  .description("Output context as agent instructions")
  .option("--copy", "Copy output to clipboard")
  .option("--out <file>", "Write output to a file")
  .option(
    "--target <file>",
    "Write output to an additional custom instruction file",
    collectList,
    []
  )
  .option(
    "--agent <name>",
    "Write to a supported agent target (repeat or comma-separate)",
    collectList,
    []
  )
  .option("--all", "Write to all detected agent instruction files")
  .option("--list-agents", "List supported agents and their default output files")
  .action(async (options: {
    copy?: boolean;
    out?: string;
    target?: string[];
    agent?: string[];
    all?: boolean;
    listAgents?: boolean;
  }) => {
    try {
      await dumpCommand(options);
    } catch (err) {
      handleError(err);
    }
  });

program.parse();
