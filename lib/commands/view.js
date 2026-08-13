'use strict';
const crypto = require('crypto');
const store = require('../store');
const { runDecay } = require('../decay');
const { c, bannerIcon, truncate } = require('../format');
const { recordServed } = require('./session');

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

function entrySnapshot(entry, banner, mode, limit) {
  return {
    id: entry.id,
    banner,
    mode,
    status: entry.status,
    content: mode === 'full' ? entry.content : truncate(entry.content, limit),
    content_hash: crypto.createHash('sha256').update(entry.content).digest('hex'),
  };
}

function printEntryRow(entry, { showAge = false } = {}) {
  const status = entry.status === 'pinned'
    ? c.yellow('PINNED ')
    : c.gray('ACTIVE ');
  const reads = entry.read_count > 0
    ? c.gray(`${entry.read_count} read${entry.read_count === 1 ? '' : 's'}`)
    : c.gray('unread');
  const age = showAge ? daysSince(entry.created) : null;
  const ageText = age != null ? c.gray(` · ${age}d old`) : '';
  console.log(`  ${status}${c.gray('[' + entry.id + ']')}  ${truncate(entry.content, 62)}`);
  console.log(`          ${reads}${ageText}`);
}

// ── View a single entry by ID ────────────────────────────────────────────────

function viewEntry(root, state, id, agent) {
  const result = store.findEntry(state, id);
  if (!result) {
    console.error(c.red(`Entry not found: ${id}`));
    process.exit(1);
  }

  const { entry, bannerName } = result;

  // This is the real read — increment count
  const now = new Date().toISOString();
  entry.last_read = now;
  entry.read_count = (entry.read_count || 0) + 1;
  store.saveState(root, state);

  const status = entry.status === 'pinned' ? c.yellow('PINNED') : c.gray(entry.status.toUpperCase());
  console.log(`\n  ${bannerIcon(bannerName)}${c.bold(bannerName)}  ${c.gray('[' + entry.id + ']')}  ${status}`);
  console.log(c.gray('  ' + store.bannerDescription(store.loadConfig(root), bannerName)));
  console.log(`\n  ${entry.content}\n`);
  console.log(c.gray(`  ${entry.author} · created ${entry.created.slice(0, 10)} · served ${entry.read_count} time${entry.read_count === 1 ? '' : 's'}`));
  console.log(c.gray(`  Actions: agenctx edit ${entry.id}  ·  agenctx ${entry.status === 'pinned' ? 'unpin' : 'pin'} ${entry.id}`));
  console.log();

  recordServed(root, {
    command: `view ${id}`,
    kind: 'entry',
    entries: [entrySnapshot(entry, bannerName, 'full')],
  }, { agent });
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
  console.log(`  ${store.bannerDescription(config, bannerName)}`);
  console.log(c.gray(`  ${entries.length} visible · ${pinnedEntries.length} pinned`));
  console.log();

  if (entries.length === 0) {
    const message = about ? 'No matching entries.' : 'No visible entries yet.';
    console.log(c.gray(`  ${message}`));
    console.log(`\n  ${c.cyan('Next')}  agenctx add ${bannerName} "message"`);
    console.log(c.gray('        agenctx view  ·  back to all context types\n'));
    recordServed(root, {
      command: `view ${bannerName}${about ? ` --about="${about}"` : ''}${showAmbient ? ' --ambient' : ''}`,
      kind: 'banner',
      type: { name: bannerName, description: store.bannerDescription(config, bannerName) },
      entries: [],
    }, { agent });
    return;
  }

  if (pinnedEntries.length) {
    console.log(c.yellow(`  IMPORTANT · PINNED (${pinnedEntries.length})`));
    for (const e of pinnedEntries) {
      printEntryRow(e);
    }
    console.log();
  }

  if (activeEntries.length) {
    console.log(c.bold(`  OTHER CONTEXT (${activeEntries.length})`));
    for (const e of activeEntries) {
      printEntryRow(e, { showAge: true });
    }
    console.log();
  }

  if (showAmbient && ambientEntries.length) {
    console.log(c.gray(`  AMBIENT (${ambientEntries.length})`));
    for (const e of ambientEntries) {
      console.log(c.gray(`     ${e.id}  ${truncate(e.content, 65)}`));
    }
    console.log();
  }

  console.log(`  ${c.cyan('Next')}  agenctx view <id>  ·  read an entry in full`);
  console.log(c.gray(`        agenctx search "keyword" --banner=${bannerName}`));
  console.log(c.gray('        agenctx view  ·  back to all context types'));
  console.log();

  recordServed(root, {
    command: `view ${bannerName}${about ? ` --about="${about}"` : ''}${showAmbient ? ' --ambient' : ''}`,
    kind: 'banner',
    type: { name: bannerName, description: store.bannerDescription(config, bannerName) },
    entries: entries.map(entry => entrySnapshot(entry, bannerName, 'preview', 65)),
  }, { agent });
}

