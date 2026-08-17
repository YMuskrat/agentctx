'use strict';
const store = require('../store');
const { detect } = require('../detect');
const { c } = require('../format');

function sync(args) {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  const state = store.loadState(root);

  console.log('Scanning project...');
  const detected = detect(root);
  let changes = 0;

  // Reconcile generated package context while preserving human entries and read data.
  if (!state.banners.packages) state.banners.packages = { entries: [] };
  const oldPkgEntries = state.banners.packages.entries;
  const humanPkgEntries = oldPkgEntries.filter(e => e.author !== 'agenctx-sync');
  const oldPkgEntry = oldPkgEntries.find(e => e.author === 'agenctx-sync');

  if (detected.packages.length > 0) {
    const pkgList = detected.packages
      .slice(0, 60)
      .map(p => p.version ? `${p.name}@${p.version}` : p.name)
      .join(', ');
    const content = `Detected packages: ${pkgList}`;

    if (!oldPkgEntry || oldPkgEntry.content !== content || oldPkgEntries.length !== humanPkgEntries.length + 1) {
      state.banners.packages.entries = [
        ...humanPkgEntries,
        generatedEntry(oldPkgEntry, content),
      ];
      changes++;
      console.log(c.green('✓') + ` Packages updated (${detected.packages.length} detected)`);
    }
  } else if (oldPkgEntries.length !== humanPkgEntries.length) {
    state.banners.packages.entries = humanPkgEntries;
    changes++;
    console.log(c.green('✓') + ' Removed stale package context');
  }

  // Reconcile generated environment context.
  if (!state.banners.env) state.banners.env = { entries: [] };
  const oldEnvEntries = state.banners.env.entries;
  const humanEnvEntries = oldEnvEntries.filter(e => e.author !== 'agenctx-sync');
  const oldEnvEntry = oldEnvEntries.find(e => e.author === 'agenctx-sync');

  if (detected.envVars.length > 0) {
    const envList = detected.envVars
      .map(e => e.description ? `${e.name} (${e.description})` : e.name)
      .join(', ');
    const content = `Environment variables: ${envList}`;

    if (!oldEnvEntry || oldEnvEntry.content !== content || oldEnvEntries.length !== humanEnvEntries.length + 1) {
      state.banners.env.entries = [
        ...humanEnvEntries,
        generatedEntry(oldEnvEntry, content),
      ];
      changes++;
      console.log(c.green('✓') + ` Env vars updated (${detected.envVars.length} detected)`);
    }
  } else if (oldEnvEntries.length !== humanEnvEntries.length) {
    state.banners.env.entries = humanEnvEntries;
    changes++;
    console.log(c.green('✓') + ' Removed stale environment context');
  }

  // Persist stack-only changes too, including clearing stale detections.
  const oldStack = state.project.stack || [];
  if (JSON.stringify(oldStack) !== JSON.stringify(detected.stack)) {
    state.project.stack = detected.stack;
    changes++;
    console.log(c.green('✓') + ' Project stack updated');
  }

  if (changes === 0) {
    console.log(c.gray('Nothing changed.'));
  } else {
    store.saveState(root, state);
    store.appendHistory(root, {
      action: 'sync',
      author: 'agenctx-sync',
      command: 'sync',
      changes,
    });
  }
}

function generatedEntry(existing, content) {
  const now = new Date().toISOString();
  const changed = Boolean(existing && existing.content !== content);
  const entry = {
    ...(existing || {}),
    id: existing?.id || store.generateId(),
    status: changed && existing?.status !== 'pinned' ? 'active' : existing?.status || 'active',
    content,
    author: 'agenctx-sync',
    created: existing?.created || now,
    updated: now,
    last_read: existing?.last_read || null,
    read_count: existing?.read_count || 0,
  };
  if (changed) {
    delete entry.decayed_at;
    delete entry.archived_at;
  }
  return entry;
}

module.exports = { sync };
