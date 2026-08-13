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

test('edit can update an entry non-interactively', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const added = run(root, 'add', 'decision', 'Use SQLite');
  const id = added.stdout.match(/\[([0-9a-f]{6})\]/)?.[1];
  assert.ok(id, added.stdout);

  const edited = run(root, 'edit', id, '-m', 'Use SQLite with WAL mode');
  assert.equal(edited.status, 0, edited.stderr);
  assert.match(edited.stdout, /Updated/);
  const viewed = run(root, 'view', id);
  assert.match(viewed.stdout, /Use SQLite with WAL mode/);
});

test('dump preserves user-authored documentation and is idempotent', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const agents = path.join(root, 'AGENTS.md');
  fs.writeFileSync(agents, '# My project\n\nKeep this text.\n', 'utf8');

  assert.equal(run(root, 'dump', 'openai').status, 0);
  const first = fs.readFileSync(agents, 'utf8');
  assert.match(first, /Keep this text\./);
  assert.match(first, /<!-- agenctx:start -->/);

  assert.equal(run(root, 'dump', 'openai').status, 0);
  assert.equal(fs.readFileSync(agents, 'utf8'), first);
  assert.equal(run(root, 'dump', 'openai', '--check').status, 0);
});

test('dump creates exactly three concise agent instruction files', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);

  const result = run(root, 'dump');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run(root, 'dump', 'readme').status, 1);
  assert.deepEqual(
    fs.readdirSync(root).filter(file => ['AGENTS.md', 'CLAUDE.md', '.cursorrules'].includes(file)).sort(),
    ['.cursorrules', 'AGENTS.md', 'CLAUDE.md']
  );
  assert.equal(fs.existsSync(path.join(root, 'README.md')), false);

  for (const file of ['AGENTS.md', 'CLAUDE.md', '.cursorrules']) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(content, /agenctx --agent start/);
    assert.match(content, /agenctx view/);
    assert.match(content, /agenctx view <type>/);
    assert.match(content, /agenctx search "<keyword>"/);
    assert.match(content, /agenctx --agent end/);
    assert.doesNotMatch(content, /agenctx add/);
    assert.doesNotMatch(content, /agenctx view warnings/);
  }

  const beforeContextChanges = Object.fromEntries(
    ['AGENTS.md', 'CLAUDE.md', '.cursorrules'].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')])
  );
  assert.equal(run(root, 'banner', 'add', 'must-see', '--description=Mandatory project context').status, 0);
  assert.equal(run(root, 'add', 'must-see', '--pin', 'Repository-specific information').status, 0);
  assert.equal(run(root, 'dump').status, 0);
  for (const [file, content] of Object.entries(beforeContextChanges)) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), content);
  }
});

