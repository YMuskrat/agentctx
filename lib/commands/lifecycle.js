'use strict';
const store = require('../store');
const { c, truncate } = require('../format');

function transition(id, newStatus) {
  const root = store.requireRoot();
  const state = store.loadState(root);
  const result = store.findEntry(state, id);

  if (!result) {
    console.error(c.red(`Entry not found: ${id}`));
    process.exit(1);
  }

  const { entry, bannerName } = result;
  const oldStatus = entry.status;

  if (oldStatus === newStatus) {
    console.log(c.yellow(`Entry [${id}] is already ${newStatus}.`));
    return;
  }

  entry.status = newStatus;
  entry.updated = new Date().toISOString();

  if (newStatus === 'archived') entry.archived_at = entry.updated;
  if (newStatus === 'active') { delete entry.archived_at; delete entry.decayed_at; }

  store.saveState(root, state);

  const author = process.env.USER || process.env.USERNAME || 'user';
  store.appendHistory(root, {
    action: newStatus === 'pinned' ? 'pin' : newStatus === 'archived' ? 'archive' : 'restore',
    author,
    command: `${newStatus === 'active' ? 'restore/unpin' : newStatus} ${id}`,
    entry: { id, banner: bannerName, oldStatus, newStatus },
  });

  const msgs = {
    pinned: `✓ Pinned ${c.bold(bannerName)} ${c.gray('[' + id + ']')}\n  This entry now appears in every agenctx overview.`,
    active: `✓ ${oldStatus === 'pinned' ? 'Unpinned' : 'Restored'} ${c.bold(bannerName)} ${c.gray('[' + id + ']')}\n  This entry is back in the normal lifecycle.`,
    archived: `✓ Archived ${c.bold(bannerName)} ${c.gray('[' + id + ']')}\n  This entry is now hidden from agents.`,
  };
  console.log('\n' + c.green(msgs[newStatus] || `✓ [${id}] → ${newStatus}`));
  console.log(c.gray(`  Next: agenctx view ${bannerName}\n`));
}

function pin(args) {
  if (!args[0]) { console.error(c.red('Usage: agenctx pin <id>')); process.exit(1); }
  transition(args[0], 'pinned');
}

function unpin(args) {
  if (!args[0]) { console.error(c.red('Usage: agenctx unpin <id>')); process.exit(1); }
  transition(args[0], 'active');
}

function archive(args) {
  if (!args[0]) { console.error(c.red('Usage: agenctx archive <id>')); process.exit(1); }

  // Check for dependent entries (context conflict detection)
  const root = store.requireRoot();
  const state = store.loadState(root);
  const result = store.findEntry(state, args[0]);
  if (!result) { console.error(c.red(`Entry not found: ${args[0]}`)); process.exit(1); }

  // Simple dependency detection: other entries that reference this entry's key words
  const { entry, bannerName } = result;
  const keywords = entry.content.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const dependent = [];

  for (const [bn, b] of Object.entries(state.banners)) {
    for (const e of b.entries) {
      if (e.id === entry.id || e.status === 'archived') continue;
      const matches = keywords.filter(kw => e.content.toLowerCase().includes(kw));
      if (matches.length >= 2) {
        dependent.push({ ...e, _banner: bn });
      }
    }
  }

  if (dependent.length > 0) {
    console.log(c.yellow(`\n  ⚠  Context conflict detected`));
    console.log(`  You are archiving:`);
    console.log(`    ${c.gray('[' + entry.id + ']')} ${truncate(entry.content, 60)}`);
    console.log(`\n  These entries may depend on it:`);
    for (const dep of dependent.slice(0, 5)) {
      console.log(`    ${c.gray('[' + dep.id + ']')} ${c.cyan(dep._banner + ':')} ${truncate(dep.content, 55)}`);
    }
    console.log(c.gray(`\n  Run: agenctx archive ${args[0]} --force   to archive anyway`));
    console.log(c.gray(`  Run: agenctx resolve ${args[0]}            to walk through each`));
    if (!args.includes('--force')) {
      process.exit(0);
    }
  }

  transition(args[0], 'archived');
}

function restore(args) {
  if (!args[0]) { console.error(c.red('Usage: agenctx restore <id>')); process.exit(1); }
  transition(args[0], 'active');
}

function revert(args) {
  if (!args[0]) { console.error(c.red('Usage: agenctx revert <id>')); process.exit(1); }

  const root = store.requireRoot();
  const state = store.loadState(root);
  const result = store.findEntry(state, args[0]);

  if (!result) {
    console.error(c.red(`Entry not found: ${args[0]}`));
    process.exit(1);
  }

  const { entry, bannerName } = result;
  const now = new Date().toISOString();
  const author = process.env.USER || process.env.USERNAME || 'user';

  // Archive the original entry
  entry.status = 'archived';
  entry.archived_at = now;
  entry.reverted = true;

  // Document the reversion in notes
  if (!state.banners.notes) state.banners.notes = { entries: [] };
  const noteContent = `REVERTED [${entry.id}]: "${truncate(entry.content, 80)}" — archived by ${author}`;
  state.banners.notes.entries.push({
    id: store.generateId(),
    status: 'active',
    content: noteContent,
    author,
    created: now,
    updated: now,
    last_read: null,
    read_count: 0,
  });

  store.saveState(root, state);
  store.appendHistory(root, {
    action: 'revert',
    author,
    command: `revert ${args[0]}`,
    entry: { id: entry.id, banner: bannerName, content: entry.content },
  });

  console.log(c.green('✓') + ` Reverted ${c.gray('[' + args[0] + ']')} — archived and noted`);
  console.log(c.gray('  Agents will see this decision was made and reverted.'));
}

function resolve(args) {
  // Walk through dependent entries interactively
  // (simplified v1 — no readline interaction, just list them)
  if (!args[0]) { console.error(c.red('Usage: agenctx resolve <id>')); process.exit(1); }
  const root = store.requireRoot();
  const state = store.loadState(root);
  const result = store.findEntry(state, args[0]);
  if (!result) { console.error(c.red(`Entry not found: ${args[0]}`)); process.exit(1); }

  console.log(c.bold('\nConflict resolution'));
  console.log(c.gray('Review dependent entries and use archive/edit/pin to resolve.\n'));

  const { entry } = result;
  const keywords = entry.content.toLowerCase().split(/\s+/).filter(w => w.length > 4);

  let found = 0;
  for (const [bn, b] of Object.entries(state.banners)) {
    for (const e of b.entries) {
      if (e.id === entry.id || e.status === 'archived') continue;
      const matches = keywords.filter(kw => e.content.toLowerCase().includes(kw));
      if (matches.length >= 2) {
        found++;
        console.log(`  ${c.gray('[' + e.id + ']')} [${c.cyan(bn)}] ${truncate(e.content, 60)}`);
        console.log(c.gray(`    agenctx archive ${e.id}  |  agenctx edit ${e.id}  |  agenctx pin ${e.id}`));
        console.log();
      }
    }
  }

  if (!found) console.log(c.gray('  No dependent entries found.'));
}

module.exports = { pin, unpin, archive, restore, revert, resolve };
