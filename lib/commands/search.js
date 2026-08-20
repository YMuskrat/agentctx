'use strict';
const crypto = require('crypto');
const store = require('../store');
const { c, bannerIcon, truncate } = require('../format');
const { recordServed } = require('./session');
const { applyLifecycle } = require('../decay');

// ── Date parser ───────────────────────────────────────────────────────────────

function parseSince(str) {
  if (!str) return null;
  const m = str.match(/^(\d+)(d|w|m)$/i);
  if (m) {
    const n = parseInt(m[1]);
    const unit = m[2].toLowerCase();
    const ms = unit === 'd' ? 86400000 : unit === 'w' ? 604800000 : 2592000000;
    return new Date(Date.now() - n * ms);
  }
  const parsed = new Date(str);
  return isNaN(parsed) ? null : parsed;
}

// ── Collect all entries flat ──────────────────────────────────────────────────

function collectEntries(state, { includeAmbient = false } = {}) {
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

// ── Keyword highlight ─────────────────────────────────────────────────────────

function highlight(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return text.slice(0, idx) + c.yellow(text.slice(idx, idx + query.length)) + text.slice(idx + query.length);
}

// ── Filter entries ────────────────────────────────────────────────────────────

function filterEntries(all, { query, since, banner }) {
  return all.filter(({ entry, bannerName }) => {
    if (banner && bannerName !== banner) return false;
    if (since && new Date(entry.created) < since) return false;
    if (query && !entry.content.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
}

// ── Print results (non-interactive) ──────────────────────────────────────────

function fullViewHint() {
  const selected = process.env.AGENCTX_SESSION_ID;
  return `agenctx view <id>${selected ? ` --session=${selected}` : ''}`;
}

function printResults(results, query, banner) {
  if (results.length === 0) {
    console.log(`\n  ${c.bold('SEARCH PREVIEWS')}  ${query ? `“${query}”` : 'all context'}`);
    console.log(c.gray(`  No matching context${banner ? ` in ${banner}` : ''}.`));
    console.log(c.gray('  Try a broader keyword or run: agenctx view\n'));
    return;
  }

  console.log(`\n  ${c.bold('SEARCH PREVIEWS')}  ${query ? `“${query}”` : 'all context'}`);
  console.log(c.gray(`  ${results.length} result${results.length !== 1 ? 's' : ''}${banner ? ` in ${banner}` : ''}\n`));

  // Group by banner
  const byBanner = {};
  for (const r of results) {
    if (!byBanner[r.bannerName]) byBanner[r.bannerName] = [];
    byBanner[r.bannerName].push(r.entry);
  }

  for (const [bannerName, entries] of Object.entries(byBanner)) {
    console.log(`  ${bannerIcon(bannerName)}${c.bold(bannerName)}`);
    for (const e of entries) {
      const firstLine = highlight(e.content.split('\n')[0], query);
      const status = e.status === 'pinned' ? c.yellow('PINNED ') : c.gray('ACTIVE ');
      const reads = e.read_count > 0 ? c.gray(` · ${e.read_count} read${e.read_count === 1 ? '' : 's'}`) : c.gray(' · unread');
      console.log(`  ${status}${c.gray('[' + e.id + ']')}  ${truncate(firstLine, 62)}${reads}`);
    }
    console.log();
  }

  console.log(c.gray(`  Discovery only. Open relevant entries in full: ${fullViewHint()}`));
  console.log();
}

// ── Interactive fzf-style search ──────────────────────────────────────────────

function interactiveSearch(all) {
  return new Promise(resolve => {
    if (!process.stdout.isTTY) {
      console.error(c.red('Interactive search requires a TTY terminal.'));
      process.exit(1);
    }

    const W = process.stdout.columns || 80;
    const MAX_ROWS = Math.min(12, all.length); // cap to actual entry count, no blank padding
    const HEIGHT = MAX_ROWS + 2; // +2 for count line and query line

    let query = '';
    let selectedIdx = 0;
    let filtered = all;
    let prevLines = 0;

    function applyFilter() {
      filtered = query
        ? all.filter(({ entry, bannerName }) =>
            entry.content.toLowerCase().includes(query.toLowerCase()) ||
            bannerName.includes(query.toLowerCase()))
        : all;
      selectedIdx = Math.min(selectedIdx, Math.max(0, filtered.length - 1));
    }

    function renderLine(text) {
      // Pad/truncate to terminal width to overwrite previous content cleanly
      const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
      const pad = Math.max(0, W - plain.length);
      return text + ' '.repeat(pad);
    }

    function render() {
      const display = filtered.slice(0, MAX_ROWS);
      const lines = [];

      for (let i = 0; i < MAX_ROWS; i++) {
        if (i < display.length) {
          const { entry, bannerName } = display[i];
          const isSelected = i === selectedIdx;
          const prefix = isSelected ? c.cyan('▶ ') : '  ';
          const banner = c.gray('[' + bannerName.padEnd(10) + ']');
          const id = c.gray(entry.id);
          const text = truncate(entry.content, W - 28);
          const row = `${prefix}${banner} ${id}  ${isSelected ? c.bold(highlight(text, query)) : highlight(text, query)}`;
          lines.push(renderLine(row));
        } else {
          lines.push(' '.repeat(W)); // clear leftover lines from previous render
        }
      }

      const countStr = `  ${filtered.length} / ${all.length} entries`;
      lines.push(renderLine(c.gray(countStr)));
      lines.push(renderLine(`  ${c.bold('>')} ${query}█`));

      // Move cursor up by previous render height, then overwrite
      if (prevLines > 0) process.stdout.write(`\x1b[${prevLines}A\r`);
      process.stdout.write(lines.join('\n') + '\n');
      prevLines = lines.length;
    }

    // Initial render
    process.stdout.write('\n');
    applyFilter();
    render();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', ch => {
      // Ctrl+C / ESC
      if (ch === '\x03' || ch === '\x1b') {
        cleanup();
        resolve(null);
        return;
      }

      // Enter: open selected entry
      if (ch === '\r' || ch === '\n') {
        const chosen = filtered[selectedIdx];
        cleanup();
        if (chosen) resolve(chosen);
        else resolve(null);
        return;
      }

      // Backspace
      if (ch === '\x7f' || ch === '\b') {
        query = query.slice(0, -1);
        applyFilter();
        render();
        return;
      }

      // Arrow up
      if (ch === '\x1b[A' || ch === '\x1b[Z') {
        selectedIdx = Math.max(0, selectedIdx - 1);
        render();
        return;
      }

      // Arrow down
      if (ch === '\x1b[B') {
        selectedIdx = Math.min(filtered.length - 1, selectedIdx + 1);
        render();
        return;
      }

      // Ignore other escape sequences
      if (ch.startsWith('\x1b')) return;

      // Printable
      if (ch >= ' ') {
        query += ch;
        selectedIdx = 0;
        applyFilter();
        render();
      }
    });

    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      // Move up and clear all fzf lines
      if (prevLines > 0) {
        process.stdout.write(`\x1b[${prevLines}A\r`);
        for (let i = 0; i < prevLines; i++) {
          process.stdout.write('\x1b[2K\n'); // clear line
        }
        process.stdout.write(`\x1b[${prevLines}A\r`); // back to top
      }
    }
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function search(args) {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  const state = store.loadState(root);
  applyLifecycle(root, state, config);

  let query = null;
  let since = null;
  let sinceLabel = null;
  let banner = null;
  let agent = false;
  const queryParts = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--since=')) {
      sinceLabel = args[i].slice(8);
      since = parseSince(sinceLabel);
    }
    else if (args[i] === '--since' && args[i + 1]) {
      sinceLabel = args[++i];
      since = parseSince(sinceLabel);
    }
    else if (args[i].startsWith('--banner=')) { banner = args[i].slice(9); }
    else if (args[i] === '--banner' && args[i + 1]) { banner = args[++i]; }
    else if (args[i] === '--agent') { agent = true; }
    else if (!args[i].startsWith('-')) { queryParts.push(args[i]); }
  }
  if (queryParts.length) query = queryParts.join(' ');

  const all = collectEntries(state);

  // No args: interactive fzf mode
  if (!query && !since && !banner) {
    console.log(c.gray('  Type to filter · ↑↓ to navigate · Enter to open · ESC to quit'));
    const chosen = await interactiveSearch(all);
    if (chosen) {
      console.log();
      // Show the full entry
      const { view } = require('./view');
      view([chosen.entry.id, ...(agent ? ['--agent'] : [])]);
    }
    return;
  }

  // Non-interactive: filter and print
  const results = filterEntries(all, { query, since, banner });
  printResults(results, query, banner);
  const command = [
    'search',
    query ? `"${query}"` : null,
    banner ? `--banner=${banner}` : null,
    since ? `--since=${sinceLabel}` : null,
  ].filter(Boolean).join(' ');
  recordServed(root, {
    command,
    kind: 'search',
    entries: results.map(({ entry, bannerName }) => ({
      id: entry.id,
      banner: bannerName,
      mode: 'preview',
      status: entry.status,
      content: truncate(entry.content.split('\n')[0], 62),
      content_hash: crypto.createHash('sha256').update(entry.content).digest('hex'),
    })),
  }, { agent });
}

module.exports = { search };
