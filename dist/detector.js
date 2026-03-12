import fs from "fs";
import path from "path";
export function detectTools() {
    const cwd = process.cwd();
    const detected = [];
    if (fs.existsSync(path.join(cwd, ".cursor"))) {
        detected.push("cursor");
    }
    if (fs.existsSync(path.join(cwd, "CLAUDE.md"))) {
        detected.push("claude");
    }
    if (fs.existsSync(path.join(cwd, "GEMINI.md"))) {
        detected.push("gemini");
    }
    if (fs.existsSync(path.join(cwd, ".github", "copilot-instructions.md"))) {
        detected.push("copilot");
    }
    return detected;
}
