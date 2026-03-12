import fs from "fs";
import path from "path";
function readJsonFile(filePath) {
    if (!fs.existsSync(filePath))
        return null;
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function scanConfig() {
    const cwd = process.cwd();
    const suggestions = [];
    // tsconfig.json
    const tsconfig = readJsonFile(path.join(cwd, "tsconfig.json"));
    if (tsconfig) {
        const opts = tsconfig.compilerOptions ?? {};
        if (opts["strict"] === true) {
            suggestions.push({
                type: "pattern",
                content: "Strict TypeScript mode enabled",
                source: "tsconfig.json",
                confidence: "high",
            });
        }
        else if (opts["strictNullChecks"] === true) {
            suggestions.push({
                type: "pattern",
                content: "strictNullChecks enabled in TypeScript",
                source: "tsconfig.json",
                confidence: "high",
            });
        }
    }
    // ESLint
    const eslintFiles = [
        ".eslintrc",
        ".eslintrc.json",
        ".eslintrc.js",
        "eslint.config.js",
        "eslint.config.mjs",
    ];
    const hasEslint = eslintFiles.some((f) => fs.existsSync(path.join(cwd, f)));
    if (hasEslint) {
        suggestions.push({
            type: "pattern",
            content: "ESLint is configured",
            source: ".eslintrc",
            confidence: "high",
        });
    }
    // Prisma schema
    const prismaSchemaPath = path.join(cwd, "prisma", "schema.prisma");
    if (fs.existsSync(prismaSchemaPath)) {
        try {
            const schema = fs.readFileSync(prismaSchemaPath, "utf-8");
            const modelMatches = schema.matchAll(/^model\s+(\w+)\s+\{/gm);
            const models = [];
            for (const match of modelMatches) {
                if (match[1])
                    models.push(match[1]);
            }
            if (models.length > 0) {
                suggestions.push({
                    type: "pattern",
                    content: `Prisma models: ${models.join(", ")}`,
                    source: "prisma/schema.prisma",
                    confidence: "high",
                });
            }
        }
        catch {
            // ignore
        }
    }
    return suggestions;
}
