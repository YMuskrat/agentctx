import fs from "fs";
import path from "path";
import chalk from "chalk";
import type { ContextStore } from "../storage.js";

export function initCommand(): void {
  const cwd = process.cwd();
  const agentctxDir = path.join(cwd, ".agentctx");
  const contextFile = path.join(agentctxDir, "context.json");
  const historyFile = path.join(agentctxDir, "history.json");

  if (fs.existsSync(contextFile)) {
    console.log(chalk.yellow("Already initialized. .agentctx/context.json already exists."));
    return;
  }

  fs.mkdirSync(agentctxDir, { recursive: true });

  const store: ContextStore = {
    project: path.basename(cwd),
    created: new Date().toISOString(),
    lastSync: null,
    entries: [],
  };

  fs.writeFileSync(contextFile, JSON.stringify(store, null, 2) + "\n", "utf-8");
  fs.writeFileSync(historyFile, "[]\n", "utf-8");

  console.log(chalk.green(`Initialized agentctx for project "${store.project}"`));
  console.log(chalk.dim("  Created .agentctx/context.json"));
  console.log(chalk.dim("  Created .agentctx/history.json"));
}
