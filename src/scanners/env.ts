import fs from "fs";
import path from "path";
import type { Suggestion } from "./index.js";

export async function scanEnv(): Promise<Suggestion[]> {
  const envPath = path.join(process.cwd(), ".env.example");

  if (!fs.existsSync(envPath)) {
    return [];
  }

  let content: string;
  try {
    content = fs.readFileSync(envPath, "utf-8");
  } catch {
    return [];
  }

  const vars: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const varName = trimmed.slice(0, eqIdx).trim();
    if (varName) {
      vars.push(varName);
    }
  }

  if (vars.length === 0) {
    return [];
  }

  return [
    {
      type: "env",
      content: vars.join(", "),
      source: ".env.example",
      confidence: "high",
    },
  ];
}
