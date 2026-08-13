'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('../store');
const { c, truncate } = require('../format');

function sessionFile(root) {
  return path.join(store.agenctxDir(root), 'session.json');
}

function receiptsDir(root) {
  return path.join(store.agenctxDir(root), 'sessions');
}

function loadActiveSession(root) {
  const file = sessionFile(root);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveActiveSession(root, session) {
  fs.writeFileSync(sessionFile(root), JSON.stringify(session, null, 2) + '\n', 'utf8');
}

function clearActiveSession(root) {
  const file = sessionFile(root);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function canonicalReceipt(receipt) {
  return JSON.stringify({
    version: receipt.version,
    id: receipt.id,
    parent: receipt.parent,
    actor: receipt.actor,
    description: receipt.description,
    started: receipt.started,
    ended: receipt.ended,
    duration: receipt.duration,
    served: receipt.served,
  });
}

function receiptHash(receipt) {
  return crypto.createHash('sha256').update(canonicalReceipt(receipt)).digest('hex');
}

function loadLegacySessions(root) {
  const file = path.join(store.agenctxDir(root), 'sessions.json');
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).map(session => ({
      ...session,
      actor: session.actor || 'agent',
      served: session.served || (session.reads || []).map((read, index) => ({
        sequence: index + 1,
        at: read.at,
        command: `view ${read.id}`,
        kind: 'entry',
        entries: [{ ...read, mode: 'full' }],
      })),
      legacy: true,
    }));
  } catch {
    return [];
  }
}

function loadSessions(root) {
  const dir = receiptsDir(root);
  const receipts = fs.existsSync(dir)
    ? fs.readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { return null; }
      })
      .filter(Boolean)
    : [];

  return [...loadLegacySessions(root), ...receipts]
    .sort((a, b) => new Date(a.ended || a.started) - new Date(b.ended || b.started));
}

