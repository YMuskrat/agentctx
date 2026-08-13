'use strict';
const store = require('../store');
const { c, truncate } = require('../format');

function status() {
  const root = store.requireRoot();
  const { loadSessions, loadActiveSession } = require('./session');
  const sessions = loadSessions(root)
    .filter(session => session.hash && session.actor === 'agent')
    .reverse()
    .slice(0, 20);
  const active = loadActiveSession(root);

  console.log(`\n  ${c.bold('AGENT ACTIVITY')}  ${c.gray('newest first')}\n`);
  console.log(c.gray('  Hash          Task'));
  console.log(c.gray('  ────────────  ────────────────────────────────────────────────────────────'));

  if (active?.actor === 'agent') {
    console.log(`  ${c.green('LIVE'.padEnd(12))}  ${truncate(active.description, 60)}`);
  }

  for (const session of sessions) {
    console.log(`  ${c.cyan(session.hash.slice(0, 12))}  ${truncate(session.description || '', 60)}`);
  }

  if (!sessions.length && active?.actor !== 'agent') {
    console.log(c.gray('  No tracked agent activity yet.'));
    console.log(c.gray('\n  Agents start with: agenctx --agent start "task"'));
  } else {
    console.log(`\n  ${c.cyan('Next')}  agenctx session show <hash>`);
  }

  console.log();
}

module.exports = { status };
