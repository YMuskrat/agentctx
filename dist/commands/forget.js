import chalk from "chalk";
import { readContext, writeContext, readHistory, appendHistory } from "../storage.js";
export function forgetCommand(id, options) {
    if (options.undo) {
        undoLastRemove();
        return;
    }
    if (!id) {
        console.log(chalk.red("Error: provide an entry ID (or use --undo)"));
        process.exit(1);
    }
    const store = readContext();
    const partial = id.slice(0, 8).toLowerCase();
    const idx = store.entries.findIndex((e) => e.id.slice(0, 8).toLowerCase() === partial);
    if (idx === -1) {
        console.log(chalk.red(`No entry found matching ID "${partial}"`));
        process.exit(1);
    }
    const [removed] = store.entries.splice(idx, 1);
    writeContext(store);
    appendHistory({
        action: "remove",
        timestamp: new Date().toISOString(),
        entry: removed,
    });
    console.log(chalk.green(`Removed ${removed.type}: "${removed.content}" (id: ${removed.id.slice(0, 8)})`));
}
function undoLastRemove() {
    const history = readHistory();
    // Find last remove event
    let lastRemove;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].action === "remove" && history[i].entry) {
            lastRemove = history[i];
            break;
        }
    }
    if (!lastRemove || !lastRemove.entry) {
        console.log(chalk.yellow("No recent removal to undo."));
        return;
    }
    const entry = lastRemove.entry;
    const store = readContext();
    // Check if already exists
    if (store.entries.some((e) => e.id === entry.id)) {
        console.log(chalk.yellow("Entry is already present."));
        return;
    }
    store.entries.push(entry);
    writeContext(store);
    appendHistory({
        action: "add",
        timestamp: new Date().toISOString(),
        entry,
    });
    console.log(chalk.green(`Restored ${entry.type}: "${entry.content}" (id: ${entry.id.slice(0, 8)})`));
}
