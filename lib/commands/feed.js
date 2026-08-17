'use strict';
const store = require('../store');
const { c, bannerIcon, truncate } = require('../format');

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

function collectAll(state, { includeAmbient = false } = {}) {
  const all = [];
  for (const [bannerName, banner] of Object.entries(state.banners)) {
    for (const e of banner.entries) {
      if (e.status === 'archived') continue;
      if (e.status === 'ambient' && !includeAmbient) continue;
      all.push({ entry: e, bannerName });
    }
  }
  return all;
}

// agenctx feed: all entries by recency

function feed(args) {
  const root = store.requireRoot();
  const state = store.loadState(root);

  const limit = (() => {
    const l = args.find(a => a.startsWith('--limit='));
    return l ? parseInt(l.slice(8)) : 20;
  })();

  const all = collectAll(state);
  all.sort((a, b) => new Date(b.entry.created) - new Date(a.entry.created));
  const entries = all.slice(0, limit);

  if (!entries.length) {
    console.log(c.gray('\n  No entries yet.\n'));
    return;
  }

  console.log(`\n  ${c.bold('Recent additions')} ${c.gray('(newest first)')}\n`);

  let lastDay = null;
  for (const { entry, bannerName } of entries) {
    const day = entry.created.slice(0, 10);
    if (day !== lastDay) {
      console.log(c.gray(`  ─── ${day} ───`));
      lastDay = day;
    }
    const pin = entry.status === 'pinned' ? ' 📌' : '';
    const reads = entry.read_count > 0 ? c.gray(`  read ${entry.read_count}×`) : '';
    const banner = c.cyan(`[${bannerName}]`);
    console.log(`  ${c.gray(entry.id)}  ${banner} ${truncate(entry.content, 55)}${pin}${reads}`);
  }

  if (all.length > limit) {
    console.log(c.gray(`\n  Showing ${limit} of ${all.length}; use --limit=N for more`));
  }
  console.log();
}

// agenctx top: most read entries

function top(args) {
  const root = store.requireRoot();
  const state = store.loadState(root);

  const limit = (() => {
    const l = args.find(a => a.startsWith('--limit='));
    return l ? parseInt(l.slice(8)) : 10;
  })();

  const all = collectAll(state);
  all.sort((a, b) => (b.entry.read_count || 0) - (a.entry.read_count || 0));

  const hasReads = all.filter(({ entry }) => (entry.read_count || 0) > 0);
  const entries = hasReads.slice(0, limit);

  if (!entries.length) {
    console.log(c.gray('\n  No entries have been read yet.\n'));
    console.log(c.gray('  Agent reads are captured between: agenctx --agent start ... / agenctx --agent end\n'));
    return;
  }

  console.log(`\n  ${c.bold('Most read entries')}\n`);

  entries.forEach(({ entry, bannerName }, i) => {
    const rank = c.gray(`${String(i + 1).padStart(2)}.`);
    const pin = entry.status === 'pinned' ? ' 📌' : '';
    const banner = c.cyan(`[${bannerName}]`);
    const age = daysSince(entry.last_read);
    const bar = '█'.repeat(Math.min(10, entry.read_count)) + c.gray('░'.repeat(Math.max(0, 10 - entry.read_count)));
    console.log(`  ${rank}  ${c.bold(String(entry.read_count).padStart(3))}×  ${bar}  ${banner} ${truncate(entry.content, 40)}${pin}`);
    console.log(c.gray(`         last read: ${age || 'never'}  id: ${entry.id}`));
  });

  const neverRead = all.length - hasReads.length;
  if (neverRead > 0) console.log(c.gray(`\n  ${neverRead} entries never read`));
  console.log();
}

module.exports = { feed, top };
