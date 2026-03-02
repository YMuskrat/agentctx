'use strict';
// Example consumer: no dependency on Agenctx's terminal formatting.
const fs = require('fs');
const { decode } = require('../lib/export-format');

const envelope = decode(fs.readFileSync(process.argv[2], 'utf8'));
if (envelope.kind === 'context') {
  const entries = Object.values(envelope.data.state.banners).flatMap(b => b.entries);
  console.log(JSON.stringify({ kind: 'context', entries: entries.length,
    statuses: [...new Set(entries.map(e => e.status))].sort() }, null, 2));
} else {
  console.log(JSON.stringify({ kind: 'receipt', hash: envelope.data.hash,
    deliveries: envelope.data.served.length }, null, 2));
}
