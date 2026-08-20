'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runDecay } = require('../lib/decay');
const { createUIServer } = require('../lib/ui/server');

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

function uiRequest(port, pathname, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = body == null ? null : JSON.stringify(body);
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        ...(token ? { 'X-Agenctx-Token': token } : {}),
        ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if ((response.headers['content-type'] || '').includes('application/json')) json = JSON.parse(text);
        resolve({ status: response.statusCode, headers: response.headers, text, json });
      });
    });
    request.on('error', reject);
    if (encoded) request.write(encoded);
    request.end();
  });
}

test.after(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

test('init opens with the agenctx llama poster once', () => {
  const root = tempProject({ name: 'llama-project' });
  const first = run(root, 'init');
  assert.equal(first.status, 0, first.stderr);
  assert.ok(first.stdout.includes('       /\\  /\\        [ rules ]'));
  assert.match(first.stdout, /\[ decisions \]/);
  assert.match(first.stdout, /\[ warnings \]/);
  assert.match(first.stdout, /durable context for coding agents/);

  const repeated = run(root, 'init');
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.doesNotMatch(repeated.stdout, /\[ decisions \]/);
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

test('read frequency extends retention without making entries permanent', () => {
  const now = new Date('2026-08-17T12:00:00.000Z');

  function statusAfter(readCount, inactiveDays, status = 'active') {
    const anchor = new Date(now.getTime() - inactiveDays * 86400000).toISOString();
    const state = {
      banners: {
        notes: {
          entries: [{
            id: `${readCount}-${inactiveDays}`,
            status,
            content: 'retention candidate',
            created: anchor,
            updated: anchor,
            last_read: anchor,
            read_count: readCount,
          }],
        },
      },
    };
    runDecay(state, {}, { now });
    return state.banners.notes.entries[0].status;
  }

  assert.equal(statusAfter(0, 31), 'ambient');
  assert.equal(statusAfter(5, 31), 'active');
  assert.equal(statusAfter(10, 61), 'ambient');
  assert.equal(statusAfter(20, 91), 'ambient');
  assert.equal(statusAfter(0, 365, 'pinned'), 'pinned');
});

test('lifecycle command audits decay, reactivation, archive, and restore', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const added = run(root, 'add', 'note', 'Lifecycle test context');
  const id = added.stdout.match(/\[([0-9a-f]{6})\]/)?.[1];
  assert.ok(id, added.stdout);

  const statePath = path.join(root, '.agenctx', 'state.json');
  let state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  let entry = state.banners.notes.entries.find(item => item.id === id);
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  entry.created = old;
  entry.updated = old;
  entry.last_read = old;
  entry.read_count = 10;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  const decayed = run(root, 'lifecycle');
  assert.equal(decayed.status, 0, decayed.stderr);
  assert.match(decayed.stdout, /CONTEXT LIFECYCLE/);
  assert.match(decayed.stdout, /APPLIED NOW/);
  assert.match(decayed.stdout, /active -> ambient/);

  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  entry = state.banners.notes.entries.find(item => item.id === id);
  assert.equal(entry.status, 'ambient');

  const viewed = run(root, 'view', id);
  assert.equal(viewed.status, 0, viewed.stderr);
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  entry = state.banners.notes.entries.find(item => item.id === id);
  assert.equal(entry.status, 'active');
  assert.equal(entry.decayed_at, undefined);

  entry.status = 'ambient';
  entry.decayed_at = new Date(Date.now() - 61 * 86400000).toISOString();
  entry.updated = entry.decayed_at;
  entry.last_read = entry.decayed_at;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  const archived = run(root, 'lifecycle');
  assert.equal(archived.status, 0, archived.stderr);
  assert.match(archived.stdout, /ambient -> archived/);
  assert.match(archived.stdout, /ARCHIVE \(1\)/);

  assert.equal(run(root, '--agent', 'start', 'Read archived context').status, 0);
  const agentRead = run(root, 'view', id);
  assert.equal(agentRead.status, 1);
  assert.match(agentRead.stderr, /Archived context is not served to agents/);
  assert.equal(run(root, '--agent', 'end').status, 0);

  assert.equal(run(root, 'restore', id).status, 0);
  assert.equal(run(root, 'lifecycle').status, 0);
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  entry = state.banners.notes.entries.find(item => item.id === id);
  assert.equal(entry.status, 'active');

  const history = fs.readdirSync(path.join(root, '.agenctx', 'history'))
    .sort()
    .map(file => JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'history', file), 'utf8')));
  assert.ok(history.some(event => event.action === 'decay' && event.entry?.id === id));
  assert.ok(history.some(event => event.action === 'reactivate' && event.entry?.id === id));
  assert.ok(history.some(event => event.action === 'auto_archive' && event.entry?.id === id));
  assert.ok(history.some(event => event.action === 'restore' && event.entry?.id === id));
});

