const TYPE_LABELS = {
    stack: "Stack",
    decision: "Decisions",
    pattern: "Patterns",
    env: "Environment Variables",
    note: "Notes",
};
const TYPE_ORDER = [
    "stack",
    "decision",
    "pattern",
    "env",
    "note",
];
export function format(entries) {
    const groups = {};
    for (const entry of entries) {
        if (!groups[entry.type]) {
            groups[entry.type] = [];
        }
        groups[entry.type].push(entry);
    }
    const sections = [];
    for (const type of TYPE_ORDER) {
        const group = groups[type];
        if (!group || group.length === 0)
            continue;
        const label = TYPE_LABELS[type];
        const lines = group.map((e) => `- ${e.content}`).join("\n");
        sections.push(`## ${label}\n${lines}`);
    }
    return sections.join("\n\n");
}
