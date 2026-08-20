'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('../store');
const { c, truncate } = require('../format');

function legacySessionFile(root) {
  return path.join(store.agenctxDir(root), 'session.json');
}

function activeSessionsDir(root) {
  return path.join(store.agenctxDir(root), 'runtime', 'sessions');
}

function activeSessionFile(root, id) {
  return path.join(activeSessionsDir(root), `${id}.json`);
}

function ensureRuntimeIgnored(root) {
  const file = path.join(store.agenctxDir(root), '.gitignore');
  const required = ['runtime/', 'session.json'];
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = new Set(existing.split(/\r?\n/).map(line => line.trim()));
  const additions = required.filter(line => !lines.has(line));
  if (!additions.length) return;
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, separator + additions.join('\n') + '\n', 'utf8');
}

function receiptsDir(root) {
  return path.join(store.agenctxDir(root), 'sessions');
}

function migrateLegacyActiveSession(root) {
  const legacy = legacySessionFile(root);
  if (!fs.existsSync(legacy)) return;
  let session;
  try { session = JSON.parse(fs.readFileSync(legacy, 'utf8')); } catch { return; }
  if (!session?.id) return;
  saveActiveSession(root, session);
  fs.unlinkSync(legacy);
}

function saveActiveSession(root, session) {
  ensureRuntimeIgnored(root);
  const dir = activeSessionsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = activeSessionFile(root, session.id);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(session, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function clearActiveSession(root, id) {
  const file = activeSessionFile(root, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function loadActiveSessions(root) {
  migrateLegacyActiveSession(root);
  const dir = activeSessionsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.started) - new Date(b.started));
}

function matchActiveSession(sessions, id) {
  if (!id) return null;
  const matches = sessions.filter(session => session.id === id || session.id.endsWith(id));
  if (matches.length > 1) {
    console.error(c.red(`Active session ID is ambiguous: ${id}`));
    process.exit(1);
  }
  return matches[0] || null;
}

function loadActiveSession(root, explicitId = null) {
  const sessions = loadActiveSessions(root);
  const requested = explicitId || process.env.AGENCTX_SESSION_ID || null;
  if (requested) {
    const matched = matchActiveSession(sessions, requested);
    if (!matched) {
      console.error(c.red(`Active session not found: ${requested}`));
      process.exit(1);
    }
    return matched;
  }
  if (sessions.length <= 1) return sessions[0] || null;
  console.error(c.red(`${sessions.length} sessions are active; choose one with --session=<id>.`));
  console.error(`Active: ${sessions.map(session => session.id).join(', ')}`);
  process.exit(1);
}

function hasActiveAgentSessions(root) {
  return loadActiveSessions(root).some(session => session.actor === 'agent');
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
  console.log(c.gray(`  Select explicitly with: --session=${session.id}`));
  console.log();
  return session;
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
  clearActiveSession(root, session.id);
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
    const entries = receipt.served.flatMap(event => event.entries || []);
    const previewCount = entries.filter(entry => entry.mode === 'preview').length;
    const fullCount = entries.filter(entry => entry.mode === 'full').length;
    if (session.actor === 'agent' && previewCount > 0 && fullCount === 0) {
      console.log(c.yellow(`  ⚠ PREVIEWS ONLY: ${previewCount} context entr${previewCount === 1 ? 'y was' : 'ies were'} discovered, but none was opened in full.`));
      console.log(c.gray('  Search and banner results are discovery only; open relevant entries with agenctx view <id>.'));
    }
    console.log();
  }
  return receipt;
}

function end(args = []) {
  const root = store.requireRoot();
  const explicitId = args.find(arg => !arg.startsWith('-')) || null;
  const session = loadActiveSession(root, explicitId);
  if (!session) {
    console.log(c.yellow('  No active session.\n'));
    return;
  }
  _end(root, session, false);
}

function list() {
  const root = store.requireRoot();
  const sessions = loadSessions(root);
  const active = loadActiveSessions(root);

  if (!sessions.length && !active.length) {
    console.log(c.gray('\n  No sessions yet.\n'));
    console.log(c.gray('  Agents start with: agenctx --agent start "task"\n'));
    return;
  }

  console.log(`\n  ${c.bold('AGENT SESSIONS')}  ${c.gray('newest first')}\n`);
  for (const item of [...active].reverse()) {
    console.log(`  ${c.green('● LIVE')}  ${c.bold(item.id)}  ${(item.served || []).length} served`);
    console.log(`          ${item.description}\n`);
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

  const active = loadActiveSessions(root);
  let item = id.toLowerCase() === 'live'
    ? loadActiveSession(root)
    : matchActiveSession(active, id);
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
      console.log(`  ${c.cyan(String(event.sequence).padStart(2, '0'))}  ${c.gray(event.command)}  ${project.name}${project.description ? ' - ' + project.description : ''}`);
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

function abandon(args) {
  const root = store.requireRoot();
  const id = args.find(arg => !arg.startsWith('-'));
  if (!id) {
    console.error(c.red('Usage: agenctx session abandon <id>'));
    process.exit(1);
  }
  const session = matchActiveSession(loadActiveSessions(root), id);
  if (!session) {
    console.error(c.red(`Active session not found: ${id}`));
    process.exit(1);
  }
  clearActiveSession(root, session.id);
  store.appendHistory(root, {
    action: 'session_abandon',
    author: process.env.USER || process.env.USERNAME || 'user',
    command: `session abandon ${session.id}`,
    session: {
      id: session.id,
      description: session.description,
      served: (session.served || []).length,
    },
  });
  console.log(`\n  ${c.green('✓')} Abandoned active session ${c.gray(session.id)}`);
  console.log(c.gray('  No receipt was sealed. The abandonment remains in audit history.\n'));
}

function session(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'start') start(rest);
  else if (sub === 'end') end(rest);
  else if (sub === 'list' || !sub) list();
  else if (sub === 'show') show(rest);
  else if (sub === 'abandon') abandon(rest);
  else list();
}

function agentSession(args) {
  const sub = args[0];
  if (sub === 'start') start(args.slice(1), { agent: true });
  else if (sub === 'end') end(args.slice(1));
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
  loadActiveSessions,
  hasActiveAgentSessions,
  loadSessions,
  receiptHash,
};