test('search applies lifecycle before serving context', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const added = run(root, 'add', 'warning', 'Expired searchable warning');
  const id = added.stdout.match(/\[([0-9a-f]{6})\]/)?.[1];
  assert.ok(id, added.stdout);

  const statePath = path.join(root, '.agenctx', 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const entry = state.banners.warnings.entries.find(item => item.id === id);
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  entry.created = old;
  entry.updated = old;
  entry.last_read = null;
  entry.read_count = 0;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  const result = run(root, 'search', 'Expired searchable');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No matching context/);

  const updated = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(updated.banners.warnings.entries.find(item => item.id === id).status, 'ambient');
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

test('agents can propose at most two entries for later human review', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'proposals.json'), 'utf8')),
    { version: 1, proposals: [] },
  );

  const withoutSession = run(root, 'propose', 'warning', 'Do not rotate only one token store');
  assert.equal(withoutSession.status, 1);
  assert.match(withoutSession.stderr, /active tracked agent session/);

  assert.equal(run(root, '--agent', 'start', 'Fix token rotation').status, 0);
  const first = run(root, 'propose', 'warning', 'Token rotation must update both stores atomically');
  assert.equal(first.status, 0, first.stderr);
  const firstId = first.stdout.match(/\[(p-[0-9a-f]{6})\]/)?.[1];
  assert.ok(firstId, first.stdout);

  const second = run(root, 'propose', 'testing', 'Run the token rotation integration test');
  assert.equal(second.status, 0, second.stderr);
  const secondId = second.stdout.match(/\[(p-[0-9a-f]{6})\]/)?.[1];
  assert.ok(secondId, second.stdout);

  const third = run(root, 'propose', 'decision', 'Use a third token store');
  assert.equal(third.status, 1);
  assert.match(third.stderr, /already submitted 2 proposals/);

  const listed = run(root, 'proposals');
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, new RegExp(firstId));
  assert.match(listed.stdout, new RegExp(secondId));
  assert.match(listed.stdout, /2 pending/);

  const banner = run(root, 'view', 'warnings');
  assert.equal(banner.status, 0, banner.stderr);
  assert.doesNotMatch(banner.stdout, /Token rotation must update both stores atomically/);
  const search = run(root, 'search', 'both stores atomically');
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /No matching context/);

  const agentApproval = run(root, 'approve', firstId);
  assert.equal(agentApproval.status, 1);
  assert.match(agentApproval.stderr, /Agents cannot approve/);
  assert.equal(run(root, '--agent', 'end').status, 0);

  const approved = run(root, 'approve', firstId);
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stdout, /Created trusted context/);
  const entryId = approved.stdout.match(/trusted context \[([0-9a-f]{6})\]/)?.[1];
  assert.ok(entryId, approved.stdout);

  const state = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'state.json'), 'utf8'));
  const entry = state.banners.warnings.entries.find(item => item.id === entryId);
  assert.equal(entry.content, 'Token rotation must update both stores atomically');
  assert.equal(entry.proposal_id, firstId);
  assert.match(entry.source_session, /^s-[0-9a-f]{6}$/);

  const rejected = run(root, 'reject', secondId);
  assert.equal(rejected.status, 0, rejected.stderr);
  assert.match(rejected.stdout, /Rejected proposal/);
  const empty = run(root, 'proposals');
  assert.match(empty.stdout, /0 pending/);

  const proposalData = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'proposals.json'), 'utf8'));
  assert.deepEqual(proposalData, { version: 1, proposals: [] });

  const history = fs.readdirSync(path.join(root, '.agenctx', 'history'))
    .sort()
    .map(file => JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'history', file), 'utf8')));
  assert.equal(history.filter(event => event.action === 'propose').length, 2);
  assert.ok(history.some(event => event.action === 'approve'
    && event.proposal?.id === firstId
    && event.proposal?.status === 'approved'));
  assert.ok(history.some(event => event.action === 'reject'
    && event.proposal?.id === secondId
    && event.proposal?.status === 'rejected'
    && event.proposal?.content === 'Run the token rotation integration test'));
});

