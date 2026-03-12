import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Suggestion } from "./index.js";

interface DockerService {
  image?: string;
  ports?: string[];
}

interface DockerCompose {
  services?: Record<string, DockerService>;
}

const SERVICE_LABELS: Record<string, string> = {
  postgres: "Postgres",
  postgresql: "Postgres",
  mysql: "MySQL",
  mariadb: "MariaDB",
  redis: "Redis",
  mongo: "MongoDB",
  mongodb: "MongoDB",
  elasticsearch: "Elasticsearch",
  rabbitmq: "RabbitMQ",
  kafka: "Kafka",
  nginx: "Nginx",
  minio: "MinIO",
};

function labelForService(name: string, image?: string): string | null {
  const key = name.toLowerCase();
  for (const [pattern, label] of Object.entries(SERVICE_LABELS)) {
    if (key.includes(pattern) || (image && image.toLowerCase().includes(pattern))) {
      return label;
    }
  }
  return null;
}

export async function scanDocker(): Promise<Suggestion[]> {
  const composePath = path.join(process.cwd(), "docker-compose.yml");

  if (!fs.existsSync(composePath)) {
    return [];
  }

  let parsed: DockerCompose;
  try {
    const raw = fs.readFileSync(composePath, "utf-8");
    parsed = yaml.load(raw) as DockerCompose;
  } catch {
    return [];
  }

  if (!parsed?.services) {
    return [];
  }

  const suggestions: Suggestion[] = [];

  for (const [name, service] of Object.entries(parsed.services)) {
    const label = labelForService(name, service.image);
    if (!label) continue;

    const ports = service.ports ?? [];
    const hostPort = ports.length > 0 ? ports[0].split(":")[0] : null;

    const content = hostPort
      ? `${label} on port ${hostPort}`
      : label;

    suggestions.push({
      type: "stack",
      content,
      source: "docker-compose.yml",
      confidence: "high",
    });
  }

  return suggestions;
}
