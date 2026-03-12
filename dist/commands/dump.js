import fs from "fs";
import path from "path";
import chalk from "chalk";
import { readContext } from "../storage.js";
import { format } from "../formatter.js";
import { detectTools } from "../detector.js";
const TOOL_FILE_MAP = {
    claude: "CLAUDE.md",
    cursor: ".cursor/rules",
    gemini: "GEMINI.md",
    copilot: ".github/copilot-instructions.md",
};
export async function dumpCommand(options) {
    const store = readContext();
    const output = format(store.entries);
    if (options.all) {
        const tools = detectTools();
        if (tools.length === 0) {
            console.log(chalk.yellow("No AI tool config files detected."));
            return;
        }
        for (const tool of tools) {
            const filePath = TOOL_FILE_MAP[tool];
            if (!filePath)
                continue;
            const absPath = path.join(process.cwd(), filePath);
            fs.mkdirSync(path.dirname(absPath), { recursive: true });
            fs.writeFileSync(absPath, output + "\n", "utf-8");
            console.log(chalk.green(`Wrote to ${filePath} (${tool})`));
        }
        return;
    }
    if (options.out) {
        const absPath = path.join(process.cwd(), options.out);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, output + "\n", "utf-8");
        console.log(chalk.green(`Wrote to ${options.out}`));
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
