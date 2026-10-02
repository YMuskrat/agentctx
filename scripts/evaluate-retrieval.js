'use strict';
const fs = require('fs');
const path = require('path');
const { collectEntries, filterEntries } = require('../lib/commands/search');

function evaluate(fixture) {
  if (fixture.version !== 1 || !Array.isArray(fixture.cases) || !fixture.cases.length) {
    throw new Error('Expected version 1 with nonempty retrieval cases.');
  }
  const cases = fixture.cases.map(example => {
    const actual = filterEntries(collectEntries(fixture.state, example), {
      ...example, since: example.since ? new Date(example.since) : null,
    }).map(({ entry }) => entry.id);
    const expected = new Set(example.expected);
    const hits = actual.filter(id => expected.has(id)).length;
    return {
      name: example.name, expected: [...expected], actual,
      precision: actual.length ? hits / actual.length : (expected.size ? 0 : 1),
      recall: expected.size ? hits / expected.size : 1,
      exact: JSON.stringify(actual) === JSON.stringify(example.expected),
    };
  });
  return {
    version: 1, evidence: 'synthetic retrieval mechanics; not agent task performance',
    cases, exact_match_rate: cases.filter(c => c.exact).length / cases.length,
    macro_precision: cases.reduce((sum, c) => sum + c.precision, 0) / cases.length,
    macro_recall: cases.reduce((sum, c) => sum + c.recall, 0) / cases.length,
  };
}

if (require.main === module) {
  try {
    const file = process.argv[2] || path.join(__dirname, '../test/fixtures/retrieval.json');
    const report = evaluate(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(JSON.stringify(report, null, 2));
    if (report.exact_match_rate !== 1) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { evaluate };