test('proposal creation rejects duplicate trusted and pending context', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const added = run(root, 'add', 'warning', 'Never edit generated clients');
  const entryId = added.stdout.match(/\[([0-9a-f]{6})\]/)?.[1];
  assert.ok(entryId, added.stdout);
  assert.equal(run(root, '--agent', 'start', 'Review generated clients').status, 0);

  const trustedDuplicate = run(root, 'propose', 'warning', '  NEVER   edit generated clients  ');
  assert.equal(trustedDuplicate.status, 1);
  assert.match(trustedDuplicate.stderr, new RegExp(`already exists as entry \\[${entryId}\\]`));

  const proposed = run(root, 'propose', 'rule', 'Regenerate clients after schema changes');
  assert.equal(proposed.status, 0, proposed.stderr);
  const proposalId = proposed.stdout.match(/\[(p-[0-9a-f]{6})\]/)?.[1];
  assert.ok(proposalId, proposed.stdout);

  const pendingDuplicate = run(root, 'propose', 'note', 'REGENERATE clients after   schema changes');
  assert.equal(pendingDuplicate.status, 1);
  assert.match(pendingDuplicate.stderr, new RegExp(`already pending as \\[${proposalId}\\]`));
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
    assert.match(content, /--session=<id>/);
    assert.match(content, /agenctx view/);
    assert.match(content, /agenctx view <type>/);
    assert.match(content, /agenctx search "<keyword>"/);
    assert.match(content, /discovery commands return previews/i);
    assert.match(content, /Never act on a relevant preview alone/);
    assert.match(content, /agenctx view <entry-id> --session=<id>/);
    assert.match(content, /Open the smallest relevant set/);
    assert.match(content, /appears as `FULL` in the session receipt/);
    assert.match(content, /agenctx propose <type>/);
    assert.match(content, /Most tasks require no proposal/);
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

test('discovery previews direct agents to full retrieval and warn when skipped', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const added = run(root, 'add', 'warning', 'Regenerate clients after schema changes');
  assert.equal(added.status, 0, added.stderr);
  const entryId = added.stdout.match(/\[([0-9a-f]{6})\]/)?.[1];
  assert.ok(entryId, added.stdout);

  const started = run(root, '--agent', 'start', 'Update generated client');
  assert.equal(started.status, 0, started.stderr);
  const sessionId = started.stdout.match(/(s-[0-9a-f]{6})/)?.[1];
  assert.ok(sessionId, started.stdout);

  const searched = run(root, 'search', 'schema', `--session=${sessionId}`);
  assert.equal(searched.status, 0, searched.stderr);
  assert.match(searched.stdout, /SEARCH PREVIEWS/);
  assert.match(searched.stdout, /Discovery only/);
  assert.match(searched.stdout, new RegExp(`agenctx view <id> --session=${sessionId}`));

  const banner = run(root, 'view', 'warnings', `--session=${sessionId}`);
  assert.equal(banner.status, 0, banner.stderr);
  assert.match(banner.stdout, /previews only/i);
  assert.match(banner.stdout, new RegExp(`Open relevant entries in full: agenctx view <id> --session=${sessionId}`));

  const ended = run(root, '--agent', 'end', `--session=${sessionId}`);
  assert.equal(ended.status, 0, ended.stderr);
  assert.match(ended.stdout, /RECEIPT SEALED/);
  assert.match(ended.stdout, /PREVIEWS ONLY/);
  assert.match(ended.stdout, /none was opened in full/);

  const receiptFile = fs.readdirSync(path.join(root, '.agenctx', 'sessions'))[0];
  const receipt = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'sessions', receiptFile), 'utf8'));
  assert.ok(receipt.served.flatMap(event => event.entries || []).every(entry => entry.mode === 'preview'));
});

