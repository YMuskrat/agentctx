import fs from "fs";
import path from "path";
const AGENTCTX_DIR = ".agentctx";
const CONTEXT_FILE = "context.json";
const HISTORY_FILE = "history.json";
function contextPath() {
    return path.join(process.cwd(), AGENTCTX_DIR, CONTEXT_FILE);
}
function historyPath() {
    return path.join(process.cwd(), AGENTCTX_DIR, HISTORY_FILE);
}
export function readContext() {
    const filePath = contextPath();
    if (!fs.existsSync(filePath)) {
        throw new Error(`Not initialized. Run "agentctx init" first.`);
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
}
export function writeContext(store) {
    const filePath = contextPath();
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + "\n", "utf-8");
}
export function readHistory() {
    const filePath = historyPath();
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
}
export function appendHistory(event) {
    const log = readHistory();
    log.push(event);
    fs.writeFileSync(historyPath(), JSON.stringify(log, null, 2) + "\n", "utf-8");
}
