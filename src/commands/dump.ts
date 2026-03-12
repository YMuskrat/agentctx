import fs from "fs";
import path from "path";
import chalk from "chalk";
import { readContext } from "../storage.js";
import { format } from "../formatter.js";
import {
  detectAgents,
  listSupportedAgents,
  renderAgentTarget,
  resolveAgent,
} from "../agents.js";

interface DumpOptions {
  copy?: boolean;
  out?: string;
  all?: boolean;
  agent?: string[];
  target?: string[];
  listAgents?: boolean;
}

interface PendingWrite {
  filePath: string;
  contents: string;
  labels: Set<string>;
}

function addPendingWrite(
  pendingWrites: Map<string, PendingWrite>,
  filePath: string,
  contents: string,
  label?: string
): void {
  const absPath = path.resolve(process.cwd(), filePath);
  const existing = pendingWrites.get(absPath);

  if (existing) {
    if (label) {
      existing.labels.add(label);
    }
    return;
  }

  pendingWrites.set(absPath, {
    filePath,
    contents,
    labels: label ? new Set([label]) : new Set<string>(),
  });
}

function printSupportedAgents(): void {
  console.log(chalk.bold("Supported agents:"));

  for (const agent of listSupportedAgents()) {
    const aliases = agent.aliases.length > 0 ? ` aliases: ${agent.aliases.join(", ")}` : "";
    console.log(
      `  ${chalk.cyan(agent.id.padEnd(8))} ${agent.examplePath}${chalk.dim(aliases)}`
    );
  }

  console.log();
  console.log(
    chalk.dim(
      "Use --agent <name> to target one, --all for detected targets, or --target <file> for a custom path."
    )
  );
}

export async function dumpCommand(options: DumpOptions): Promise<void> {
  if (options.listAgents) {
    printSupportedAgents();
    return;
  }

  const store = readContext();
  const output = format(store.entries);
  const pendingWrites = new Map<string, PendingWrite>();

  if (options.all) {
    const agents = detectAgents();
    for (const agent of agents) {
      const rendered = renderAgentTarget(agent, output);
      addPendingWrite(pendingWrites, rendered.filePath, rendered.contents, agent.id);
    }
  }

  for (const agentName of options.agent ?? []) {
    const agent = resolveAgent(agentName);
    if (!agent) {
      const supported = listSupportedAgents().map((entry) => entry.id).join(", ");
      throw new Error(`Unsupported agent "${agentName}". Supported agents: ${supported}`);
    }

    const rendered = renderAgentTarget(agent, output);
    addPendingWrite(pendingWrites, rendered.filePath, rendered.contents, agent.id);
  }

  if (options.out) {
    addPendingWrite(pendingWrites, options.out, output + "\n");
  }

  for (const target of options.target ?? []) {
    addPendingWrite(pendingWrites, target, output + "\n");
  }

  if (pendingWrites.size > 0) {
    for (const pending of pendingWrites.values()) {
      const absPath = path.resolve(process.cwd(), pending.filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, pending.contents, "utf-8");

      const labels = [...pending.labels];
      const suffix = labels.length > 0 ? ` (${labels.join(", ")})` : "";
      console.log(chalk.green(`Wrote to ${pending.filePath}${suffix}`));
    }
    return;
  }

  if (options.all) {
    console.log(
      chalk.yellow(
        "No supported agent files detected. Use --agent <name> or --target <file> to create one."
      )
    );
    return;
  }

  if (options.copy) {
    const { default: clipboardy } = await import("clipboardy");
    await clipboardy.write(output);
    console.log(chalk.green("Copied to clipboard."));
    return;
  }

  // Default: print to stdout
  console.log(output);
}
