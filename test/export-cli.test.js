'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const cli = path.resolve(__dirname, '../bin/agenctx.js');

test('CLI exports pure JSON without modifying store and validates outside a project', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agenctx-export-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  fs.mkdirSync(path.join(root, '.agenctx'));
  const statePath = path.join(root, '.agenctx/state.json');
  fs.writeFileSync(statePath, JSON.stringify(require('./fixtures/retrieval.json').state));
  fs.writeFileSync(path.join(root, '.agenctx/config.json'), '{}');
  const before = fs.readFileSync(statePath, 'utf8');
  const result = run('export', 'context');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).kind, 'context');
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
  const exported = path.join(root, 'export.json');
  fs.writeFileSync(exported, result.stdout);
  const validated = spawnSync(process.execPath, [cli, 'export', 'validate', exported],
    { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).valid, true);
  assert.notEqual(run('export', 'nonsense').status, 0);
});
