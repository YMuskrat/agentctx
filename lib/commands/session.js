'use strict';
const fs = require('fs');
const path = require('path');
const store = require('../store');
const { c, truncate } = require('../format');

// ── Active session file ───────────────────────────────────────────────────────

function sessionFile(root) {
  return path.join(store.agenctxDir(root), 'session.json');
}

function loadActiveSession(root) {
  const f = sessionFile(root);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function saveActiveSession(root, session) {
  fs.writeFileSync(sessionFile(root), JSON.stringify(session, null, 2), 'utf8');
}

function clearActiveSession(root) {
  const f = sessionFile(root);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// ── Session history store ─────────────────────────────────────────────────────

function sessionsFile(root) {
  return path.join(store.agenctxDir(root), 'sessions.json');
}

function loadSessions(root) {
  const f = sessionsFile(root);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}

function appendSession(root, session) {
  const sessions = loadSessions(root);
  sessions.push(session);
  fs.writeFileSync(sessionsFile(root), JSON.stringify(sessions, null, 2), 'utf8');
}

// ── Attach a read to the active session ──────────────────────────────────────

function attachRead(root, entryId, bannerName, content) {
  const session = loadActiveSession(root);
  if (!session) return;
  session.reads = session.reads || [];
  // Avoid duplicate reads of the same entry in one session
  if (!session.reads.find(r => r.id === entryId)) {
    session.reads.push({ id: entryId, banner: bannerName, content: truncate(content, 60), at: new Date().toISOString() });
  }
  saveActiveSession(root, session);
}

// ── Commands ──────────────────────────────────────────────────────────────────

function start(args) {
  const root = store.requireRoot();
  const description = args.filter(a => !a.startsWith('-')).join(' ').trim();

  if (!description) {
    console.error(c.red('Usage: agenctx session start "description of the question"'));
    process.exit(1);
  }

  // Warn if a session is already active
  const existing = loadActiveSession(root);
  if (existing) {
    console.log(c.yellow(`  ⚠  Session ${c.bold(existing.id)} already active — ending it first`));
    _end(root, existing, true);
  }

  const id = 's-' + store.generateId();
  const session = {
    id,
    description,
    started: new Date().toISOString(),
    reads: [],
  };

  saveActiveSession(root, session);
  store.appendHistory(root, { action: 'session_start', author: 'agent', command: `session start`, session: { id, description } });

  console.log(`  ${c.green('✓')} Session ${c.bold(id)} started`);
  console.log(c.gray(`  "${description}"\n`));
}

function _end(root, session, silent) {
  const ended = new Date().toISOString();
  const durationMs = new Date(ended) - new Date(session.started);
  const duration = durationMs < 60000
    ? Math.floor(durationMs / 1000) + 's'
    : Math.floor(durationMs / 60000) + 'm ' + Math.floor((durationMs % 60000) / 1000) + 's';

  const closed = { ...session, ended, duration };
  appendSession(root, closed);
  clearActiveSession(root);
  store.appendHistory(root, { action: 'session_end', author: 'agent', command: 'session end', session: { id: session.id, reads: session.reads.length } });

  if (!silent) {
    console.log(`  ${c.green('✓')} Session ${c.bold(session.id)} closed  ${c.gray(duration)}`);
    console.log(c.gray(`  ${session.reads.length} entries read\n`));
  }
}

function end(args) {
  const root = store.requireRoot();
  const session = loadActiveSession(root);

  if (!session) {
    console.log(c.yellow('  No active session.\n'));
    return;
  }

  _end(root, session, false);
}

function list(args) {
  const root = store.requireRoot();
  const sessions = loadSessions(root);
  const active = loadActiveSession(root);

  if (!sessions.length && !active) {
    console.log(c.gray('\n  No sessions yet.\n'));
    console.log(c.gray('  Agents start sessions with: agenctx session start "question"\n'));
    return;
  }

  console.log(`\n  ${c.bold('Sessions')} ${c.gray('(newest first)')}\n`);

  // Show active session first
  if (active) {
    const age = Math.floor((Date.now() - new Date(active.started)) / 1000);
    console.log(`  ${c.green('●')} ${c.bold(active.id)}  ${c.green('active')}  ${c.gray(age + 's')}`);
    console.log(`     ${active.description}`);
    console.log(c.gray(`     ${active.reads.length} entries read so far`));
    console.log();
  }

  const recent = [...sessions].reverse().slice(0, 20);
  for (const s of recent) {
    const date = s.started.slice(0, 10);
    const time = s.started.slice(11, 16);
    console.log(`  ${c.gray('○')} ${c.bold(s.id)}  ${c.gray(date + ' ' + time)}  ${c.gray(s.duration || '')}`);
    console.log(`     ${truncate(s.description, 65)}`);
    console.log(c.gray(`     ${(s.reads || []).length} entries read`));
  }

  console.log();
  console.log(c.gray('  Inspect a session: agenctx session show <id>\n'));
}

function show(args) {
  const root = store.requireRoot();
  const id = args[0];

  if (!id) {
    console.error(c.red('Usage: agenctx session show <id>'));
    process.exit(1);
  }

  // Check active session
  const active = loadActiveSession(root);
  let session = active?.id === id ? active : null;

  // Check history
  if (!session) {
    const sessions = loadSessions(root);
    session = sessions.find(s => s.id === id || s.id.endsWith(id));
  }

  if (!session) {
    console.error(c.red(`Session not found: ${id}`));
    process.exit(1);
  }

  const isActive = !session.ended;
  const state = store.loadState(root);

  console.log(`\n  ${c.bold('Session')} ${c.bold(session.id)}  ${isActive ? c.green('active') : c.gray('closed')}\n`);
  console.log(`  Question:  ${session.description}`);
  console.log(`  Started:   ${session.started.slice(0, 19).replace('T', ' ')}`);
  if (session.ended) {
    console.log(`  Ended:     ${session.ended.slice(0, 19).replace('T', ' ')}  ${c.gray(session.duration)}`);
  }
  console.log();

  // Entries read
  const reads = session.reads || [];
  if (reads.length) {
    console.log(c.bold('  Context used:'));
    console.log();
    for (const r of reads) {
      console.log(`  ${c.green('✓')}  ${c.cyan('[' + r.banner + ']')} ${c.gray(r.id)}  ${r.content}`);
    }
  } else {
    console.log(c.gray('  No entries read.'));
  }

  console.log();
}

function session(args) {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case 'start': start(rest); break;
    case 'end':   end(rest);   break;
    case 'list':  list(rest);  break;
    case 'show':  show(rest);  break;
    default:
      list([]); // no subcommand → show list
  }
}

module.exports = { session, attachRead, loadActiveSession };
