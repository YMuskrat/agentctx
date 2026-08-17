'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const store = require('../store');
const { detect } = require('../detect');
const { c } = require('../format');

function makePrompter() {
  if (!process.stdin.isTTY) {
    // Non-interactive: skip prompts, use defaults
    return { ask: async () => '', close: () => {} };
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise((resolve, reject) => {
    rl.question(q, ans => resolve(ans));
    rl.once('close', () => resolve(''));
  });
  const close = () => rl.close();
  return { ask, close };
}

function installGitHook(root) {
  const gitPath = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (gitPath.status !== 0) {
    console.log(c.yellow('  No Git repository found — skipping hook installation'));
    return false;
  }

  const hooksDir = path.resolve(root, gitPath.stdout.trim());
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-commit');

  const hookContent = `#!/bin/sh
# Installed by agenctx — verify generated context before every commit
if command -v agenctx >/dev/null 2>&1; then
  agenctx dump --check || exit 1
fi
`;

  if (fs.existsSync(hookPath)) {
    // Append to existing hook
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes('agenctx')) {
      console.log(c.gray('  Git hook already contains agenctx — skipping'));
      return false;
    }
    const body = hookContent.split('\n').slice(1).join('\n');
    fs.appendFileSync(hookPath, '\n' + body);
  } else {
    fs.writeFileSync(hookPath, hookContent, 'utf8');
  }
  fs.chmodSync(hookPath, 0o755);
  return true;
}

async function init(args) {
  const cwd = process.cwd();
  const dir = store.agenctxDir(cwd);
  const withHook = args.includes('--hook');

  if (fs.existsSync(dir)) {
    console.log(c.yellow('agenctx already initialized in this project.'));
    if (withHook) {
      const installed = installGitHook(cwd);
      if (installed) console.log(c.green('✓') + ' Git pre-commit hook installed');
    }
    console.log(c.gray('\nRun: agenctx view'));
    return;
  }

  console.log(c.bold('Initializing agenctx...\n'));

  const detected = detect(cwd);
  let name = detected.name;
  let description = detected.description;

  const { ask, close } = makePrompter();

  const inputName = await ask(`Project name ${c.gray('[' + name + ']')}: `);
  if (inputName.trim()) name = inputName.trim();

  const descPrompt = description
    ? `Description ${c.gray('[' + description + ']')}: `
    : 'Description (optional): ';
  const inputDesc = await ask(descPrompt);
  if (inputDesc.trim()) description = inputDesc.trim();
  else if (!description) description = '';

  close();

  // Create directories
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'history'), { recursive: true });

  const config = {
    version: '0.1.0',
    project: name,
    description,
    created: new Date().toISOString(),
    authors: [],
    banners: [...store.DEFAULT_BANNERS],
    custom_banners: [],
    banner_descriptions: {},
  };
  store.saveConfig(cwd, config);

  const state = {
    updated: new Date().toISOString(),
    project: { name, description, stack: detected.stack },
    banners: {},
  };
  for (const b of store.DEFAULT_BANNERS) state.banners[b] = { entries: [] };

  // Auto-populate packages banner
  if (detected.packages.length > 0) {
    const pkgList = detected.packages
      .slice(0, 60)
      .map(p => p.version ? `${p.name}@${p.version}` : p.name)
      .join(', ');
    state.banners.packages.entries.push({
      id: store.generateId(),
      status: 'active',
      content: `Detected packages: ${pkgList}`,
      author: 'agenctx-sync',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      last_read: null,
      read_count: 0,
    });
  }

  // Auto-populate env banner
  if (detected.envVars.length > 0) {
    const envList = detected.envVars
      .map(e => e.description ? `${e.name} (${e.description})` : e.name)
      .join(', ');
    state.banners.env.entries.push({
      id: store.generateId(),
      status: 'active',
      content: `Environment variables: ${envList}`,
      author: 'agenctx-sync',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      last_read: null,
      read_count: 0,
    });
  }

  store.saveState(cwd, state);
  store.appendHistory(cwd, {
    action: 'init',
    author: process.env.USER || 'user',
    command: 'init',
    project: name,
  });

  // Git hook
  if (withHook) {
    const installed = installGitHook(cwd);
    if (installed) console.log(c.green('✓') + ' Git pre-commit hook installed');
  }

  console.log();
  console.log(c.green('✓') + ` Initialized .agenctx/`);
  console.log(c.green('✓') + ` Project: ${c.bold(name)}`);
  if (description) console.log(c.green('✓') + ` Description: ${description}`);
  if (detected.stack.length) console.log(c.green('✓') + ` Stack: ${detected.stack.join(', ')}`);
  if (detected.packages.length) console.log(c.green('✓') + ` Packages: ${detected.packages.length} detected`);
  if (detected.envVars.length) console.log(c.green('✓') + ` Env vars: ${detected.envVars.length} detected`);
  console.log();
}

module.exports = { init };
