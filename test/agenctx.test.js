'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runDecay } = require('../lib/decay');

const CLI = path.resolve(__dirname, '..', 'bin', 'agenctx.js');
const tempDirs = [];

function tempProject(packageData = { name: 'test-project' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agenctx-test-'));
  tempDirs.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageData), 'utf8');
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test.afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

test('old entries spend the configured period in ambient state', () => {
  const old = new Date(Date.now() - 61 * 86400000).toISOString();
  const state = {
    banners: {
      notes: {
        entries: [{
          id: 'abc123',
          status: 'active',
          content: 'old note',
          created: old,
          last_read: null,
          read_count: 0,
        }],
      },
    },
  };

  runDecay(state, {});
  assert.equal(state.banners.notes.entries[0].status, 'ambient');
  runDecay(state, {});
  assert.equal(state.banners.notes.entries[0].status, 'ambient');
});

test('search accepts filters after the query', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  assert.equal(run(root, 'add', 'decision', '-m', 'Use JWT for API access').status, 0);

  const result = run(root, 'search', 'JWT', '--since=1w');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 result/);
  assert.match(result.stdout, /Use JWT/);
});

test('dump preserves user-authored documentation and is idempotent', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const readme = path.join(root, 'README.md');
  fs.writeFileSync(readme, '# My project\n\nKeep this text.\n', 'utf8');

  assert.equal(run(root, 'dump', 'readme').status, 0);
  const first = fs.readFileSync(readme, 'utf8');
  assert.match(first, /Keep this text\./);
  assert.match(first, /<!-- agenctx:start -->/);

  assert.equal(run(root, 'dump', 'readme').status, 0);
  assert.equal(fs.readFileSync(readme, 'utf8'), first);
  assert.equal(run(root, 'dump', 'readme', '--check').status, 0);
});

test('sync removes stale generated context and saves stack-only changes', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const statePath = path.join(root, '.agenctx', 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const stale = {
    id: 'abc123',
    status: 'active',
    content: 'stale',
    author: 'agenctx-sync',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    last_read: null,
    read_count: 0,
  };
  state.banners.packages.entries = [stale];
  state.banners.env.entries = [{ ...stale, id: 'def456' }];
  state.project.stack = ['stale-stack'];
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  const result = run(root, 'sync');
  assert.equal(result.status, 0, result.stderr);
  const updated = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(updated.banners.packages.entries, []);
  assert.deepEqual(updated.banners.env.entries, []);
  assert.deepEqual(updated.project.stack, ['node']);
});

test('core entry lifecycle and session audit work end to end', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);

  const added = run(root, 'add', 'warning', '--pin', 'Do not edit generated files');
  assert.equal(added.status, 0, added.stderr);
  const id = added.stdout.match(/\[([0-9a-f]{6})\]/)?.[1];
  assert.ok(id, added.stdout);

  assert.equal(run(root, 'session', 'start', 'Review project rules').status, 0);
  assert.equal(run(root, 'view', id, '--agent').status, 0);
  assert.equal(run(root, 'session', 'end').status, 0);
  assert.equal(run(root, 'unpin', id).status, 0);
  assert.equal(run(root, 'archive', id, '--force').status, 0);
  assert.equal(run(root, 'restore', id).status, 0);

  const audit = run(root, 'audit');
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /session_start/);
  assert.match(audit.stdout, /read/);
  assert.match(audit.stdout, /archive/);
});

test('optional Git hook checks generated files without staging them', () => {
  const root = tempProject();
  const git = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);

  const initialized = run(root, 'init', '--hook');
  assert.equal(initialized.status, 0, initialized.stderr);
  const hook = fs.readFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), 'utf8');
  assert.match(hook, /agenctx dump all --check/);
  assert.doesNotMatch(hook, /git add/);
});

test('view is a complete context directory and banners separate pinned entries', () => {
  const root = tempProject({ name: 'checkout-api', description: 'Example service' });
  assert.equal(run(root, 'init').status, 0);
  const pinned = run(root, 'add', 'warn', '--pin', 'Never edit generated API files');
  assert.equal(pinned.status, 0, pinned.stderr);
  assert.equal(run(root, 'add', 'warn', 'Another active warning').status, 0);
  assert.equal(run(root, 'add', 'decision', 'Use SQLite for local state').status, 0);

  const overview = run(root, 'view');
  assert.equal(overview.status, 0, overview.stderr);
  assert.match(overview.stdout, /checkout-api\s+Example service/);
  assert.match(overview.stdout, /Pinned context \(1\)/);
  assert.match(overview.stdout, /warnings\s+2\s+1\s+agenctx view warnings/);
  assert.match(overview.stdout, /decisions\s+1\s+0\s+agenctx view decisions/);
  assert.match(overview.stdout, /notes\s+0\s+0\s+agenctx view notes/);
  assert.match(overview.stdout, /blockers\s+0\s+0\s+agenctx view blockers/);

  const warnings = run(root, 'view', 'warnings');
  assert.equal(warnings.status, 0, warnings.stderr);
  assert.match(warnings.stdout, /Pinned \(1\)[\s\S]*Never edit generated API files/);
  assert.match(warnings.stdout, /Other entries \(1\)[\s\S]*Another active warning/);
  assert.match(warnings.stdout, /Back to all types:\s+agenctx view/);
});
