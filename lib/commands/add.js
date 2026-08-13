'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const store = require('../store');
const { c } = require('../format');

const BANNER_ALIASES = {
  warn: 'warnings', warning: 'warnings',
  decision: 'decisions', dec: 'decisions',
  rule: 'rules',
  test: 'testing',
  package: 'packages', pkg: 'packages',
  note: 'notes',
  ref: 'refs', reference: 'refs',
  task: 'tasks',
  blocker: 'blockers', block: 'blockers',
};

// ── Editor detection ────────────────────────────────────────────────────────

function probe(cmd) {
  try { execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 2000 }); return true; } catch { return false; }
}

let _editorsCache = null;
function detectEditors() {
  if (_editorsCache) return _editorsCache;
  const terminal = [];
  const gui = [];

  if (probe('vim'))  terminal.push({ cmd: 'vim',  args: [],         name: 'vim' });
  if (probe('nvim')) terminal.push({ cmd: 'nvim', args: [],         name: 'neovim' });
  if (probe('nano')) terminal.push({ cmd: 'nano', args: [],         name: 'nano' });
  if (probe('vi'))   terminal.push({ cmd: 'vi',   args: [],         name: 'vi' });

  if (probe('cursor'))   gui.push({ cmd: 'cursor',   args: ['--wait'], name: 'Cursor' });
  if (probe('code'))     gui.push({ cmd: 'code',     args: ['--wait'], name: 'VS Code' });
  if (probe('windsurf')) gui.push({ cmd: 'windsurf', args: ['--wait'], name: 'Windsurf' });
  if (probe('zed'))      gui.push({ cmd: 'zed',      args: ['--wait'], name: 'Zed' });

  const envEditor = process.env.EDITOR || process.env.VISUAL;
  if (envEditor && !terminal.find(e => e.cmd === envEditor)) {
    terminal.unshift({ cmd: envEditor, args: [], name: envEditor });
  }

  _editorsCache = { terminal, gui };
  return _editorsCache;
}

// Detect if the current terminal is embedded inside a GUI editor.
// If yes, return that editor with --reuse-window so the file opens in the same window.
function detectParentEditor(gui) {
  const tp = process.env.TERM_PROGRAM;
  if (tp !== 'vscode') return null; // both VS Code and Cursor set TERM_PROGRAM=vscode

  let editor;
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_SESSION_ID || process.env.CURSOR_CHANNEL) {
    editor = gui.find(e => e.cmd === 'cursor');
  }
  if (!editor) editor = gui.find(e => e.cmd === 'cursor') || gui.find(e => e.cmd === 'code');
  if (!editor) return null;

  // We're inside this editor's terminal — reuse the current window
  return { ...editor, args: ['--reuse-window', '--wait'] };
}

// ── Open in an editor ────────────────────────────────────────────────────────

function spawnEditor(editor, filePath) {
  const result = spawnSync(editor.cmd, [...editor.args, filePath], { stdio: 'inherit', shell: true });
  return !result.error;
}

function readTmp(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  try { fs.unlinkSync(filePath); } catch {}
  return raw.trim() || null;
}

function makeTmp(existingContent) {
  const filePath = path.join(os.tmpdir(), `agenctx-${Date.now()}.txt`);
  fs.writeFileSync(filePath, existingContent || '', 'utf8');
  return filePath;
}

// ── GUI editor picker (standalone terminal + Ctrl+E) ────────────────────────

function pickGUI(terminal, gui) {
  return new Promise(resolve => {
    console.log();
    if (terminal.length) process.stdout.write(`  ${c.bold('[enter]')}  ${c.cyan(terminal[0].name)} (terminal)\n`);
    gui.forEach((ed, i) => process.stdout.write(`  ${c.bold('[' + (i + 1) + ']')}      ${c.cyan(ed.name)}\n`));
    process.stdout.write('\n  > ');

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', buf => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');

      const key = buf.toString();
      if (key === '\x03' || key === '\x1b') { console.log(c.yellow('  Aborted.')); process.exit(0); }
      if (key === '\r' || key === '\n' || key === ' ') { resolve(terminal[0] || gui[0] || null); return; }

      const idx = parseInt(key, 10) - 1;
      resolve(!isNaN(idx) && gui[idx] ? gui[idx] : terminal[0] || null);
    });
  });
}

// Open in editor triggered by Ctrl+E (with any content typed so far)
async function openViaCtrlE(bannerName, sofar) {
  const { terminal, gui } = detectEditors();
  const parent = detectParentEditor(gui);

  let editor;
  if (parent) {
    editor = parent;
  } else if (terminal.length || gui.length) {
    editor = await pickGUI(terminal, gui);
  }

  if (!editor) { return null; }

  const filePath = makeTmp(sofar || '');
  spawnEditor(editor, filePath);
  return readTmp(filePath);
}

// ── --editor flag: open vim directly, no questions ──────────────────────────

