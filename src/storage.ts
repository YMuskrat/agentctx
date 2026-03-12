import fs from "fs";
import path from "path";

export interface ContextEntry {
  id: string;
  type: "stack" | "decision" | "pattern" | "env" | "note";
  content: string;
  source: string;
  addedAt: string;
}

export interface ContextStore {
  project: string;
  created: string;
  lastSync: string | null;
  entries: ContextEntry[];
}

export interface HistoryEvent {
  action: "add" | "remove" | "sync";
  timestamp: string;
  entry?: ContextEntry;
  count?: number;
}

export type HistoryLog = HistoryEvent[];

const AGENTCTX_DIR = ".agentctx";
const CONTEXT_FILE = "context.json";
const HISTORY_FILE = "history.json";

function contextPath(): string {
  return path.join(process.cwd(), AGENTCTX_DIR, CONTEXT_FILE);
}

function historyPath(): string {
  return path.join(process.cwd(), AGENTCTX_DIR, HISTORY_FILE);
}

export function readContext(): ContextStore {
  const filePath = contextPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Not initialized. Run "agentctx init" first.`
    );
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as ContextStore;
}

export function writeContext(store: ContextStore): void {
  const filePath = contextPath();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

export function readHistory(): HistoryLog {
  const filePath = historyPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as HistoryLog;
}

export function appendHistory(event: HistoryEvent): void {
  const log = readHistory();
  log.push(event);
  fs.writeFileSync(historyPath(), JSON.stringify(log, null, 2) + "\n", "utf-8");
}