function writeReceipt(root, session, ended, duration) {
  const previous = loadSessions(root).filter(item => item.hash).at(-1);
  const receipt = {
    version: 1,
    id: session.id,
    parent: previous?.hash || null,
    actor: session.actor || 'user',
    description: session.description,
    started: session.started,
    ended,
    duration,
    served: session.served || [],
  };
  receipt.hash = receiptHash(receipt);

  const dir = receiptsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${receipt.hash}.json`),
    JSON.stringify(receipt, null, 2) + '\n',
    { encoding: 'utf8', flag: 'wx' },
  );
  return receipt;
}

function start(args, { agent = false } = {}) {
  const root = store.requireRoot();
  const description = args.filter(arg => !arg.startsWith('-')).join(' ').trim();

  if (!description) {
    const usage = agent
      ? 'Usage: agenctx --agent start "description of the task"'
      : 'Usage: agenctx session start "description of the task"';
    console.error(c.red(usage));
    process.exit(1);
  }

  const existing = loadActiveSession(root);
  if (existing) {
    console.log(c.yellow(`  Session ${c.bold(existing.id)} already active — ending it first`));
    _end(root, existing, true);
  }

  const session = {
    id: 's-' + store.generateId(),
    actor: agent ? 'agent' : 'user',
    description,
    started: new Date().toISOString(),
    served: [],
  };
  saveActiveSession(root, session);
  store.appendHistory(root, {
    action: 'session_start',
    author: session.actor,
    command: agent ? '--agent start' : 'session start',
    session: { id: session.id, description },
  });

  console.log(`  ${c.green('✓')} ${agent ? 'Agent session' : 'Session'} ${c.bold(session.id)} started`);
  console.log(c.gray(`  "${description}"\n`));
}

function recordServed(root, event, { agent = false } = {}) {
  const session = loadActiveSession(root);
  const trackedAsAgent = session?.actor === 'agent' || agent;
  if (!trackedAsAgent) return false;

  const servedEvent = {
    sequence: session ? (session.served || []).length + 1 : null,
    at: new Date().toISOString(),
    ...event,
  };

  if (session) {
    session.served = session.served || [];
    session.served.push(servedEvent);
    saveActiveSession(root, session);
  }

  store.appendHistory(root, {
    action: event.kind === 'entry' ? 'read' : 'served',
    author: 'agent',
    command: event.command,
    session: session ? { id: session.id, sequence: servedEvent.sequence } : null,
    served: event.entries || [],
  });
  return true;
}

// Backward-compatible helper for callers that record a full entry read.
function attachRead(root, entryId, bannerName, content) {
  return recordServed(root, {
    command: `view ${entryId}`,
    kind: 'entry',
    entries: [{ id: entryId, banner: bannerName, mode: 'full', content }],
  }, { agent: true });
}

function _end(root, session, silent) {
  const ended = new Date().toISOString();
  const durationMs = new Date(ended) - new Date(session.started);
  const duration = durationMs < 60000
    ? Math.floor(durationMs / 1000) + 's'
    : Math.floor(durationMs / 60000) + 'm ' + Math.floor((durationMs % 60000) / 1000) + 's';
  const receipt = writeReceipt(root, session, ended, duration);
  clearActiveSession(root);
  store.appendHistory(root, {
    action: 'session_end',
    author: session.actor || 'user',
    command: session.actor === 'agent' ? '--agent end' : 'session end',
    session: { id: session.id, hash: receipt.hash, served: receipt.served.length },
  });

  if (!silent) {
    console.log(`  ${c.green('✓')} Session ${c.bold(session.id)} closed  ${c.gray(duration)}`);
    console.log(c.gray(`  ${receipt.served.length} responses served`));
    console.log(c.gray(`  Receipt: ${receipt.hash}\n`));
  }
  return receipt;
}

function end() {
  const root = store.requireRoot();
  const session = loadActiveSession(root);
  if (!session) {
    console.log(c.yellow('  No active session.\n'));
    return;
  }
  _end(root, session, false);
}

function list() {
  const root = store.requireRoot();
  const sessions = loadSessions(root);
  const active = loadActiveSession(root);

  if (!sessions.length && !active) {
    console.log(c.gray('\n  No sessions yet.\n'));
    console.log(c.gray('  Agents start with: agenctx --agent start "task"\n'));
    return;
  }

  console.log(`\n  ${c.bold('Sessions')} ${c.gray('(newest first)')}\n`);
  if (active) {
    console.log(`  ${c.green('●')} ${c.bold(active.id)}  ${c.green('active')}  ${active.description}`);
    console.log(c.gray(`     ${(active.served || []).length} responses served so far\n`));
  }

  for (const item of [...sessions].reverse().slice(0, 20)) {
    const hash = item.hash ? item.hash.slice(0, 12) : item.id;
    const date = (item.started || '').slice(0, 16).replace('T', ' ');
    console.log(`  ${c.gray('○')} ${c.bold(hash)}  ${c.gray(date)}  ${truncate(item.description || '', 55)}`);
    console.log(c.gray(`     ${(item.served || []).length} responses served${item.legacy ? ' · legacy' : ''}`));
  }
  console.log();
}

function show(args) {
  const root = store.requireRoot();
  const id = args[0];
  if (!id) {
    console.error(c.red('Usage: agenctx session show <id-or-hash>'));
    process.exit(1);
  }

  const active = loadActiveSession(root);
  let item = active && (active.id === id || active.id.endsWith(id)) ? active : null;
  if (!item) {
    item = loadSessions(root).find(session =>
      session.id === id || session.id?.endsWith(id) || session.hash?.startsWith(id));
  }
  if (!item) {
    console.error(c.red(`Session not found: ${id}`));
    process.exit(1);
  }

  const isActive = !item.ended;
  const integrity = item.hash ? receiptHash(item) === item.hash : null;
  console.log(`\n  ${c.bold('Session')} ${c.bold(item.hash?.slice(0, 12) || item.id)}  ${isActive ? c.green('active') : c.gray('closed')}\n`);
  console.log(`  Task:      ${item.description}`);
  console.log(`  Actor:     ${item.actor || 'agent'}`);
  console.log(`  Started:   ${(item.started || '').slice(0, 19).replace('T', ' ')}`);
  if (item.ended) console.log(`  Ended:     ${item.ended.slice(0, 19).replace('T', ' ')}  ${c.gray(item.duration || '')}`);
  if (item.hash) {
    console.log(`  Hash:      ${item.hash}`);
    console.log(`  Parent:    ${item.parent || 'none'}`);
    console.log(`  Integrity: ${integrity ? c.green('valid') : c.red('INVALID')}`);
  }

  const served = item.served || [];
  console.log(`\n  ${c.bold('Served in order:')}\n`);
  if (!served.length) console.log(c.gray('  Nothing was served.'));
  for (const event of served) {
    console.log(`  ${String(event.sequence).padStart(2, '0')}  ${c.cyan(event.command)}  ${c.gray(event.kind || '')}`);
    if (event.project) {
      console.log(`      project: ${event.project.name}${event.project.description ? ' — ' + event.project.description : ''}`);
      if (event.project.stack?.length) console.log(`      stack: ${event.project.stack.join(', ')}`);
    }
    if (event.type) console.log(`      type: ${event.type.name} — ${event.type.description}`);
    for (const entry of event.entries || []) {
      const mode = entry.mode ? c.gray(` (${entry.mode})`) : '';
      console.log(`      ${c.cyan('[' + entry.banner + ']')} ${c.gray(entry.id)}${mode}`);
      for (const line of String(entry.content || '').split('\n')) {
        console.log(`        ${line}`);
      }
    }
    for (const type of event.types || []) {
      console.log(c.gray(`      type: ${type.name} — ${type.description} (${type.visible} visible, ${type.pinned} pinned)`));
    }
  }
  console.log();
}

function session(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'start') start(rest);
  else if (sub === 'end') end();
  else if (sub === 'list' || !sub) list();
  else if (sub === 'show') show(rest);
  else list();
}

function agentSession(args) {
  const sub = args[0];
  if (sub === 'start') start(args.slice(1), { agent: true });
  else if (sub === 'end') end();
  else {
    console.error(c.red('Usage: agenctx --agent start "task" | agenctx --agent end'));
    process.exit(1);
  }
}

module.exports = {
  session,
  agentSession,
  recordServed,
  attachRead,
  loadActiveSession,
  loadSessions,
  receiptHash,
};
