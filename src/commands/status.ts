import fs from "fs";
import path from "path";
import chalk from "chalk";
import { readContext } from "../storage.js";
import type { ContextEntry } from "../storage.js";

export function statusCommand(): void {
  const store = readContext();

  console.log(chalk.bold(`Project: ${store.project}`));
  console.log(chalk.dim(`Created: ${new Date(store.created).toLocaleString()}`));

  if (store.lastSync) {
    console.log(chalk.dim(`Last sync: ${new Date(store.lastSync).toLocaleString()}`));
  } else {
    console.log(chalk.yellow("Last sync: never"));
  }

  console.log();

  const typeCounts: Partial<Record<ContextEntry["type"], number>> = {};
  for (const entry of store.entries) {
    typeCounts[entry.type] = (typeCounts[entry.type] ?? 0) + 1;
  }

  const total = store.entries.length;
  if (total === 0) {
    console.log(chalk.dim("No entries yet. Run `agentctx add` or `agentctx sync`."));
  } else {
    console.log(chalk.bold(`Entries (${total} total):`));
    const types: ContextEntry["type"][] = ["stack", "decision", "pattern", "env", "note"];
    for (const type of types) {
      const count = typeCounts[type] ?? 0;
      if (count > 0) {
        console.log(`  ${chalk.cyan(type.padEnd(10))} ${count}`);
      }
    }
  }

  // Check if package.json changed since last sync
  if (store.lastSync) {
    const pkgPath = path.join(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const stat = fs.statSync(pkgPath);
      const mtime = stat.mtimeMs;
      const lastSyncMs = new Date(store.lastSync).getTime();
      if (mtime > lastSyncMs) {
        console.log();
        console.log(
          chalk.yellow("Warning: package.json has changed since last sync. Run `agentctx sync` to update.")
        );
      }
    }
  }
}
