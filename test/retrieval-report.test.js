'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/retrieval.json');
const { evaluate } = require('../scripts/evaluate-retrieval');

test('retrieval report is deterministic and counts missed expectations', () => {
  assert.deepEqual(evaluate(fixture), evaluate(fixture));
  assert.equal(evaluate(fixture).exact_match_rate, 1);
  const changed = JSON.parse(JSON.stringify(fixture));
  changed.cases[0].expected.push('missing');
  const report = evaluate(changed);
  assert.ok(report.exact_match_rate < 1);
  assert.equal(report.cases[0].recall, 2 / 3);
  assert.throws(() => evaluate({ version: 2, cases: [] }), /version 1/);
});
