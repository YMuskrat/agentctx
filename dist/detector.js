import { detectAgents } from "./agents.js";
export function detectTools() {
    return detectAgents().map((agent) => agent.id);
}
