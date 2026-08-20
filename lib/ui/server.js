'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const store = require('../store');
const {
  activeAnchor,
  activeRetentionDays,
  applyLifecycle,
  daysBetween,
  resolveDecayConfig,
} = require('../decay');
const {
  hasActiveAgentSessions,
  loadActiveSessions,
  loadSessions,
  receiptHash,
} = require('../commands/session');

const PUBLIC_DIR = path.join(__dirname, 'public');
const BODY_LIMIT = 256 * 1024;
const MAX_CONTENT = 20000;

class UIError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function revision(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function humanAuthor() {
  return process.env.USER || process.env.USERNAME || 'user';
}

function assertRevision(expected, current, resource) {
  if (!expected) throw new UIError(400, `Missing ${resource} revision.`);
  if (expected !== revision(current)) {
    throw new UIError(409, `${resource} changed outside this browser. Refresh and try again.`);
  }
}

function requireText(value, label, max = MAX_CONTENT) {
  const text = String(value || '').trim();
  if (!text) throw new UIError(400, `${label} is required.`);
  if (text.length > max) throw new UIError(400, `${label} must be ${max} characters or fewer.`);
  return text;
}

function entryList(state) {
  const entries = [];
  for (const [banner, data] of Object.entries(state.banners || {})) {
    for (const entry of data.entries || []) entries.push({ ...entry, banner });
  }
  return entries;
}

function deliveryCounts(session) {
  let preview = 0;
  let full = 0;
  for (const event of session.served || []) {
    for (const entry of event.entries || []) {
      if (entry.mode === 'full') full++;
      else if (entry.mode === 'preview') preview++;
    }
  }
  return { preview, full };
}

function sessionView(session, active = false) {
  const integrity = session.hash ? receiptHash(session) === session.hash : null;
  return { ...session, active, integrity, delivery: deliveryCounts(session) };
}

function forecastFor(entries, config, now = new Date()) {
  const cfg = resolveDecayConfig(config);
  const buckets = [
    { key: 'week', label: 'Next 7 days', limit: 7, ambient: 0, archive: 0 },
    { key: 'month', label: '8–30 days', limit: 30, ambient: 0, archive: 0 },
    { key: 'quarter', label: '31–60 days', limit: 60, ambient: 0, archive: 0 },
    { key: 'later', label: 'Later', limit: Infinity, ambient: 0, archive: 0 },
  ];
  const details = [];

  for (const entry of entries) {
    let days = null;
    let transition = null;
    if (entry.status === 'active') {
      days = Math.max(0, activeRetentionDays(entry, config) - daysBetween(activeAnchor(entry), now));
      transition = 'ambient';
    } else if (entry.status === 'ambient') {
      days = Math.max(0, cfg.ambientToArchivedDays - daysBetween(entry.decayed_at || activeAnchor(entry), now));
      transition = 'archive';
    }
    if (days == null) continue;
    const bucket = buckets.find(item => days <= item.limit);
    bucket[transition]++;
    details.push({ id: entry.id, banner: entry.banner, content: entry.content, transition, days: Math.ceil(days) });
  }

  return { buckets: buckets.map(({ limit, ...item }) => item), details };
}

function buildSnapshot(root) {
  const config = store.loadConfig(root);
  const state = store.loadState(root);
  applyLifecycle(root, state, config);
  const proposals = store.loadProposals(root);
  const entries = entryList(state);
  const banners = store.allBanners(config).map(name => ({
    name,
    description: store.bannerDescription(config, name),
    entries: entries.filter(entry => entry.banner === name),
  }));
  const counts = { pinned: 0, active: 0, ambient: 0, archived: 0 };
  for (const entry of entries) counts[entry.status] = (counts[entry.status] || 0) + 1;
  const completed = loadSessions(root).map(item => sessionView(item, false));
  const active = loadActiveSessions(root).map(item => sessionView(item, true));

  return {
    generatedAt: new Date().toISOString(),
    project: state.project,
    config: {
      project: config.project,
      description: config.description || '',
      decay: resolveDecayConfig(config),
    },
    revisions: {
      state: revision(state),
      config: revision(config),
      proposals: revision(proposals),
    },
    counts,
    banners,
    entries,
    proposals: proposals.proposals.filter(item => item.status === 'pending'),
    sessions: [...active, ...completed].sort((a, b) =>
      new Date(b.ended || b.started) - new Date(a.ended || a.started)),
    forecast: forecastFor(entries, config),
  };
}

function currentData(root) {
  return {
    config: store.loadConfig(root),
    state: store.loadState(root),
    proposals: store.loadProposals(root),
  };
}

function addEntry(root, body) {
  const { config, state } = currentData(root);
  assertRevision(body.stateRevision, state, 'Context');
  const banner = requireText(body.banner, 'Banner', 80);
  if (!store.allBanners(config).includes(banner)) throw new UIError(400, `Unknown banner: ${banner}`);
  const content = requireText(body.content, 'Context');
  const now = new Date().toISOString();
  const entry = {
    id: store.generateId(),
    status: body.pinned ? 'pinned' : 'active',
    content,
    author: humanAuthor(),
    created: now,
    updated: now,
    last_read: null,
    read_count: 0,
  };
  state.banners[banner] ||= { entries: [] };
  state.banners[banner].entries.push(entry);
  store.saveState(root, state);
  store.appendHistory(root, {
    action: 'add', author: entry.author, command: `ui add ${banner}`,
    entry: { id: entry.id, banner, content },
  });
  return entry;
}

function editEntry(root, id, body) {
  const { config, state } = currentData(root);
  assertRevision(body.stateRevision, state, 'Context');
  const found = store.findEntry(state, id);
  if (!found) throw new UIError(404, `Entry not found: ${id}`);
  const content = requireText(body.content, 'Context');
  const banner = requireText(body.banner || found.bannerName, 'Banner', 80);
  if (!store.allBanners(config).includes(banner)) throw new UIError(400, `Unknown banner: ${banner}`);
  const previous = found.entry.content;
  const previousBanner = found.bannerName;
  const previousStatus = found.entry.status;
  if (content === previous && banner === previousBanner) return found.entry;

  found.entry.content = content;
  found.entry.updated = new Date().toISOString();
  if (found.entry.status !== 'pinned') found.entry.status = 'active';
  delete found.entry.decayed_at;
  delete found.entry.archived_at;
  if (banner !== previousBanner) {
    state.banners[previousBanner].entries = state.banners[previousBanner].entries.filter(item => item.id !== found.entry.id);
    state.banners[banner] ||= { entries: [] };
    state.banners[banner].entries.push(found.entry);
  }
  store.saveState(root, state);
  store.appendHistory(root, {
    action: 'edit', author: humanAuthor(), command: `ui edit ${found.entry.id}`,
    entry: {
      id: found.entry.id, banner, previousBanner, previous, content,
      oldStatus: previousStatus, newStatus: found.entry.status,
    },
  });
  return found.entry;
}

function transitionEntry(root, id, body) {
  const { state } = currentData(root);
  assertRevision(body.stateRevision, state, 'Context');
  const found = store.findEntry(state, id);
  if (!found) throw new UIError(404, `Entry not found: ${id}`);
  const action = body.action;
  const targets = { pin: 'pinned', unpin: 'active', archive: 'archived', restore: 'active' };
  const status = targets[action];
  if (!status) throw new UIError(400, `Unknown entry action: ${action}`);
  const oldStatus = found.entry.status;
  if (oldStatus === status) return found.entry;
  const now = new Date().toISOString();
  found.entry.status = status;
  found.entry.updated = now;
  if (status === 'archived') found.entry.archived_at = now;
  else delete found.entry.archived_at;
  if (status !== 'ambient') delete found.entry.decayed_at;
  store.saveState(root, state);
  store.appendHistory(root, {
    action, author: humanAuthor(), command: `ui ${action} ${found.entry.id}`,
    entry: { id: found.entry.id, banner: found.bannerName, content: found.entry.content, oldStatus, newStatus: status },
  });
  return found.entry;
}

function normalized(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function reviewProposal(root, id, body, decision) {
  if (hasActiveAgentSessions(root)) throw new UIError(409, 'End active agent sessions before reviewing proposals.');
  const { config, state, proposals } = currentData(root);
  assertRevision(body.proposalsRevision, proposals, 'Proposal queue');
  if (decision === 'approve') assertRevision(body.stateRevision, state, 'Context');
  const proposal = proposals.proposals.find(item => item.id === id || item.id.startsWith(id));
  if (!proposal) throw new UIError(404, `Proposal not found: ${id}`);
  const now = new Date().toISOString();
  const author = humanAuthor();

  if (decision === 'reject') {
    proposals.proposals = proposals.proposals.filter(item => item.id !== proposal.id);
    store.saveProposals(root, proposals);
    store.appendHistory(root, {
      action: 'reject', author, command: `ui reject ${proposal.id}`,
      proposal: { ...proposal, status: 'rejected', reviewed_at: now, reviewed_by: author },
    });
    return { proposal: proposal.id, decision };
  }

  const banner = requireText(body.banner || proposal.banner, 'Banner', 80);
  if (!store.allBanners(config).includes(banner)) throw new UIError(400, `Unknown banner: ${banner}`);
  const content = requireText(body.content || proposal.content, 'Context');
  const duplicate = entryList(state).find(entry => normalized(entry.content) === normalized(content));
  if (duplicate) throw new UIError(409, `Identical context already exists as [${duplicate.id}].`);
  const entry = {
    id: store.generateId(), status: 'active', content, author,
    created: now, updated: now, last_read: null, read_count: 0,
    proposal_id: proposal.id, source_session: proposal.session_id,
  };
  state.banners[banner] ||= { entries: [] };
  state.banners[banner].entries.push(entry);
  proposals.proposals = proposals.proposals.filter(item => item.id !== proposal.id);
  store.saveState(root, state);
  store.saveProposals(root, proposals);
  store.appendHistory(root, {
    action: 'approve', author, command: `ui approve ${proposal.id}`,
    proposal: { ...proposal, banner, content, status: 'approved', reviewed_at: now, reviewed_by: author, entry_id: entry.id },
    entry: { id: entry.id, banner, content },
  });
  return { proposal: proposal.id, decision, entry };
}

function saveSettings(root, body) {
  const { config, state } = currentData(root);
  assertRevision(body.configRevision, config, 'Configuration');
  assertRevision(body.stateRevision, state, 'Context');
  const decay = {};
  for (const key of ['activeToAmbientDays', 'readExtensionDays', 'maxReadExtensionDays', 'ambientToArchivedDays']) {
    const value = Number((body.decay || {})[key]);
    if (!Number.isFinite(value) || value < 0 || value > 3650) {
      throw new UIError(400, `${key} must be between 0 and 3650 days.`);
    }
    decay[key] = value;
  }
  const project = requireText(body.project, 'Project name', 120);
  const description = String(body.description || '').trim();
  if (description.length > 500) throw new UIError(400, 'Description must be 500 characters or fewer.');
  const previous = { project: config.project, description: config.description || '', decay: resolveDecayConfig(config) };
  config.project = project;
  config.description = description;
  config.decay = decay;
  state.project.name = project;
  state.project.description = description;
  store.saveConfig(root, config);
  store.saveState(root, state);
  store.appendHistory(root, {
    action: 'settings', author: humanAuthor(), command: 'ui settings',
    previous, settings: { project, description, decay },
  });
  return { project, description, decay };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new UIError(413, 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new UIError(400, 'Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendFile(res, pathname) {
  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  };
  const selected = files[pathname];
  if (!selected) throw new UIError(404, 'Not found.');
  const content = fs.readFileSync(path.join(PUBLIC_DIR, selected[0]));
  res.writeHead(200, {
    'Content-Type': selected[1],
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(content);
}

function authorized(req, token) {
  const supplied = String(req.headers['x-agenctx-token'] || '');
  const expected = Buffer.from(token);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createUIServer(root, { token = crypto.randomBytes(24).toString('hex') } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw new UIError(405, 'Method not allowed.');
        sendFile(res, url.pathname);
        return;
      }
      if (!authorized(req, token)) throw new UIError(401, 'Invalid or missing UI token.');
      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        sendJSON(res, 200, buildSnapshot(root));
        return;
      }

      const body = await readBody(req);
      let result;
      let match;
      if (req.method === 'POST' && url.pathname === '/api/entries') {
        result = addEntry(root, body);
      } else if (req.method === 'PATCH' && (match = url.pathname.match(/^\/api\/entries\/([^/]+)$/))) {
        result = editEntry(root, decodeURIComponent(match[1]), body);
      } else if (req.method === 'POST' && (match = url.pathname.match(/^\/api\/entries\/([^/]+)\/action$/))) {
        result = transitionEntry(root, decodeURIComponent(match[1]), body);
      } else if (req.method === 'POST' && (match = url.pathname.match(/^\/api\/proposals\/([^/]+)\/(approve|reject)$/))) {
        result = reviewProposal(root, decodeURIComponent(match[1]), body, match[2]);
      } else if (req.method === 'PUT' && url.pathname === '/api/settings') {
        result = saveSettings(root, body);
      } else {
        throw new UIError(404, 'API route not found.');
      }
      sendJSON(res, 200, { ok: true, result });
    } catch (err) {
      if (res.headersSent) return;
      const status = err.status || 500;
      sendJSON(res, status, { ok: false, error: status === 500 ? 'Unexpected UI server error.' : err.message });
      if (status === 500 && process.env.DEBUG) console.error(err);
    }
  });
  return { server, token };
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

function parsePort(args) {
  let raw = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--port=')) raw = args[i].slice(7);
    else if (args[i] === '--port' && args[i + 1]) raw = args[++i];
  }
  if (raw == null) return 0;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('UI port must be between 0 and 65535.');
  return port;
}

function startUI(args = []) {
  const root = store.requireRoot();
  const { server, token } = createUIServer(root);
  const port = parsePort(args);
  const noOpen = args.includes('--no-open');
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const url = `${base}/#token=${token}`;
    console.log(`\n  agenctx UI is running for ${path.basename(root)}`);
    console.log(`  ${base}`);
    console.log('  Localhost only · no telemetry · Ctrl+C to stop\n');
    if (!noOpen) openBrowser(url);
    else console.log(`  Open: ${url}\n`);
  });
  server.on('error', err => {
    console.error(`Could not start agenctx UI: ${err.message}`);
    process.exitCode = 1;
  });
  return server;
}

module.exports = { buildSnapshot, createUIServer, forecastFor, revision, startUI };
