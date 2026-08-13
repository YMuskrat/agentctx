'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('../store');
const { c } = require('../format');

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
  const id = args[0];

  if (!id) {
    console.error(c.red('Usage: agenctx edit <id>'));
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
  const newContent = openEditor(entry.content);

  if (!newContent || newContent === previous) {
    console.log(c.yellow('No changes.'));
    return;
  }

  entry.content = newContent;
  entry.updated = new Date().toISOString();

  store.saveState(root, state);
  store.appendHistory(root, {
    action: 'edit',
    author: process.env.USER || process.env.USERNAME || 'user',
    command: `edit ${id}`,
    entry: { id: entry.id, banner: bannerName, previous, content: newContent },
  });

  console.log(c.green('✓') + ` Updated ${c.gray('[' + id + ']')} in ${c.bold(bannerName)}`);
}

module.exports = { edit };
