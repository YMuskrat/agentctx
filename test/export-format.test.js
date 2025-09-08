'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { contextExport, encode, decode } = require('../lib/export-format');
const fixture = require('./fixtures/retrieval.json');

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
