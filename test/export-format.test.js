'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { contextExport, encode, decode } = require('../lib/export-format');
const fixture = require('./fixtures/retrieval.json');
const { receiptHash } = require('../lib/commands/session');

test('receipt exports verify original content hash and retain event order', () => {
  const data = { version: 1, id: 's-test', parent: null, actor: 'agent', description: 'test',
    started: '2026-01-01T00:00:00Z', ended: '2026-01-01T00:01:00Z', duration: 60,
    served: [{ sequence: 1, entries: [] }, { sequence: 2, entries: [] }] };
  data.hash = receiptHash(data);
  const envelope = { format: 'agenctx-export', version: 1, kind: 'receipt', data };
  assert.deepEqual(decode(encode(envelope)), envelope);
  data.served.reverse();
  assert.throws(() => encode(envelope), /hash verification/);
  delete data.hash;
  assert.throws(() => encode(envelope), /hash verification/);
});

test('context export round trip preserves statuses and Unicode without aliasing', () => {
  const state = JSON.parse(JSON.stringify(fixture.state));
  state.banners.rules.entries[0].content += '\n日本語 🦙';
  const exported = contextExport({ version: 1 }, state);
  assert.deepEqual(decode(encode(exported)), exported);
  exported.data.state.banners.rules.entries[0].content = 'changed';
  assert.notEqual(state.banners.rules.entries[0].content, 'changed');
});

test('reject unknown versions, malformed entries, duplicate IDs and kinds', () => {
  const valid = contextExport({}, fixture.state);
  for (const modify of [
    e => { e.version = 2; },
    e => { e.kind = 'unknown'; },
    e => { e.data.state.banners.rules.entries[0].content = 42; },
    e => { e.data.state.banners.rules.entries[0].status = 'trusted'; },
    e => { e.data.state.banners.testing.entries[0].id = 'aa0001'; },
  ]) {
    const changed = JSON.parse(encode(valid));
    modify(changed);
    assert.throws(() => decode(JSON.stringify(changed)));
  }
  assert.throws(() => decode('{bad json'));
});