test('agent sessions seal ordered served context in hash-chained receipts', () => {
  const root = tempProject({ name: 'receipt-test', description: 'Session receipt demo' });
  assert.equal(run(root, 'init').status, 0);
  assert.equal(run(root, 'banner', 'add', 'must-see', '--description=Mandatory context before changes').status, 0);
  const added = run(root, 'add', 'must-see', '--pin', 'Rotate authentication tokens atomically');
  assert.equal(added.status, 0, added.stderr);
  const id = added.stdout.match(/\[([0-9a-f]{6})\]/)?.[1];
  assert.ok(id, added.stdout);

  assert.equal(run(root, '--agent', 'start', 'Fix token rotation').status, 0);
  assert.equal(run(root, 'view').status, 0);
  assert.equal(run(root, 'view', 'must-see').status, 0);
  assert.equal(run(root, 'search', 'authentication').status, 0);
  assert.equal(run(root, 'view', id).status, 0);
  const ended = run(root, '--agent', 'end');
  assert.equal(ended.status, 0, ended.stderr);

  const sessionsDir = path.join(root, '.agenctx', 'sessions');
  const receiptFiles = fs.readdirSync(sessionsDir);
  assert.equal(receiptFiles.length, 1);
  const receipt = JSON.parse(fs.readFileSync(path.join(sessionsDir, receiptFiles[0]), 'utf8'));
  assert.equal(receiptFiles[0], `${receipt.hash}.json`);
  assert.equal(receipt.actor, 'agent');
  assert.equal(receipt.parent, null);
  assert.deepEqual(receipt.served.map(event => event.command), [
    'view',
    'view must-see',
    'search "authentication"',
    `view ${id}`,
  ]);
  assert.equal(receipt.served[0].entries[0].mode, 'preview');
  assert.equal(receipt.served[3].entries[0].mode, 'full');
  assert.equal(receipt.served[3].entries[0].content, 'Rotate authentication tokens atomically');
  assert.match(receipt.served[3].entries[0].content_hash, /^[0-9a-f]{64}$/);

  const status = run(root, 'status');
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, new RegExp(receipt.hash.slice(0, 12)));
  assert.match(status.stdout, /Hash\s+Task/);
  assert.match(status.stdout, /Fix token rotation/);
  assert.doesNotMatch(status.stdout, /CONTEXT HEALTH/);
  const shown = run(root, 'session', 'show', receipt.hash.slice(0, 12));
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /Integrity\s+valid/);
  assert.match(shown.stdout, /CONTEXT SERVED BY BANNER/);
  assert.match(shown.stdout, /PROJECT OVERVIEW[\s\S]*01\s+view\s+receipt-test/);
  assert.match(shown.stdout, /MUST-SEE[\s\S]*01\s+PREVIEW\s+\[[0-9a-f]{6}\]\s+view/);
  assert.match(shown.stdout, /03\s+PREVIEW\s+\[[0-9a-f]{6}\]\s+search "authentication"/);
  assert.match(shown.stdout, /04\s+FULL\s+\[[0-9a-f]{6}\]\s+view [0-9a-f]{6}/);

  assert.equal(run(root, '--agent', 'start', 'Second interaction').status, 0);
  assert.equal(run(root, 'view', 'must-see').status, 0);
  assert.equal(run(root, '--agent', 'end').status, 0);
  const receipts = fs.readdirSync(sessionsDir)
    .map(file => JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8')));
  const second = receipts.find(item => item.hash !== receipt.hash);
  assert.equal(second.parent, receipt.hash);
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
  assert.match(hook, /agenctx dump --check/);
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
  assert.match(overview.stdout, /checkout-api — Example service/);
  assert.match(overview.stdout, /IMPORTANT · PINNED \(1\)/);
  assert.match(overview.stdout, /warnings\s+2\s+1\s+Critical gotchas/);
  assert.match(overview.stdout, /decisions\s+1\s+0\s+Architectural choices/);
  assert.match(overview.stdout, /notes\s+0\s+0\s+Useful implementation/);
  assert.match(overview.stdout, /blockers\s+0\s+0\s+Known constraints/);
  assert.match(overview.stdout, /agenctx view warnings\s+·\s+open the highest-priority populated type/);

  const warnings = run(root, 'view', 'warnings');
  assert.equal(warnings.status, 0, warnings.stderr);
  assert.match(warnings.stdout, /IMPORTANT · PINNED \(1\)[\s\S]*Never edit generated API files/);
  assert.match(warnings.stdout, /OTHER CONTEXT \(1\)[\s\S]*Another active warning/);
  assert.match(warnings.stdout, /agenctx view\s+·\s+back to all context types/);
});

test('custom context types are discoverable with their descriptions', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  assert.equal(run(root, 'banner', 'add', 'must-see', '--description=Mandatory context before changes').status, 0);
  assert.equal(run(root, 'add', 'must-see', 'Read this first').status, 0);

  const overview = run(root, 'view');
  assert.equal(overview.status, 0, overview.stderr);
  assert.match(overview.stdout, /must-see\s+1\s+0\s+Mandatory context before changes/);
  assert.match(overview.stdout, /agenctx view must-see/);
  const banner = run(root, 'view', 'must-see');
  assert.match(banner.stdout, /Mandatory context before changes/);
  assert.match(banner.stdout, /Read this first/);
});