test('local UI serves secured repository data and rejects stale writes', async () => {
  const root = tempProject({ name: 'ui-test', description: 'Local control plane' });
  assert.equal(run(root, 'init').status, 0);
  assert.equal(run(root, 'add', 'warning', 'Never expose provider credentials').status, 0);

  const token = 'test-ui-token';
  const { server } = createUIServer(root, { token });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  try {
    const page = await uiRequest(port, '/');
    assert.equal(page.status, 200);
    assert.match(page.text, /<h1 id="page-title">Context<\/h1>/);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);

    const unauthorized = await uiRequest(port, '/api/snapshot');
    assert.equal(unauthorized.status, 401);

    const loaded = await uiRequest(port, '/api/snapshot', { token });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.json.project.name, 'ui-test');
    assert.equal(loaded.json.counts.active, 1);
    assert.equal(loaded.json.forecast.buckets.length, 4);

    const write = {
      banner: 'rules',
      content: 'Keep provider adapters replaceable',
      stateRevision: loaded.json.revisions.state,
    };
    const added = await uiRequest(port, '/api/entries', { method: 'POST', token, body: write });
    assert.equal(added.status, 200);
    assert.match(added.json.result.id, /^[0-9a-f]{6}$/);

    const stale = await uiRequest(port, '/api/entries', { method: 'POST', token, body: write });
    assert.equal(stale.status, 409);
    assert.match(stale.json.error, /changed outside this browser/);

    const refreshed = await uiRequest(port, '/api/snapshot', { token });
    assert.equal(refreshed.json.counts.active, 2);

    const settings = await uiRequest(port, '/api/settings', {
      method: 'PUT',
      token,
      body: {
        project: 'ui-test',
        description: 'Updated through the local UI',
        decay: {
          activeToAmbientDays: 45,
          readExtensionDays: 4,
          maxReadExtensionDays: 75,
          ambientToArchivedDays: 90,
        },
        configRevision: refreshed.json.revisions.config,
        stateRevision: refreshed.json.revisions.state,
      },
    });
    assert.equal(settings.status, 200);
    const finalSnapshot = await uiRequest(port, '/api/snapshot', { token });
    assert.equal(finalSnapshot.json.config.decay.activeToAmbientDays, 45);
    assert.equal(finalSnapshot.json.project.description, 'Updated through the local UI');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('import previews an agent guide without changing project files', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  assert.equal(run(root, 'add', 'testing', 'Run the complete offline test suite.').status, 0);
  const agents = path.join(root, 'AGENTS.md');
  const original = [
    '# Project instructions',
    '',
    'Keep runtime dependencies replaceable.',
    '',
    '## Testing',
    '',
    'Run the complete `offline` test suite.',
    '',
  ].join('\n');
  fs.writeFileSync(agents, original, 'utf8');

  const preview = run(root, 'import', 'AGENTS.md');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /IMPORT PREVIEW/);
  assert.match(preview.stdout, /Project instructions\s+rules/);
  assert.doesNotMatch(preview.stdout, /Testing\s+testing/);
  assert.match(preview.stdout, /1 new entry\s+· 1 already imported/);
  assert.match(preview.stdout, /Preview only; no files were changed/);
  assert.equal(fs.readFileSync(agents, 'utf8'), original);

  const state = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'state.json'), 'utf8'));
  assert.equal(state.banners.rules.entries.length, 0);
  assert.equal(state.banners.testing.entries.length, 1);
});

