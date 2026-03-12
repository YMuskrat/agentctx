import fs from "fs";
import path from "path";
const FRAMEWORK_RULES = [
    { pkg: "react", label: "React" },
    { pkg: "next", label: "Next.js" },
    { pkg: "vue", label: "Vue" },
    { pkg: "svelte", label: "Svelte" },
    { pkg: "express", label: "Express" },
    { pkg: "fastify", label: "Fastify" },
    { pkg: "prisma", label: "Prisma" },
    { pkg: "@prisma/client", label: "Prisma" },
    { pkg: "drizzle-orm", label: "Drizzle ORM" },
    { pkg: "jest", label: "Jest" },
    { pkg: "vitest", label: "Vitest" },
    { pkg: "pg", label: "Postgres" },
    { pkg: "mysql2", label: "MySQL" },
    { pkg: "ioredis", label: "Redis" },
    { pkg: "redis", label: "Redis" },
];
export async function scanPackage() {
    const cwd = process.cwd();
    const pkgPath = path.join(cwd, "package.json");
    if (!fs.existsSync(pkgPath)) {
        return [];
    }
    let pkg;
    try {
        const raw = fs.readFileSync(pkgPath, "utf-8");
        pkg = JSON.parse(raw);
    }
    catch {
        return [];
    }
    const suggestions = [];
    const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
    };
    const seen = new Set();
    for (const rule of FRAMEWORK_RULES) {
        if (allDeps[rule.pkg] && !seen.has(rule.label)) {
            seen.add(rule.label);
            // Try to extract version
            const rawVersion = allDeps[rule.pkg];
            const version = rawVersion ? rawVersion.replace(/[\^~>=<]/, "").split(".")[0] : "";
            const content = version ? `${rule.label} ${version}` : rule.label;
            suggestions.push({
                type: "stack",
                content,
                source: "package.json",
                confidence: "high",
            });
        }
    }
    // Detect package manager from lockfiles
    const lockfileMap = [
        { file: "bun.lockb", label: "bun" },
        { file: "pnpm-lock.yaml", label: "pnpm" },
        { file: "yarn.lock", label: "yarn" },
        { file: "package-lock.json", label: "npm" },
    ];
    for (const lf of lockfileMap) {
        if (fs.existsSync(path.join(cwd, lf.file))) {
            suggestions.push({
                type: "stack",
                content: `Package manager: ${lf.label}`,
                source: "package.json",
                confidence: "high",
            });
            break;
        }
    }
    return suggestions;
}
