'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/retrieval.json');
const { collectEntries, filterEntries } = require('../lib/commands/search');
const { findEntry } = require('../lib/store');

for (const example of fixture.cases) {
  test(`retrieval: ${example.name}`, () => {
    const before = JSON.stringify(fixture.state);
    const entries = collectEntries(fixture.state, example);
    const actual = filterEntries(entries, {
      ...example, since: example.since ? new Date(example.since) : null,
    }).map(({ entry }) => entry.id);
    assert.deepEqual(actual, example.expected);
    assert.equal(JSON.stringify(fixture.state), before);
  });
}
test('exact ID lookup preserves full multiline content', () => {
  assert.equal(findEntry(fixture.state, 'aa0001').entry.content,
    'Authentication uses JWT.\nValidate audience and issuer.');
  assert.equal(findEntry(fixture.state, 'ffffff'), null);
});
