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

  console.log(`\n  ${c.bold(state.project.name)} — context health\n`);
  console.log(`  📌 Pinned   ${pinned}`);
  console.log(`  ✅ Active   ${active}`);
  console.log(`  💤 Ambient  ${ambient}  ${c.gray('(hidden from agents)')}`);
  console.log(`  📦 Archived ${archivedCount}`);

  if (decayed.length) {
    console.log(c.yellow(`\n  ⚠  ${decayed.length} entries decayed to ambient this run:`));
    for (const e of decayed) {
      console.log(c.yellow(`    [${e.id}] [${e.banner}] "${truncate(e.content, 50)}" — ${e.reason}`));
    }
    console.log(c.gray('\n  Run: agenctx restore <id>   to keep active'));
    console.log(c.gray('  Run: agenctx view --ambient  to browse ambient entries'));
  }

  if (archived.length) {
    console.log(c.gray(`\n  📦 ${archived.length} entries auto-archived:`));
    for (const e of archived) {
      console.log(c.gray(`    [${e.id}] [${e.banner}] "${truncate(e.content, 50)}" — ${e.reason}`));
    }
    console.log(c.gray('  Run: agenctx restore <id>   to bring back'));
  }

  if (!decayed.length && !archived.length) {
    console.log(c.green('\n  ✓ Context is healthy'));
  }

  const { loadSessions, loadActiveSession } = require('./session');
  const sessions = loadSessions(root).filter(session => session.hash && session.actor === 'agent').reverse().slice(0, 10);
  const activeSession = loadActiveSession(root);
  console.log(`\n  ${c.bold('Agent sessions')} ${c.gray('(latest to oldest)')}`);
  if (activeSession?.actor === 'agent') {
    console.log(`  ${c.green('●')} ${c.bold(activeSession.id)}  active  ${(activeSession.served || []).length} served  ${truncate(activeSession.description, 45)}`);
  }
  if (!sessions.length && activeSession?.actor !== 'agent') {
    console.log(c.gray('  No agent session receipts yet.'));
  }
  for (const session of sessions) {
    console.log(`  ${c.cyan(session.hash.slice(0, 12))}  ${String((session.served || []).length).padStart(3)} served  ${truncate(session.description, 45)}`);
  }
  if (sessions.length) console.log(c.gray('  Inspect: agenctx session show <hash>'));

  console.log();
}

module.exports = { status };
