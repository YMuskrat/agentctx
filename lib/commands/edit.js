'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('../store');
const { c, truncate } = require('../format');

function openEditor(initialContent) {
  const tmpFile = path.join(os.tmpdir(), `agenctx-edit-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, initialContent || '', 'utf8');
  const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === 'win32' ? 'notepad' : 'vi');
  const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });
  if (result.error) throw new Error(`Could not open editor: ${editor}`);
  const content = fs.readFileSync(tmpFile, 'utf8').trim();
  fs.unlinkSync(tmpFile);
  return content;
}

function edit(args) {
  const root = store.requireRoot();
  const id = args.find(arg => !arg.startsWith('-'));
  let message = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-m' || args[i] === '--message') && args[i + 1] != null) {
      message = args[++i];
    }
  }

  if (!id) {
    console.error(c.red('Usage: agenctx edit <id> [-m "updated content"]'));
    process.exit(1);
  }

  const state = store.loadState(root);
  const result = store.findEntry(state, id);

  if (!result) {
    console.error(c.red(`Entry not found: ${id}`));
    process.exit(1);
  }

  const { entry, bannerName } = result;
  const previous = entry.content;
  const previousStatus = entry.status;
  const newContent = message == null ? openEditor(entry.content) : message.trim();

  if (!newContent || newContent === previous) {
    console.log(c.yellow('No changes.'));
    return;
  }

  entry.content = newContent;
  entry.updated = new Date().toISOString();
  if (entry.status !== 'pinned') entry.status = 'active';
  delete entry.decayed_at;
  delete entry.archived_at;

  store.saveState(root, state);
  store.appendHistory(root, {
    action: 'edit',
    author: process.env.USER || process.env.USERNAME || 'user',
    command: `edit ${id}`,
    entry: {
      id: entry.id,
      banner: bannerName,
      previous,
      content: newContent,
      oldStatus: previousStatus,
      newStatus: entry.status,
    },
  });

  console.log('\n' + c.green('✓') + ` Updated ${c.bold(bannerName)} ${c.gray('[' + id + ']')}`);
  console.log(c.red(`  − ${truncate(previous, 70)}`));
  console.log(c.green(`  + ${truncate(newContent, 70)}`));
  console.log();
}

module.exports = { edit };
