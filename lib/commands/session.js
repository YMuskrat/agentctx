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

  console.log(`\n  ${c.green('●')} ${c.bold(agent ? 'AGENT SESSION ACTIVE' : 'SESSION ACTIVE')}  ${c.gray(session.id)}`);
  console.log(`  ${description}`);
  console.log();
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
    console.log(`\n  ${c.green('✓')} ${c.bold('RECEIPT SEALED')}  ${c.gray(session.id)}  ${c.gray(duration)}`);
    console.log(`  ${receipt.served.length} response${receipt.served.length === 1 ? '' : 's'} served`);
    console.log(`  Receipt: ${c.cyan(receipt.hash)}`);
    console.log();
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

  console.log(`\n  ${c.bold('AGENT SESSIONS')}  ${c.gray('newest first')}\n`);
  if (active) {
    console.log(`  ${c.green('● LIVE')}  ${c.bold(active.id)}  ${(active.served || []).length} served`);
    console.log(`          ${active.description}\n`);
  }

  for (const item of [...sessions].reverse().slice(0, 20)) {
    const hash = item.hash ? item.hash.slice(0, 12) : item.id;
    const date = (item.started || '').slice(0, 16).replace('T', ' ');
    console.log(`  ${c.cyan(hash)}  ${String((item.served || []).length).padStart(3)} served  ${c.gray(date)}`);
    console.log(`                ${truncate(item.description || '', 60)}${item.legacy ? c.gray(' · legacy') : ''}`);
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
  let item = active && (id.toLowerCase() === 'live' || active.id === id || active.id.endsWith(id)) ? active : null;
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
  const shortHash = item.hash?.slice(0, 12) || item.id;
  const integrityLabel = integrity == null ? c.green('ACTIVE') : integrity ? c.green('VALID') : c.red('INVALID');
  console.log(`\n  ${c.bold('AGENT TRACE')}  ${c.cyan(shortHash)}  ${integrityLabel}`);
  console.log(`  ${item.description}`);

  const served = item.served || [];
  console.log(`\n  ${c.bold('CONTEXT SERVED BY BANNER')}  ${c.gray(served.length + ' response' + (served.length === 1 ? '' : 's'))}\n`);
  if (!served.length) {
    console.log(c.gray('  Nothing was served.'));
    console.log();
    return;
  }

  const config = store.loadConfig(root);
  const bannerGroups = new Map();
  const overviewEvents = [];
  const otherEvents = [];

  for (const event of served) {
    if (event.project) overviewEvents.push(event);
    let grouped = false;
    for (const entry of event.entries || []) {
      const bannerName = entry.banner || event.type?.name || 'context';
      if (!bannerGroups.has(bannerName)) bannerGroups.set(bannerName, []);
      bannerGroups.get(bannerName).push({ event, entry });
      grouped = true;
    }
    if (!grouped && event.type?.name) {
      const bannerName = event.type.name;
      if (!bannerGroups.has(bannerName)) bannerGroups.set(bannerName, []);
      bannerGroups.get(bannerName).push({ event, entry: null });
      grouped = true;
    }
    if (!grouped && !event.project) otherEvents.push(event);
  }

  if (overviewEvents.length) {
    console.log(c.bold('  PROJECT OVERVIEW'));
    for (const event of overviewEvents) {
      const project = event.project;
      console.log(`  ${c.cyan(String(event.sequence).padStart(2, '0'))}  ${c.gray(event.command)}  ${project.name}${project.description ? ' — ' + project.description : ''}`);
      if (project.stack?.length) console.log(c.gray(`      ${project.stack.join(', ')}`));
    }
    console.log();
  }

  for (const [bannerName, deliveries] of bannerGroups) {
    console.log(`  ${c.bold(bannerName.toUpperCase())}`);
    console.log(c.gray(`  ${store.bannerDescription(config, bannerName)}`));
    for (const { event, entry } of deliveries) {
      if (!entry) {
        console.log(`  ${c.cyan(String(event.sequence).padStart(2, '0'))}  ${c.gray('EMPTY')}    ${event.command}`);
        continue;
      }
      const modeText = (entry.mode || 'context').toUpperCase().padEnd(7);
      const mode = entry.mode === 'full' ? c.green(modeText) : c.yellow(modeText);
      console.log(`  ${c.cyan(String(event.sequence).padStart(2, '0'))}  ${mode} ${c.gray('[' + entry.id + ']')}  ${c.gray(event.command)}`);
      for (const line of String(entry.content || '').split('\n')) {
        console.log(`      ${line}`);
      }
    }
    console.log();
  }

  if (otherEvents.length) {
    console.log(c.bold('  OTHER RESPONSES'));
    for (const event of otherEvents) {
      console.log(`  ${c.cyan(String(event.sequence).padStart(2, '0'))}  ${String(event.kind || 'context').toUpperCase()}  ${event.command}`);
    }
    console.log();
  }
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
