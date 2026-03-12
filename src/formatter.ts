import type { ContextEntry } from "./storage.js";

const TYPE_LABELS: Record<ContextEntry["type"], string> = {
  stack: "Stack",
  decision: "Decisions",
  pattern: "Patterns",
  env: "Environment Variables",
  note: "Notes",
};

const TYPE_ORDER: ContextEntry["type"][] = [
  "stack",
  "decision",
  "pattern",
  "env",
  "note",
];

export function format(entries: ContextEntry[]): string {
  const groups: Partial<Record<ContextEntry["type"], ContextEntry[]>> = {};

  for (const entry of entries) {
    if (!groups[entry.type]) {
      groups[entry.type] = [];
    }
    groups[entry.type]!.push(entry);
  }

  const sections: string[] = [];

  for (const type of TYPE_ORDER) {
    const group = groups[type];
    if (!group || group.length === 0) continue;

    const label = TYPE_LABELS[type];
    const lines = group.map((e) => `- ${e.content}`).join("\n");
    sections.push(`## ${label}\n${lines}`);
  }

  return sections.join("\n\n");
}
