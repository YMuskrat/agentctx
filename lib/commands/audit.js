'use strict';
const store = require('../store');
const { c, truncate } = require('../format');

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ts; }
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ts; }
}

function audit(args) {
  const root = store.requireRoot();

  let session = null;
  let entryId = null;
  let detail = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--session=')) { session = args[i].slice(10); }
    else if (args[i] === '--session' && args[i + 1]) { session = args[++i]; }
    else if (args[i] === '--detail') { detail = true; }
    else if (!args[i].startsWith('-') && !entryId) { entryId = args[i]; }
  }

  const history = store.loadHistory(root);

  // Session receipts are the exact ordered record of context served to an agent.
  if (session) {
    const { loadSessions } = require('./session');
    const sessions = loadSessions(root).filter(item => item.actor === 'agent');
    const receipt = session === 'latest'
      ? sessions.at(-1)
      : sessions.find(item => item.id === session || item.id?.endsWith(session) || item.hash?.startsWith(session));
    if (!receipt) {
      console.log(c.gray('\n  No agent sessions recorded yet.\n'));
      return;
    }

    console.log(`\n  ${c.bold('Agent session')} ${c.cyan(receipt.hash?.slice(0, 12) || receipt.id)}\n`);
    console.log(`  ${receipt.description}\n`);
    for (const event of receipt.served || []) {
      console.log(`  ${String(event.sequence).padStart(2, '0')}  ${c.bold(event.command)}  ${c.gray(event.kind || '')}`);
      for (const entry of event.entries || []) {
        console.log(c.gray(`      → [${entry.banner}] ${entry.id} (${entry.mode || 'preview'}) "${truncate(entry.content || '', 60)}"`));
      }
    }
    console.log();
    return;
  }

  // <id> --detail: show context at time of entry
  if (entryId && detail) {
    // Find the event for this entry
    const event = history.find(e => e.entry?.id === entryId || e.entry?.id?.startsWith(entryId));
    if (!event) {
      // Maybe it's in current state
      const state = store.loadState(root);
      const result = store.findEntry(state, entryId);
      if (!result) {
        console.log(c.yellow(`\n  No history found for: ${entryId}\n`));
        return;
      }
    }

    console.log(`\n  ${c.bold('Entry history: ' + entryId)}\n`);
    if (event) {
      console.log(`  Action:  ${event.action}`);
      console.log(`  Author:  ${event.author || 'user'}`);
      console.log(`  Time:    ${event.timestamp}`);
      if (event.entry) {
        console.log(`  Banner:  ${event.entry.banner}`);
        console.log(`  Content: "${truncate(event.entry.content || '', 70)}"`);
      }
    }

    // Show reads near this time
    const ts = event ? new Date(event.timestamp).getTime() : Date.now();
    const window = 10 * 60 * 1000;
    const nearby = history.filter(e => {
      const t = new Date(e.timestamp).getTime();
      return e.action === 'read' && t >= ts - window && t <= ts + window;
    });

    if (nearby.length) {
      const config = store.loadConfig(root);
      const state = store.loadState(root);
      const banners = store.allBanners(config);
      const readBanners = new Set();
      for (const e of nearby) {
        if (e.served) e.served.forEach(s => readBanners.add(s.banner));
      }

      console.log('\n  Context agent had at this time:');
      for (const bn of banners) {
        const hasBanner = state.banners[bn]?.entries?.some(e => e.status !== 'archived');
        if (!hasBanner) continue;
        if (readBanners.has(bn)) {
          console.log(c.green(`    ✓ read ${bn}`));
        } else {
          console.log(c.red(`    ✗ did NOT read ${bn}`));
        }
      }
    }
    console.log();
    return;
  }

  // Default: show recent activity
  const limit = 100;
  const recent = history.slice(-limit);

  console.log(`\n  ${c.bold('Audit log')} ${c.gray('(' + recent.length + ' of ' + history.length + ' events)')}\n`);

  let lastDate = null;
  for (const e of recent) {
    const date = fmtDate(e.timestamp);
    if (date !== lastDate) {
      console.log(c.gray(`  ─── ${date} ───`));
      lastDate = date;
    }
    const time = fmtTime(e.timestamp);
    const action = (e.action || '').padEnd(9);
    const author = (e.author || 'user').padEnd(14);
    const extra = e.entry ? c.gray(` [${e.entry.banner || '?'}] ${truncate(e.entry.content || '', 40)}`) : '';
    console.log(`  ${c.gray(time)}  ${c.cyan(author)}  ${c.bold(action)}  ${e.command || ''}${extra}`);
  }
  console.log();
}

module.exports = { audit };