function openVim(bannerName) {
  const { terminal, gui } = detectEditors();
  const editor = terminal[0] || gui[0];
  if (!editor) {
    console.error(c.red('No editor found. Install vim, or set $EDITOR, or install VS Code/Cursor.'));
    process.exit(1);
  }
  const filePath = makeTmp('');
  console.log(c.gray(`  Opening ${editor.name}...\n`));
  spawnEditor(editor, filePath);
  return readTmp(filePath);
}

// ── Inline editor with Ctrl+E intercept ─────────────────────────────────────

function inlineWithCtrlE(bannerName) {
  return new Promise(resolve => {
    console.log(c.gray(`\n  Adding to ${c.bold(bannerName)} — markdown and code supported`));
    console.log(c.gray(`  Type . on empty line to finish · ${c.bold('Ctrl+E')} to open in editor · Ctrl+C to abort\n`));
    process.stdout.write('  ');

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const lines = [];
    let current = '';
    let handling = false; // prevent re-entrant Ctrl+E

    function rerender() {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write('  ' + current);
    }

    async function onCtrlE() {
      if (handling) return;
      handling = true;
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.setEncoding(null);
      process.stdout.write('\n');

      const sofar = [...lines, current].filter(Boolean).join('\n');
      const result = await openViaCtrlE(bannerName, sofar);
      resolve(result);
    }

    process.stdin.on('data', async ch => {
      if (handling) return;

      if (ch === '\x03') { // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        console.log('\n' + c.yellow('  Aborted.'));
        process.exit(0);
      }

      if (ch === '\x05') { await onCtrlE(); return; } // Ctrl+E

      if (ch === '\r' || ch === '\n') {
        process.stdout.write('\n');
        if (current === '.') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
          resolve(lines.join('\n').trim() || null);
          return;
        }
        lines.push(current);
        current = '';
        process.stdout.write('  ');
        return;
      }

      if (ch === '\x7f' || ch === '\b') { // Backspace
        if (current.length) { current = current.slice(0, -1); rerender(); }
        return;
      }

      // Ignore escape sequences (arrow keys etc.)
      if (ch === '\x1b') return;

      // Printable
      if (ch >= ' ') { current += ch; process.stdout.write(ch); }
    });
  });
}

// ── Stdin fallback ───────────────────────────────────────────────────────────

function readStdin() {
  if (process.stdin.isTTY) return null;
  try { return fs.readFileSync(0, 'utf8').trim() || null; } catch { return null; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function add(args) {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  const state = store.loadState(root);
  const banners = store.allBanners(config);

  let bannerName = null;
  let messageParts = [];
  let forceEditor = false;
  let pinned = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-m' || args[i] === '--message') && args[i + 1] != null) {
      messageParts = [args[++i]];
    } else if (args[i] === '-e' || args[i] === '--editor') {
      forceEditor = true;
    } else if (args[i] === '-p' || args[i] === '--pin') {
      pinned = true;
    } else if (!args[i].startsWith('-') && !bannerName) {
      bannerName = args[i];
    } else if (!args[i].startsWith('-')) {
      messageParts.push(args[i]);
    }
  }

  if (!bannerName) {
    console.error(c.red('Error: banner name required'));
    console.error(`Usage: agenctx add <banner> "message"`);
    console.error(`Banners: ${banners.join(', ')}`);
    process.exit(1);
  }

  if (BANNER_ALIASES[bannerName]) bannerName = BANNER_ALIASES[bannerName];

  if (!banners.includes(bannerName)) {
    console.log(c.yellow(`Creating new custom banner: ${c.bold(bannerName)}`));
    config.custom_banners = config.custom_banners || [];
    config.custom_banners.push(bannerName);
    store.saveConfig(root, config);
    state.banners[bannerName] = { entries: [] };
  }

  let message = (!forceEditor && messageParts.length) ? messageParts.join(' ') : null;

  if (!message) {
    const stdin = !forceEditor && readStdin();
    if (stdin) {
      message = stdin;
    } else if (forceEditor) {
      message = openVim(bannerName);          // --editor: straight to vim
    } else {
      message = await inlineWithCtrlE(bannerName); // default: inline + Ctrl+E
    }
  }

  if (!message) {
    console.log(c.yellow('\nAborted — no content.'));
    process.exit(0);
  }

  const author = process.env.USER || process.env.USERNAME || 'user';
  const entry = {
    id: store.generateId(),
    status: pinned ? 'pinned' : 'active',
    content: message,
    author,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    last_read: null,
    read_count: 0,
  };

  if (!state.banners[bannerName]) state.banners[bannerName] = { entries: [] };
  state.banners[bannerName].entries.push(entry);
  store.saveState(root, state);

  store.appendHistory(root, {
    action: 'add',
    author,
    command: `add ${bannerName}`,
    entry: { id: entry.id, banner: bannerName, content: message },
  });

  const preview = message.split('\n')[0].slice(0, 60);
  console.log('\n' + c.green('✓') + ` Added to ${c.bold(bannerName)} ${c.gray('[' + entry.id + ']')}${pinned ? ' 📌' : ''}`);
  console.log(c.gray(`  "${preview}"`));
}

module.exports = { add };
