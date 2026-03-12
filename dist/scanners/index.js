import { scanPackage } from "./package.js";
import { scanEnv } from "./env.js";
import { scanDocker } from "./docker.js";
import { scanGit } from "./git.js";
import { scanReadme } from "./readme.js";
import { scanConfig } from "./config.js";
export async function runAllScanners() {
    const results = await Promise.allSettled([
        scanPackage(),
        scanEnv(),
        scanDocker(),
        scanGit(),
        scanReadme(),
        scanConfig(),
    ]);
    const suggestions = [];
    for (const result of results) {
        if (result.status === "fulfilled") {
            suggestions.push(...result.value);
        }
    }
    return suggestions;
}
