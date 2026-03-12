import fs from "fs";
import path from "path";
import type { Suggestion } from "./index.js";

export async function scanReadme(): Promise<Suggestion[]> {
  const readmePath = path.join(process.cwd(), "README.md");

  if (!fs.existsSync(readmePath)) {
    return [];
  }

  let content: string;
  try {
    content = fs.readFileSync(readmePath, "utf-8");
  } catch {
    return [];
  }

  const excerpt = content.slice(0, 500).trim();
  if (!excerpt) {
    return [];
  }

  // Extract first non-heading paragraph
  const lines = excerpt.split("\n");
  const paragraphLines: string[] = [];

  let inParagraph = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      if (inParagraph) break;
      continue;
    }
    if (!trimmed) {
      if (inParagraph) break;
      continue;
    }
    paragraphLines.push(trimmed);
    inParagraph = true;
  }

  const paragraph = paragraphLines.join(" ").trim();
  if (!paragraph) {
    return [];
  }

  return [
    {
      type: "note",
      content: paragraph,
      source: "README.md",
      confidence: "medium",
    },
  ];
}
