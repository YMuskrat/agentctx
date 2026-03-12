import chalk from "chalk";
import inquirer from "inquirer";
import { nanoid } from "nanoid";
import { readContext, writeContext, appendHistory } from "../storage.js";
const ENTRY_TYPES = [
    "stack",
    "decision",
    "pattern",
    "env",
    "note",
];
export async function addCommand(content, options) {
    const store = readContext();
    let resolvedContent = content?.trim();
    let resolvedType = options.type;
    if (!resolvedContent) {
        const answer = await inquirer.prompt([
            {
                type: "input",
                name: "content",
                message: "Entry content:",
                validate: (v) => v.trim().length > 0 || "Content cannot be empty",
            },
        ]);
        resolvedContent = answer.content.trim();
    }
    if (!resolvedType || !ENTRY_TYPES.includes(resolvedType)) {
        const answer = await inquirer.prompt([
            {
                type: "list",
                name: "type",
                message: "Entry type:",
                choices: ENTRY_TYPES,
            },
        ]);
        resolvedType = answer.type;
    }
    const entry = {
        id: nanoid(),
        type: resolvedType,
        content: resolvedContent,
        source: "manual",
        addedAt: new Date().toISOString(),
    };
    store.entries.push(entry);
    writeContext(store);
    appendHistory({
        action: "add",
        timestamp: new Date().toISOString(),
        entry,
    });
    console.log(chalk.green(`Added ${entry.type}: "${entry.content}" (id: ${entry.id.slice(0, 8)})`));
}
