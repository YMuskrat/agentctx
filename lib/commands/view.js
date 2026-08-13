'use strict';
const store = require('../store');
const { runDecay } = require('../decay');
const { c, bannerIcon, truncate } = require('../format');
const { attachRead } = require('./session');

function matchesQuery(entry, query) {
  if (!query) return true;
  return entry.content.toLowerCase().includes(query.toLowerCase());
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function isId(str, banners) {
  return !banners.includes(str) && /^[0-9a-f]{4,6}$/i.test(str);
}

function entryWord(count) {
  return count === 1 ? 'entry' : 'entries';
}

function printEntryRow(entry, { showAge = false } = {}) {
  const reads = entry.read_count > 0
    ? c.gray(`  read ${entry.read_count}×`)
    : c.gray('  never read');
  const age = showAge ? daysSince(entry.created) : null;
  const ageText = age != null ? c.gray(`  ${age}d ago`) : '';
  console.log(`     ${c.gray(entry.id)}  ${truncate(entry.content, 65)}${reads}${ageText}`);
}

// ── View a single entry by ID ────────────────────────────────────────────────

function viewEntry(root, state, id, agent) {
  const result = store.findEntry(state, id);
  if (!result) {
    console.error(c.red(`Entry not found: ${id}`));
    process.exit(1);
  }

  const { entry, bannerName } = result;

  console.log(`\n  ${bannerIcon(bannerName)}${c.bold(bannerName)}  ${c.gray('[' + entry.id + ']')}  ${entry.status === 'pinned' ? '📌' : ''}\n`);
  console.log(entry.content);
  console.log();
  console.log(c.gray(`  author: ${entry.author}  ·  created: ${entry.created.slice(0, 10)}  ·  read ${entry.read_count || 0}×`));
  console.log();

  // This is the real read — increment count
  const now = new Date().toISOString();
  entry.last_read = now;
  entry.read_count = (entry.read_count || 0) + 1;
  store.saveState(root, state);

  // Attach to active session if agent read
  if (agent) attachRead(root, entry.id, bannerName, entry.content);

  if (agent) {
    store.appendHistory(root, {
      action: 'read',
      author: 'agent',
      command: `view ${id}`,
      served: [{ id: entry.id, banner: bannerName, content: truncate(entry.content, 50) }],
    });
  }
}

// ── View a banner (listing only — no read count update) ──────────────────────

function viewBanner(state, config, bannerName, { agent, about, showAmbient }) {
  const root = store.findRoot();
  if (!state.banners[bannerName]) {
    console.error(c.red(`Unknown banner: ${bannerName}`));
    console.error(`Available: ${store.allBanners(config).join(', ')}`);
    process.exit(1);
  }

  let entries = state.banners[bannerName].entries.filter(e => e.status !== 'archived');
  if (!showAmbient) entries = entries.filter(e => e.status !== 'ambient');
  if (about) entries = entries.filter(e => matchesQuery(e, about));

  const pinnedEntries = entries.filter(e => e.status === 'pinned');
  const activeEntries = entries.filter(e => e.status === 'active');
  const ambientEntries = entries.filter(e => e.status === 'ambient');

  console.log(`\n  ${bannerIcon(bannerName)}${c.bold(bannerName)}`);
  console.log(c.gray(`  ${entries.length} visible ${entryWord(entries.length)}`));
  console.log();

  if (entries.length === 0) {
    const message = about ? 'No matching entries.' : 'No visible entries yet.';
    console.log(c.gray(`  ${message}`));
    console.log(c.gray(`  Add one: agenctx add ${bannerName} "message"\n`));
    return;
  }

  console.log(c.cyan(`  📌 Pinned (${pinnedEntries.length})`));
  if (pinnedEntries.length) {
    for (const e of pinnedEntries) {
      printEntryRow(e);
    }
  } else {
    console.log(c.gray('     No pinned entries.'));
  }
  console.log();

  console.log(c.bold(`  Other entries (${activeEntries.length})`));
  for (const e of activeEntries) {
    printEntryRow(e, { showAge: true });
  }
  if (!activeEntries.length) console.log(c.gray('     No other active entries.'));

  if (showAmbient && ambientEntries.length) {
    console.log(c.gray(`\n  💤 Ambient (${ambientEntries.length})`));
    for (const e of ambientEntries) {
      console.log(c.gray(`     ${e.id}  ${truncate(e.content, 65)}`));
    }
  }

  console.log();
  console.log(c.gray('  Read an entry in full: agenctx view <id>'));
  console.log(c.gray('  Back to all types:      agenctx view'));
  console.log();

  // Log banner browse to history if --agent (but don't touch read counts)
  if (agent) {
    store.appendHistory(root, {
      action: 'browse',
      author: 'agent',
      command: `view ${bannerName}`,
      banner: bannerName,
      entries: entries.map(e => e.id),
    });
  }
}

// ── Top-level overview ───────────────────────────────────────────────────────

function viewOverview(state, config, decayed) {
  const banners = store.allBanners(config);
  const { name, description, stack } = state.project;

  console.log(`\n  ${c.bold(name)}`);
  if (description) console.log(`  ${description}`);
  if (stack?.length) console.log(c.gray('  Stack: ' + stack.join(', ')));
  console.log();

  const allPinned = [];
  for (const [bn, b] of Object.entries(state.banners)) {
    for (const e of b.entries) {
      if (e.status === 'pinned') allPinned.push({ ...e, _banner: bn });
    }
  }

  console.log(c.cyan(`  📌 Pinned context (${allPinned.length})`));
  console.log(c.gray('     Always shown to agents'));
  if (allPinned.length) {
    for (const e of allPinned) {
      console.log(`     ${c.gray(e.id)}  ${c.cyan(e._banner + ':')} ${truncate(e.content, 58)}`);
    }
  } else {
    console.log(c.gray('     Nothing pinned yet. Pin with: agenctx pin <id>'));
  }
  console.log();

  let totalVisible = 0, totalAmbient = 0, totalArchived = 0;
  const bannerStats = {};
  for (const bannerName of banners) {
    const entries = state.banners[bannerName]?.entries || [];
    const pinned = entries.filter(e => e.status === 'pinned').length;
    const active = entries.filter(e => e.status === 'active').length;
    const ambient = entries.filter(e => e.status === 'ambient').length;
    const archived = entries.filter(e => e.status === 'archived').length;
    bannerStats[bannerName] = { visible: pinned + active, pinned };
    totalVisible += pinned + active;
    totalAmbient += ambient;
    totalArchived += archived;
  }

  console.log(c.bold(`  Context types (${totalVisible} visible ${entryWord(totalVisible)})`));
  console.log(c.gray('  Type             Entries   Pinned   Open'));
  console.log(c.gray('  ───────────────  ───────   ──────   ───────────────────────'));
  for (const bannerName of banners) {
    const { visible, pinned } = bannerStats[bannerName];
    const label = bannerName.padEnd(15);
    const count = String(visible).padStart(7);
    const pinnedCount = String(pinned).padStart(6);
    const prefix = visible > 0 ? c.bold(label) : c.gray(label);
    console.log(`  ${prefix}  ${count}   ${pinnedCount}   ${c.cyan(`agenctx view ${bannerName}`)}`);
  }

  if (totalAmbient > 0) console.log(c.gray(`\n  💤 Ambient: ${totalAmbient}`));
  if (totalArchived > 0) console.log(c.gray(`  📦 Archived: ${totalArchived}`));
  if (decayed.length) console.log(c.yellow(`\n  ⚠  ${decayed.length} entries decayed to ambient — run: agenctx status`));

  console.log();
  console.log(c.gray('  Choose a type: agenctx view <type>'));
  console.log(c.gray('  Read one item: agenctx view <id>'));
  console.log(c.gray('  Add context:   agenctx add <type> "message"'));
  console.log();
}

// ── Entry point ──────────────────────────────────────────────────────────────

function view(args) {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  const state = store.loadState(root);

  const { decayed, archived } = runDecay(state, config);
  if (decayed.length || archived.length) store.saveState(root, state);

  let target = null;
  let agent = false;
  let about = null;
  let showAmbient = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent') { agent = true; }
    else if (args[i] === '--ambient') { showAmbient = true; }
    else if (args[i].startsWith('--about=')) { about = args[i].slice(8); }
    else if (args[i] === '--about' && args[i + 1]) { about = args[++i]; }
    else if (!args[i].startsWith('-')) { target = args[i]; }
  }

  const banners = store.allBanners(config);

  if (!target) {
    viewOverview(state, config, decayed);
  } else if (isId(target, banners)) {
    viewEntry(root, state, target, agent);
  } else {
    viewBanner(state, config, target, { agent, about, showAmbient });
  }
}

module.exports = { view };