// ── Top-level overview ───────────────────────────────────────────────────────

function viewOverview(root, state, config, decayed, agent) {
  const banners = store.allBanners(config);
  const { name, description, stack } = state.project;

  console.log(`\n  ${c.bold(name)}${description ? c.gray(' — ' + description) : ''}`);
  if (stack?.length) console.log(c.gray('  ' + stack.join(' · ')));
  console.log();

  const allPinned = [];
  for (const [bn, b] of Object.entries(state.banners)) {
    for (const e of b.entries) {
      if (e.status === 'pinned') allPinned.push({ ...e, _banner: bn });
    }
  }

  console.log(allPinned.length
    ? c.yellow(`  IMPORTANT · PINNED (${allPinned.length})`)
    : c.gray('  PINNED CONTEXT (0)'));
  if (allPinned.length) {
    for (const e of allPinned) {
      console.log(`  ${c.gray('[' + e.id + ']')}  ${c.cyan(e._banner)}  ${truncate(e.content, 62)}`);
    }
  } else {
    console.log(c.gray('  Nothing pinned. Use: agenctx pin <id>'));
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

  console.log(c.bold(`  CONTEXT TYPES · ${totalVisible} visible ${entryWord(totalVisible)}`));
  console.log(c.gray('  Type             Items  Pins  Purpose'));
  console.log(c.gray('  ───────────────  ─────  ────  ───────────────────────────────────────────'));
  const orderedBanners = [...banners].sort((a, b) => {
    const aStats = bannerStats[a];
    const bStats = bannerStats[b];
    return (bStats.pinned - aStats.pinned) || (bStats.visible - aStats.visible) || (banners.indexOf(a) - banners.indexOf(b));
  });
  for (const bannerName of orderedBanners) {
    const { visible, pinned } = bannerStats[bannerName];
    const label = bannerName.padEnd(15);
    const count = String(visible).padStart(5);
    const pinnedCount = String(pinned).padStart(4);
    const prefix = visible > 0 ? c.bold(label) : c.gray(label);
    const purpose = truncate(store.bannerDescription(config, bannerName), 45);
    console.log(`  ${prefix}  ${count}  ${pinnedCount}  ${visible > 0 ? purpose : c.gray(purpose)}`);
  }

  if (totalAmbient > 0) console.log(c.gray(`\n  💤 Ambient: ${totalAmbient}`));
  if (totalArchived > 0) console.log(c.gray(`  📦 Archived: ${totalArchived}`));
  if (decayed.length) console.log(c.yellow(`\n  ⚠  ${decayed.length} entries decayed to ambient — run: agenctx status`));

  console.log(`\n  ${c.cyan('Next')}  agenctx view <type>  ·  inspect one context type`);
  if (allPinned.length) console.log(c.gray(`        agenctx view ${allPinned[0].id}  ·  read the first pinned item in full`));
  const recommendedBanner = orderedBanners.find(bannerName => bannerStats[bannerName].visible > 0);
  if (recommendedBanner) console.log(c.gray(`        agenctx view ${recommendedBanner}  ·  open the highest-priority populated type`));
  console.log(c.gray('        agenctx search "keyword"  ·  search all context'));
  console.log();

  recordServed(root, {
    command: 'view',
    kind: 'overview',
    project: { name, description, stack: stack || [] },
    entries: allPinned.map(entry => entrySnapshot(entry, entry._banner, 'preview', 58)),
    types: banners.map(bannerName => ({
      name: bannerName,
      description: store.bannerDescription(config, bannerName),
      ...bannerStats[bannerName],
    })),
  }, { agent });
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
    viewOverview(root, state, config, decayed, agent);
  } else if (isId(target, banners)) {
    viewEntry(root, state, target, agent);
  } else {
    viewBanner(state, config, target, { agent, about, showAmbient });
  }
}

module.exports = { view };