test('import migrates an agent guide into lifecycle entries and preserves its source', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const agents = path.join(root, 'AGENTS.md');
  const original = [
    '# Project instructions',
    '',
    'Keep runtime dependencies replaceable.',
    '',
    '## Architecture decisions',
    '',
    'Use adapter contracts at every provider boundary.',
    '',
    '## Testing',
    '',
    'Run the complete offline test suite.',
    '',
    '## Known hazards',
    '',
    'Never expose decrypted provider credentials.',
    '',
  ].join('\n');
  fs.writeFileSync(agents, original, 'utf8');

  const imported = run(root, 'import', 'AGENTS.md', '--apply');
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /Imported 4 entries/);
  assert.match(imported.stdout, /Source replaced with the static agenctx guide/);

  const state = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'state.json'), 'utf8'));
  assert.match(state.banners.rules.entries[0].content, /Keep runtime dependencies replaceable/);
  assert.match(state.banners.decisions.entries[0].content, /adapter contracts/);
  assert.match(state.banners.testing.entries[0].content, /offline test suite/);
  assert.match(state.banners.warnings.entries[0].content, /decrypted provider credentials/);
  for (const banner of ['rules', 'decisions', 'testing', 'warnings']) {
    assert.equal(state.banners[banner].entries[0].status, 'active');
    assert.equal(state.banners[banner].entries[0].source.file, 'AGENTS.md');
  }

  const replacement = fs.readFileSync(agents, 'utf8');
  assert.match(replacement, /<!-- agenctx:start -->/);
  assert.match(replacement, /agenctx --agent start/);
  assert.doesNotMatch(replacement, /decrypted provider credentials/);

  const importsDir = path.join(root, '.agenctx', 'imports');
  const backups = fs.readdirSync(importsDir);
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^AGENTS\.[0-9a-f]{12}\.md$/);
  assert.equal(fs.readFileSync(path.join(importsDir, backups[0]), 'utf8'), original);

  const second = run(root, 'import', 'AGENTS.md', '--apply');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /No importable context found/);
});

test('README import selects operational sections and leaves the README unchanged', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const readmePath = path.join(root, 'README.md');
  const original = [
    '# Example product',
    '',
    'Marketing introduction that should not become agent context.',
    '',
    '## Architecture',
    '',
    'The runtime depends on small adapter contracts.',
    '',
    '## Screenshots',
    '',
    'A gallery that should not become agent context.',
    '',
    '## Tests',
    '',
    'Run python -m pytest.',
    '',
    '## Configuration',
    '',
    'Use a stable secret key in production.',
    '',
  ].join('\n');
  fs.writeFileSync(readmePath, original, 'utf8');

  const imported = run(root, 'import', 'README.md', '--apply');
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /3 new entries/);
  assert.match(imported.stdout, /2 sections skipped/);
  assert.match(imported.stdout, /source file will remain unchanged/i);
  assert.equal(fs.readFileSync(readmePath, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, '.agenctx', 'imports')), false);

  const state = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'state.json'), 'utf8'));
  assert.match(state.banners.decisions.entries[0].content, /adapter contracts/);
  assert.match(state.banners.testing.entries[0].content, /python -m pytest/);
  assert.match(state.banners.env.entries[0].content, /stable secret key/);
  assert.equal(state.banners.notes.entries.length, 0);

  const repeated = run(root, 'import', 'README.md', '--apply');
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /0 new entries/);
  assert.match(repeated.stdout, /Nothing to import/);
});

