'use strict';
const store = require('../store');
const { runDecay } = require('../decay');
const { c, truncate } = require('../format');

function status(args) {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  const state = store.loadState(root);

  const { decayed, archived } = runDecay(state, config);
  if (decayed.length || archived.length) store.saveState(root, state);

  let pinned = 0, active = 0, ambient = 0, archivedCount = 0;
  for (const b of Object.values(state.banners)) {
    for (const e of b.entries) {
      if (e.status === 'pinned') pinned++;
      else if (e.status === 'active') active++;
      else if (e.status === 'ambient') ambient++;
      else if (e.status === 'archived') archivedCount++;
    }
  }

  console.log(`\n  ${c.bold(state.project.name)}  ${c.gray('context status')}\n`);
  console.log(c.bold('  CONTEXT HEALTH'));
  console.log(`  ${c.yellow(String(pinned).padStart(3))} pinned  ·  ${c.green(String(active).padStart(3))} active  ·  ${String(ambient).padStart(3)} ambient  ·  ${String(archivedCount).padStart(3)} archived`);

  if (decayed.length) {
    console.log(c.yellow(`\n  NEEDS ATTENTION · ${decayed.length} moved to ambient`));
    for (const e of decayed) {
      console.log(c.yellow(`    [${e.id}] [${e.banner}] "${truncate(e.content, 50)}" — ${e.reason}`));
    }
    console.log(c.gray('\n  Review: agenctx view --ambient  ·  keep: agenctx restore <id>'));
  }

  if (archived.length) {
    console.log(c.gray(`\n  ARCHIVED THIS RUN · ${archived.length}`));
    for (const e of archived) {
      console.log(c.gray(`    [${e.id}] [${e.banner}] "${truncate(e.content, 50)}" — ${e.reason}`));
    }
    console.log(c.gray('  Restore: agenctx restore <id>'));
  }

  if (!decayed.length && !archived.length) {
    console.log(c.green('  ✓ Ready for agents'));
  }

  const { loadSessions, loadActiveSession } = require('./session');
  const sessions = loadSessions(root).filter(session => session.hash && session.actor === 'agent').reverse().slice(0, 10);
  const activeSession = loadActiveSession(root);
  console.log(`\n  ${c.bold('AGENT ACTIVITY')}`);
  if (activeSession?.actor === 'agent') {
    console.log(`  ${c.green('● LIVE')}  ${c.bold(activeSession.id)}  ${(activeSession.served || []).length} served`);
    console.log(`          ${truncate(activeSession.description, 60)}`);
  }
  if (!sessions.length && activeSession?.actor !== 'agent') {
    console.log(c.gray('  No tracked agent interactions yet.'));
  }
  for (const session of sessions) {
    console.log(`  ${c.cyan(session.hash.slice(0, 12))}  ${String((session.served || []).length).padStart(3)} served  ${truncate(session.description, 52)}`);
  }
  if (sessions.length) console.log(`\n  ${c.cyan('Next')}  agenctx session show <hash>  ·  inspect a receipt`);

  console.log();
}

module.exports = { status };
