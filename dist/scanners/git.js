import { execSync } from "child_process";
const DECISION_WORDS = [
    "chose",
    "switch",
    "replace",
    "decided",
    "migrate",
    "refactor",
    "use",
    "adopt",
];
export async function scanGit() {
    let output;
    try {
        output = execSync("git log --oneline -20", {
            cwd: process.cwd(),
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
    }
    catch {
        return [];
    }
    const suggestions = [];
    const lines = output.trim().split("\n").filter(Boolean);
    for (const line of lines) {
        const message = line.replace(/^[a-f0-9]+\s+/, "").trim();
        const lower = message.toLowerCase();
        const matched = DECISION_WORDS.some((word) => {
            const regex = new RegExp(`\\b${word}\\b`);
            return regex.test(lower);
        });
        if (matched) {
            suggestions.push({
                type: "decision",
                content: message,
                source: "git log",
                confidence: "medium",
            });
        }
    }
    return suggestions;
}