test('custom Markdown sections require a purpose and keep nested headings together', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const sourcePath = path.join(root, 'PROJECT_CONTEXT.md');
  const source = [
    '# Migration seed',
    '',
    'Document introduction.',
    '',
    '## Release Confidence',
    '',
    '### Candidate promotion',
    '',
    'Run the promotion checks before publishing.',
    '',
    '## Escalation Paths',
    '',
    '> Purpose: Guidance for routing conversations to human operators.',
    '',
    '### Human handoff',
    '',
    'Preserve the conversation trace during handoff.',
    '',
  ].join('\n');
  fs.writeFileSync(sourcePath, source, 'utf8');

  const imported = run(root, 'import', 'PROJECT_CONTEXT.md', '--apply');
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /Candidate promotion\s+release-confidence\s+needs purpose/);
  assert.match(imported.stdout, /CUSTOM BANNERS NEED PURPOSE/);
  assert.match(imported.stdout, /Release Confidence\s+→\s+release-confidence/);
  assert.match(imported.stdout, /CUSTOM BANNERS/);
  assert.match(imported.stdout, /escalation-paths.*Guidance for routing conversations/);
  assert.match(imported.stdout, /Imported 1 entry/);
  assert.ok(
    imported.stdout.indexOf('IMPORT PREVIEW') < imported.stdout.indexOf('CUSTOM BANNERS NEED PURPOSE'),
  );

  const config = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'config.json'), 'utf8'));
  assert.deepEqual(config.custom_banners, ['escalation-paths']);
  assert.equal(
    config.banner_descriptions['escalation-paths'],
    'Guidance for routing conversations to human operators.',
  );
  assert.equal(config.banner_descriptions['release-confidence'], undefined);

  const state = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'state.json'), 'utf8'));
  assert.equal(state.banners['escalation-paths'].entries.length, 1);
  assert.match(state.banners['escalation-paths'].entries[0].content, /Human handoff/);
  assert.equal(state.banners['release-confidence'], undefined);
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
  assert.doesNotMatch(ended.stdout, /PREVIEWS ONLY/);

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
  assert.match(shown.stdout, /AGENT TRACE\s+[0-9a-f]{12}\s+VALID/);
  assert.match(shown.stdout, /Fix token rotation\s+\n\s+CONTEXT SERVED BY BANNER/);
  assert.doesNotMatch(shown.stdout, /Receipt\s+[0-9a-f]{64}/);
  assert.doesNotMatch(shown.stdout, /When\s+/);
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

