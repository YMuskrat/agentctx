'use strict';
const fs = require('fs');
const path = require('path');

function safeRead(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

function safeJSON(filePath) {
  try { return JSON.parse(safeRead(filePath) || 'null'); } catch { return null; }
}

function detectProjectName(cwd) {
  const pkg = safeJSON(path.join(cwd, 'package.json'));
  if (pkg?.name) return pkg.name;

  const pyproject = safeRead(path.join(cwd, 'pyproject.toml'));
  if (pyproject) {
    const m = pyproject.match(/^name\s*=\s*["']([^"']+)["']/m);
    if (m) return m[1];
  }

  const setuppy = safeRead(path.join(cwd, 'setup.py'));
  if (setuppy) {
    const m = setuppy.match(/name\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
  }

  const cargo = safeRead(path.join(cwd, 'Cargo.toml'));
  if (cargo) {
    const m = cargo.match(/^name\s*=\s*["']([^"']+)["']/m);
    if (m) return m[1];
  }

  const gomod = safeRead(path.join(cwd, 'go.mod'));
  if (gomod) {
    const m = gomod.match(/^module\s+(\S+)/m);
    if (m) return m[1].split('/').pop();
  }

  const composer = safeJSON(path.join(cwd, 'composer.json'));
  if (composer?.name) return composer.name.split('/').pop();

  return path.basename(cwd);
}

function detectDescription(cwd) {
  const pkg = safeJSON(path.join(cwd, 'package.json'));
  if (pkg?.description) return pkg.description;

  const pyproject = safeRead(path.join(cwd, 'pyproject.toml'));
  if (pyproject) {
    const m = pyproject.match(/^description\s*=\s*["']([^"']+)["']/m);
    if (m) return m[1];
  }

  const composer = safeJSON(path.join(cwd, 'composer.json'));
  if (composer?.description) return composer.description;

  return null;
}

function detectPackages(cwd) {
  const packages = [];

  const pkg = safeJSON(path.join(cwd, 'package.json'));
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      packages.push({ name, version: version.replace(/^[\^~>=<]+/, ''), source: 'package.json' });
    }
    return packages; // return early if package.json found
  }

  const req = safeRead(path.join(cwd, 'requirements.txt'));
  if (req) {
    req.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#') || line.startsWith('-')) return;
      const m = line.match(/^([a-zA-Z0-9_.-]+)(?:[=><~!]+(.*))?/);
      if (m) packages.push({ name: m[1], version: m[2] || null, source: 'requirements.txt' });
    });
    if (packages.length) return packages;
  }

  const pyproject = safeRead(path.join(cwd, 'pyproject.toml'));
  if (pyproject) {
    const depSection = pyproject.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depSection) {
      depSection[1].split('\n').forEach(line => {
        const m = line.trim().match(/^["']([a-zA-Z0-9_.-]+)/);
        if (m) packages.push({ name: m[1], version: null, source: 'pyproject.toml' });
      });
    }
    if (packages.length) return packages;
  }

  const cargo = safeRead(path.join(cwd, 'Cargo.toml'));
  if (cargo) {
    const depsSection = cargo.match(/\[dependencies\]([\s\S]*?)(?=\[|$)/);
    if (depsSection) {
      depsSection[1].split('\n').forEach(line => {
        const m = line.match(/^(\w[\w-]*)\s*=/);
        if (m) packages.push({ name: m[1], version: null, source: 'Cargo.toml' });
      });
    }
    if (packages.length) return packages;
  }

  const gomod = safeRead(path.join(cwd, 'go.mod'));
  if (gomod) {
    const requireSection = gomod.match(/^require\s*\(([\s\S]*?)\)/m);
    if (requireSection) {
      requireSection[1].split('\n').forEach(line => {
        const m = line.trim().match(/^(\S+)\s+(\S+)/);
        if (m) packages.push({ name: m[1].split('/').pop(), version: m[2], source: 'go.mod' });
      });
    }
  }

  return packages;
}

function detectEnvVars(cwd) {
  const envVars = [];
  const envFiles = ['.env.example', '.env.sample', '.env.template', '.env.local.example'];

  for (const f of envFiles) {
    const content = safeRead(path.join(cwd, f));
    if (!content) continue;
    content.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)(?:\s*=\s*(.*))?/);
      if (m) envVars.push({ name: m[1], description: m[2] || null, source: f });
    });
    if (envVars.length) return envVars;
  }

  // Fall back to docker-compose.yml
  const dc = safeRead(path.join(cwd, 'docker-compose.yml')) || safeRead(path.join(cwd, 'docker-compose.yaml'));
  if (dc) {
    const matches = [...dc.matchAll(/^\s+([A-Z_][A-Z0-9_]*)\s*:/gm)];
    for (const m of matches) {
      if (!envVars.find(e => e.name === m[1])) {
        envVars.push({ name: m[1], description: null, source: 'docker-compose.yml' });
      }
    }
  }

  return envVars;
}

function detectStack(cwd, packages) {
  const stack = [];

  const pkg = safeJSON(path.join(cwd, 'package.json'));
  if (pkg) {
    const nodeVer = pkg.engines?.node;
    stack.push(nodeVer ? `node ${nodeVer.replace(/[^0-9.x]/g, '').split('.')[0]}` : 'node');
    if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) stack.push('typescript');
    if (pkg.dependencies?.react || pkg.devDependencies?.react) stack.push('react');
    if (pkg.dependencies?.vue || pkg.devDependencies?.vue) stack.push('vue');
    if (pkg.dependencies?.svelte || pkg.devDependencies?.svelte) stack.push('svelte');
    if (pkg.dependencies?.express) stack.push('express');
    if (pkg.dependencies?.fastify) stack.push('fastify');
    if (pkg.dependencies?.['next']) stack.push('next.js');
  }

  if (fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
    stack.push('python');
    if (packages.find(p => ['django'].includes(p.name))) stack.push('django');
    if (packages.find(p => ['flask'].includes(p.name))) stack.push('flask');
    if (packages.find(p => ['fastapi'].includes(p.name))) stack.push('fastapi');
  }

  if (fs.existsSync(path.join(cwd, 'go.mod'))) stack.push('go');
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) stack.push('rust');
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) stack.push('java');
  if (fs.existsSync(path.join(cwd, 'Gemfile'))) stack.push('ruby');

  const dbPkgs = {
    postgres: ['pg', 'postgres', 'postgresql', 'psycopg2', 'asyncpg'],
    mysql: ['mysql', 'mysql2', 'pymysql'],
    mongodb: ['mongodb', 'mongoose', 'pymongo', 'motor'],
    redis: ['redis', 'ioredis', 'aioredis'],
    sqlite: ['better-sqlite3', 'sqlite3', 'aiosqlite'],
  };
  for (const [db, pkgNames] of Object.entries(dbPkgs)) {
    if (packages.find(p => pkgNames.includes(p.name))) stack.push(db);
  }

  return [...new Set(stack)];
}

function detect(cwd) {
  cwd = cwd || process.cwd();
  const packages = detectPackages(cwd);
  return {
    name: detectProjectName(cwd),
    description: detectDescription(cwd),
    packages,
    envVars: detectEnvVars(cwd),
    stack: detectStack(cwd, packages),
  };
}

module.exports = { detect };
