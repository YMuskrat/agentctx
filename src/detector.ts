import { detectAgents } from "./agents.js";

export function detectTools(): string[] {
  return detectAgents().map((agent) => agent.id);
}