test('concurrent agents keep isolated active sessions and receipts', () => {
  const root = tempProject({ name: 'concurrent-test' });
  assert.equal(run(root, 'init').status, 0);
  assert.match(fs.readFileSync(path.join(root, '.agenctx', '.gitignore'), 'utf8'), /^runtime\/\nsession\.json\n$/);
  assert.equal(run(root, 'add', 'warning', 'Warning for agent A').status, 0);
  assert.equal(run(root, 'add', 'decision', 'Decision for agent B').status, 0);
  assert.equal(run(root, 'add', 'testing', 'Testing for remaining agent').status, 0);

  const startedA = run(root, '--agent', 'start', 'Agent A task');
  assert.equal(startedA.status, 0, startedA.stderr);
  const sessionA = startedA.stdout.match(/(s-[0-9a-f]{6})/)?.[1];
  assert.ok(sessionA, startedA.stdout);

  const startedB = run(root, '--agent', 'start', 'Agent B task');
  assert.equal(startedB.status, 0, startedB.stderr);
  const sessionB = startedB.stdout.match(/(s-[0-9a-f]{6})/)?.[1];
  assert.ok(sessionB, startedB.stdout);
  assert.notEqual(sessionA, sessionB);

  const runtimeDir = path.join(root, '.agenctx', 'runtime', 'sessions');
  assert.deepEqual(fs.readdirSync(runtimeDir).sort(), [`${sessionA}.json`, `${sessionB}.json`].sort());

  const ambiguous = run(root, 'view');
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /2 sessions are active/);
  assert.match(ambiguous.stderr, /--session=<id>/);

  const servedA = run(root, 'view', 'warnings', `--session=${sessionA}`);
  assert.equal(servedA.status, 0, servedA.stderr);
  const servedB = run(root, '--session', sessionB, 'view', 'decisions');
  assert.equal(servedB.status, 0, servedB.stderr);

  const proposedA = run(
    root,
    'propose',
    'note',
    'Agent A discovered durable context',
    `--session=${sessionA}`,
  );
  assert.equal(proposedA.status, 0, proposedA.stderr);
  const proposalData = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'proposals.json'), 'utf8'));
  assert.equal(proposalData.proposals[0].session_id, sessionA);

  const liveList = run(root, 'session', 'list');
  assert.equal(liveList.status, 0, liveList.stderr);
  assert.match(liveList.stdout, new RegExp(sessionA));
  assert.match(liveList.stdout, new RegExp(sessionB));

  const endedB = run(root, '--agent', 'end', `--session=${sessionB}`);
  assert.equal(endedB.status, 0, endedB.stderr);
  assert.equal(fs.existsSync(path.join(runtimeDir, `${sessionB}.json`)), false);
  assert.equal(fs.existsSync(path.join(runtimeDir, `${sessionA}.json`)), true);

  const remaining = run(root, 'view', 'testing');
  assert.equal(remaining.status, 0, remaining.stderr);
  const endedA = run(root, '--agent', 'end');
  assert.equal(endedA.status, 0, endedA.stderr);
  assert.deepEqual(fs.readdirSync(runtimeDir), []);

  const receipts = fs.readdirSync(path.join(root, '.agenctx', 'sessions'))
    .map(file => JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'sessions', file), 'utf8')));
  const receiptA = receipts.find(item => item.id === sessionA);
  const receiptB = receipts.find(item => item.id === sessionB);
  assert.deepEqual(receiptA.served.map(event => event.command), ['view warnings', 'view testing']);
  assert.deepEqual(receiptB.served.map(event => event.command), ['view decisions']);
});

test('legacy active session files migrate into ignored runtime storage', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const legacy = {
    id: 's-abc123',
    actor: 'agent',
    description: 'Legacy active task',
    started: new Date().toISOString(),
    served: [],
  };
  const legacyPath = path.join(root, '.agenctx', 'session.json');
  fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2), 'utf8');

  const listed = run(root, 'session', 'list');
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /s-abc123/);
  assert.equal(fs.existsSync(legacyPath), false);
  assert.equal(
    fs.existsSync(path.join(root, '.agenctx', 'runtime', 'sessions', 's-abc123.json')),
    true,
  );

  const ended = run(root, 'session', 'end', 's-abc123');
  assert.equal(ended.status, 0, ended.stderr);
  assert.match(ended.stdout, /RECEIPT SEALED/);

  const started = run(root, '--agent', 'start', 'Abandoned task');
  const abandonedId = started.stdout.match(/(s-[0-9a-f]{6})/)?.[1];
  assert.ok(abandonedId, started.stdout);
  const abandoned = run(root, 'session', 'abandon', abandonedId);
  assert.equal(abandoned.status, 0, abandoned.stderr);
  assert.match(abandoned.stdout, /No receipt was sealed/);
  assert.equal(
    fs.existsSync(path.join(root, '.agenctx', 'runtime', 'sessions', `${abandonedId}.json`)),
    false,
  );
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

