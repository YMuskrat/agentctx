import { scanPackage } from "./package.js";
import { scanEnv } from "./env.js";
import { scanDocker } from "./docker.js";
import { scanGit } from "./git.js";
import { scanReadme } from "./readme.js";
import { scanConfig } from "./config.js";
import type { ContextEntry } from "../storage.js";

export interface Suggestion {
  type: ContextEntry["type"];
  content: string;
  source: string;
  confidence: "high" | "medium";
}

export async function runAllScanners(): Promise<Suggestion[]> {
  const results = await Promise.allSettled([
    scanPackage(),
    scanEnv(),
    scanDocker(),
    scanGit(),
    scanReadme(),
    scanConfig(),
  ]);

  const suggestions: Suggestion[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      suggestions.push(...result.value);
    }
  }

  return suggestions;
}
