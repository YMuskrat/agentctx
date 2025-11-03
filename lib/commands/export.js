'use strict';
const fs = require('fs');
const store = require('../store');
const { contextExport, encode, decode } = require('../export-format');

function exportCommand(args) {
  if (args[0] === 'validate' && args.length === 2) {
    const envelope = decode(fs.readFileSync(args[1], 'utf8'));
    console.log(JSON.stringify({ valid: true, version: envelope.version, kind: envelope.kind }));
    return;
  }
  if (args.length !== 1 || args[0] !== 'context') {
    throw new Error('Usage: agenctx export context | agenctx export validate <file>');
  }
  const root = store.requireRoot();
  process.stdout.write(encode(contextExport(store.loadConfig(root), store.loadState(root))));
}

module.exports = { exportCommand };