test('clear removes an entry, a banner, or all live context with confirmation safeguards', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  const first = run(root, 'add', 'warning', 'First warning');
  const id = first.stdout.match(/\[([0-9a-f]{6})\]/)?.[1];
  assert.ok(id, first.stdout);
  assert.equal(run(root, 'add', 'warning', 'Second warning').status, 0);
  assert.equal(run(root, 'add', 'decision', 'Use adapter contracts').status, 0);

  const unconfirmed = run(root, 'clear', id);
  assert.equal(unconfirmed.status, 1);
  assert.match(unconfirmed.stderr, /requires confirmation/);

  let state = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'state.json'), 'utf8'));
  assert.equal(state.banners.warnings.entries.length, 2);

  const one = run(root, 'clear', id, '--force');
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /Cleared warnings/);
  state = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'state.json'), 'utf8'));
  assert.equal(state.banners.warnings.entries.length, 1);
  assert.equal(state.banners.decisions.entries.length, 1);

  const banner = run(root, 'clear', 'warning', '--force');
  assert.equal(banner.status, 0, banner.stderr);
  assert.match(banner.stdout, /Cleared 1 entry from warnings/);
  state = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'state.json'), 'utf8'));
  assert.equal(state.banners.warnings.entries.length, 0);
  assert.equal(state.banners.decisions.entries.length, 1);

  assert.equal(run(root, 'add', 'rule', 'Keep tests offline').status, 0);
  const all = run(root, 'clear', '--all', '--force');
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /Cleared all 2 entries/);
  state = JSON.parse(fs.readFileSync(path.join(root, '.agenctx', 'state.json'), 'utf8'));
  assert.equal(
    Object.values(state.banners).reduce((count, value) => count + value.entries.length, 0),
    0,
  );

  const historyDir = path.join(root, '.agenctx', 'history');
  const history = fs.readdirSync(historyDir)
    .sort()
    .map(file => JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8')));
  assert.equal(history.filter(event => event.action === 'clear').length, 3);
  assert.equal(history.at(-1).scope, 'all');
  assert.equal(history.at(-1).count, 2);
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
  assert.match(overview.stdout, /checkout-api: Example service/);
  assert.match(overview.stdout, /IMPORTANT · PINNED \(1\)/);
  assert.match(overview.stdout, /warnings\s+2\s+1\s+Critical gotchas/);
  assert.match(overview.stdout, /decisions\s+1\s+0\s+Architectural choices/);
  assert.match(overview.stdout, /notes\s+0\s+0\s+Useful implementation/);
  assert.match(overview.stdout, /blockers\s+0\s+0\s+Known constraints/);
  assert.doesNotMatch(overview.stdout, /\bNext\b/);

  const warnings = run(root, 'view', 'warnings');
  assert.equal(warnings.status, 0, warnings.stderr);
  assert.match(warnings.stdout, /IMPORTANT · PINNED \(1\)[\s\S]*Never edit generated API files/);
  assert.match(warnings.stdout, /OTHER CONTEXT \(1\)[\s\S]*Another active warning/);
  assert.doesNotMatch(warnings.stdout, /\bNext\b/);
});

test('custom context types are discoverable with their descriptions', () => {
  const root = tempProject();
  assert.equal(run(root, 'init').status, 0);
  assert.equal(run(root, 'banner', 'add', 'must-see', '--description=Mandatory context before changes').status, 0);
  assert.equal(run(root, 'add', 'must-see', 'Read this first').status, 0);

  const overview = run(root, 'view');
  assert.equal(overview.status, 0, overview.stderr);
  assert.match(overview.stdout, /must-see\s+1\s+0\s+Mandatory context before changes/);
  assert.doesNotMatch(overview.stdout, /\bNext\b/);
  const banner = run(root, 'view', 'must-see');
  assert.match(banner.stdout, /Mandatory context before changes/);
  assert.match(banner.stdout, /Read this first/);
});
