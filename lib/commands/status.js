'use strict';
const store = require('../store');
const { c, truncate } = require('../format');

function status() {
  const root = store.requireRoot();
  const { loadSessions, loadActiveSessions } = require('./session');
  const sessions = loadSessions(root)
    .filter(session => session.hash && session.actor === 'agent')
    .reverse()
    .slice(0, 20);
  const active = loadActiveSessions(root).filter(session => session.actor === 'agent');

  console.log(`\n  ${c.bold('AGENT ACTIVITY')}  ${c.gray('newest first')}\n`);
  console.log(c.gray('  Hash          Task'));
  console.log(c.gray('  ────────────  ────────────────────────────────────────────────────────────'));

  for (const session of [...active].reverse()) {
    console.log(`  ${c.green(('LIVE ' + session.id).padEnd(12))}  ${truncate(session.description, 60)}`);
  }

  for (const session of sessions) {
    console.log(`  ${c.cyan(session.hash.slice(0, 12))}  ${truncate(session.description || '', 60)}`);
  }

  if (!sessions.length && !active.length) {
    console.log(c.gray('  No tracked agent activity yet.'));
    console.log(c.gray('\n  Agents start with: agenctx --agent start "task"'));
  }

  console.log();
}

module.exports = { status };
