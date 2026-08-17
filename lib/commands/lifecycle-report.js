'use strict';

const store = require('../store');
const {
  activeAnchor,
  activeRetentionDays,
  applyLifecycle,
  daysBetween,
  resolveDecayConfig,
} = require('../decay');
const { c, truncate } = require('../format');

function collectEntries(state) {
  const entries = [];
  for (const [banner, value] of Object.entries(state.banners)) {
    for (const entry of value.entries || []) entries.push({ entry, banner });
  }
  return entries;
}

function countByStatus(entries) {
  const counts = { pinned: 0, active: 0, ambient: 0, archived: 0 };
  for (const { entry } of entries) {
    if (Object.hasOwn(counts, entry.status)) counts[entry.status]++;
  }
  return counts;
}

function formatDays(value) {
  if (!Number.isFinite(value)) return 'unknown';
  if (value <= 0) return 'due now';
  const days = Math.ceil(value);
  return `${days}d`;
}

function printEntry(item, detail) {
  console.log(`  ${c.gray('[' + item.entry.id + ']')}  ${c.cyan(item.banner.padEnd(11))} ${truncate(item.entry.content, 52)}`);
  console.log(c.gray(`            ${detail}`));
}

function limited(items, showAll, maximum = 20) {
  return showAll ? items : items.slice(0, maximum);
}

function lifecycleReport(args) {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  const state = store.loadState(root);
  const showAll = args.includes('--all');
  const now = new Date();
  const cfg = resolveDecayConfig(config);

  const applied = applyLifecycle(root, state, config, { now });
  const all = collectEntries(state);
  const counts = countByStatus(all);

  console.log(`\n  ${c.bold('CONTEXT LIFECYCLE')}`);
  console.log(c.gray('  active -> ambient -> archived'));
  console.log(c.gray('  pinned entries are protected; archived entries are retained and restorable.'));

  console.log(`\n  ${c.bold('POLICY')}`);
  console.log(`  Active base retention       ${cfg.activeToAmbientDays}d without a full read`);
  console.log(`  Read retention bonus       +${cfg.readExtensionDays}d per full read, capped at +${cfg.maxReadExtensionDays}d`);
  console.log(`  Ambient review window      ${cfg.ambientToArchivedDays}d before archive`);
  console.log('  Reactivation               a full ambient read returns it to active');
  console.log('  Permanent protection       pin the entry');

  console.log(`\n  ${c.bold('CURRENT STATE')}`);
  console.log(c.gray('  State       Count  Meaning'));
  console.log(c.gray('  ----------  -----  ------------------------------------------------'));
  console.log(`  ${c.yellow('pinned'.padEnd(10))}  ${String(counts.pinned).padStart(5)}  always visible until unpinned`);
  console.log(`  ${'active'.padEnd(10)}  ${String(counts.active).padStart(5)}  visible to agents`);
  console.log(`  ${c.gray('ambient'.padEnd(10))}  ${String(counts.ambient).padStart(5)}  hidden by default and awaiting review`);
  console.log(`  ${c.gray('archived'.padEnd(10))}  ${String(counts.archived).padStart(5)}  retained but never served to agents`);

  if (applied.decayed.length || applied.archived.length) {
    console.log(`\n  ${c.bold('APPLIED NOW')}`);
    for (const item of applied.decayed) {
      printEntry({ entry: item, banner: item.banner }, `active -> ambient; ${item.reason}`);
    }
    for (const item of applied.archived) {
      printEntry({ entry: item, banner: item.banner }, `ambient -> archived; ${item.reason}`);
    }
  }

  const ambient = all
    .filter(item => item.entry.status === 'ambient')
    .map(item => ({ ...item, age: daysBetween(item.entry.decayed_at, now) }))
    .sort((a, b) => b.age - a.age);

  if (ambient.length) {
    console.log(`\n  ${c.bold(`AMBIENT REVIEW (${ambient.length})`)}`);
    for (const item of limited(ambient, showAll)) {
      const remaining = cfg.ambientToArchivedDays - item.age;
      printEntry(item, `ambient ${Math.floor(item.age)}d; archives in ${formatDays(remaining)}`);
    }
    if (!showAll && ambient.length > 20) console.log(c.gray(`  Showing 20 of ${ambient.length}; use --all for every entry.`));
  }

  const archived = all
    .filter(item => item.entry.status === 'archived')
    .map(item => ({ ...item, age: daysBetween(item.entry.archived_at, now) }))
    .sort((a, b) => b.age - a.age);

  if (archived.length) {
    console.log(`\n  ${c.bold(`ARCHIVE (${archived.length})`)}`);
    for (const item of limited(archived, showAll)) {
      printEntry(item, `archived ${Math.floor(item.age)}d ago; restore with agenctx restore ${item.entry.id}`);
    }
    if (!showAll && archived.length > 20) console.log(c.gray(`  Showing 20 of ${archived.length}; use --all for every entry.`));
  }

  const active = all
    .filter(item => item.entry.status === 'active')
    .map(item => {
      const retention = activeRetentionDays(item.entry, config);
      const inactive = daysBetween(activeAnchor(item.entry), now);
      return { ...item, retention, inactive, remaining: retention - inactive };
    })
    .sort((a, b) => a.remaining - b.remaining);

  if (active.length) {
    console.log(`\n  ${c.bold(`ACTIVE RETENTION (${active.length})`)}`);
    for (const item of limited(active, showAll, 10)) {
      printEntry(
        item,
        `${item.entry.read_count || 0} full reads; inactive ${Math.floor(item.inactive)}d; ambient in ${formatDays(item.remaining)}`,
      );
    }
    if (!showAll && active.length > 10) console.log(c.gray(`  Showing the next 10 of ${active.length}; use --all for every active entry.`));
  }

  if (showAll) {
    const pinned = all.filter(item => item.entry.status === 'pinned');
    if (pinned.length) {
      console.log(`\n  ${c.bold(`PINNED (${pinned.length})`)}`);
      for (const item of pinned) printEntry(item, 'protected from automatic lifecycle transitions');
    }
  }

  const transitionActions = new Set(['decay', 'auto_archive', 'archive', 'restore', 'reactivate', 'pin', 'unpin']);
  const recent = store.loadHistory(root)
    .filter(event => transitionActions.has(event.action))
    .slice(-10)
    .reverse();

  if (recent.length) {
    console.log(`\n  ${c.bold('RECENT TRANSITIONS')}`);
    for (const event of recent) {
      const id = event.entry?.id || '?';
      const banner = event.entry?.banner || '?';
      const date = event.timestamp ? event.timestamp.slice(0, 10) : 'unknown';
      console.log(`  ${c.gray(date)}  ${String(event.action).padEnd(12)} ${c.gray('[' + id + ']')} ${banner}`);
    }
  }

  if (!all.length) console.log(c.gray('\n  No context entries yet.'));
  console.log();
}

module.exports = { lifecycleReport };
