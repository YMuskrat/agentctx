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

  console.log(`\n  ${bannerIcon(bannerName)}${c.bold(bannerName)}  ${c.gray(entries.length + ' entries')}\n`);

  if (entries.length === 0) {
    console.log(c.gray(`  No entries yet. Add with: agenctx add ${bannerName} "message"\n`));
    return;
  }

  if (pinnedEntries.length) {
    console.log(c.cyan('  📌 Pinned'));
    for (const e of pinnedEntries) {
      const reads = e.read_count > 0 ? c.gray(`  read ${e.read_count}×`) : c.gray('  never read');
      console.log(`     ${c.gray(e.id)}  ${truncate(e.content, 65)}${reads}`);
    }
    console.log();
  }

  for (const e of activeEntries) {
    const age = daysSince(e.created);
    const ageStr = age != null ? c.gray(`  ${age}d ago`) : '';
    const reads = e.read_count > 0 ? c.gray(`  read ${e.read_count}×`) : c.gray('  never read');
    console.log(`     ${c.gray(e.id)}  ${truncate(e.content, 65)}${reads}${ageStr}`);
  }

  if (showAmbient && ambientEntries.length) {
    console.log(c.gray('\n  💤 Ambient'));
    for (const e of ambientEntries) {
      console.log(c.gray(`     ${e.id}  ${truncate(e.content, 65)}`));
    }
  }

  console.log();
  console.log(c.gray(`  Read an entry in full: agenctx view <id>`));
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

  console.log(`\n  ${c.bold(name)}${description ? c.gray(' · ' + description) : ''}`);
  if (stack?.length) console.log(c.gray('  Stack: ' + stack.join(', ')));
  console.log();

  const allPinned = [];
  for (const [bn, b] of Object.entries(state.banners)) {
    for (const e of b.entries) {
      if (e.status === 'pinned') allPinned.push({ ...e, _banner: bn });
    }
  }

  if (allPinned.length) {
    console.log(c.cyan(`  📌 Pinned (${allPinned.length})`));
    for (const e of allPinned) {
      console.log(`     ${c.gray(e.id)}  ${c.cyan(e._banner + ':')} ${truncate(e.content, 58)}`);
    }
    console.log();
  }

  let totalActive = 0, totalAmbient = 0, totalArchived = 0;
  const bannerCounts = {};
  for (const [bn, b] of Object.entries(state.banners)) {
    const n = b.entries.filter(e => e.status === 'active' || e.status === 'pinned').length;
    bannerCounts[bn] = n;
    totalActive += b.entries.filter(e => e.status === 'active').length;
    totalAmbient += b.entries.filter(e => e.status === 'ambient').length;
    totalArchived += b.entries.filter(e => e.status === 'archived').length;
  }

  if (totalActive > 0 || allPinned.length > 0) {
    console.log(c.bold(`  Active (${totalActive} entries)`));
    console.log();
    const activeBanners = banners.filter(bn => bannerCounts[bn] > 0);
    const cols = activeBanners.map(bn => `${bannerIcon(bn)}${c.bold(bn)} ${c.gray('(' + bannerCounts[bn] + ')')}`);
    for (let i = 0; i < cols.length; i += 3) {
      console.log('  ' + cols.slice(i, i + 3).join('   '));
    }
  } else {
    console.log(c.gray('  No active entries yet.'));
    console.log(c.gray('  Run: agenctx add <banner> "message"'));
  }

  if (totalAmbient > 0) console.log(c.gray(`\n  💤 Ambient: ${totalAmbient}`));
  if (totalArchived > 0) console.log(c.gray(`  📦 Archived: ${totalArchived}`));
  if (decayed.length) console.log(c.yellow(`\n  ⚠  ${decayed.length} entries decayed to ambient — run: agenctx status`));

  console.log();
  console.log(c.gray('  Drill in:      agenctx view <banner>'));
  console.log(c.gray('  Read an entry: agenctx view <id>'));
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
