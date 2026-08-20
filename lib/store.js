'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENCTX_DIR = '.agenctx';
const DEFAULT_BANNERS = [
  'warnings', 'decisions', 'rules', 'testing',
  'env', 'packages', 'notes', 'refs', 'tasks', 'blockers',
];

const DEFAULT_BANNER_DESCRIPTIONS = {
  warnings: 'Critical gotchas and things that can break',
  decisions: 'Architectural choices and the reasoning behind them',
  rules: 'Repository conventions and required practices',
  testing: 'How to validate changes and satisfy CI',
  env: 'Environment variables and local configuration',
  packages: 'Dependencies, purposes, and version notes',
  notes: 'Useful implementation knowledge and how-tos',
  refs: 'Relevant documentation and external references',
  tasks: 'Current and upcoming work',
  blockers: 'Known constraints preventing progress',
};

function findRoot(start) {
  let dir = path.resolve(start || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(dir, AGENCTX_DIR))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function requireRoot() {
  const root = findRoot();
  if (!root) {
    console.error('Not in an agenctx project. Run: agenctx init');
    process.exit(1);
  }
  return root;
}

function agenctxDir(root) {
  return path.join(root, AGENCTX_DIR);
}

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid agenctx data in ${filePath}: ${err.message}`);
  }
}

function saveJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function loadConfig(root) {
  return loadJSON(path.join(agenctxDir(root), 'config.json'));
}

function saveConfig(root, config) {
  saveJSON(path.join(agenctxDir(root), 'config.json'), config);
}

function loadState(root) {
  return loadJSON(path.join(agenctxDir(root), 'state.json'));
}

function saveState(root, state) {
  state.updated = new Date().toISOString();
  saveJSON(path.join(agenctxDir(root), 'state.json'), state);
}

function loadProposals(root) {
  return loadJSON(path.join(agenctxDir(root), 'proposals.json')) || {
    version: 1,
    proposals: [],
  };
}

function saveProposals(root, proposals) {
  saveJSON(path.join(agenctxDir(root), 'proposals.json'), proposals);
}

function historyDir(root) {
  return path.join(agenctxDir(root), 'history');
}

function nextSeq(root) {
  const dir = historyDir(root);
  if (!fs.existsSync(dir)) return 1;
  const sequences = fs.readdirSync(dir)
    .map(f => f.match(/^(\d+)\.json$/))
    .filter(Boolean)
    .map(m => Number(m[1]));
  return sequences.length ? Math.max(...sequences) + 1 : 1;
}

function appendHistory(root, event) {
  const dir = historyDir(root);
  fs.mkdirSync(dir, { recursive: true });
  if (!event.timestamp) event.timestamp = new Date().toISOString();

  while (true) {
    const seq = nextSeq(root);
    event.seq = seq;
    const filename = String(seq).padStart(6, '0') + '.json';
    try {
      fs.writeFileSync(
        path.join(dir, filename),
        JSON.stringify(event, null, 2) + '\n',
        { encoding: 'utf8', flag: 'wx' },
      );
      return seq;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

function loadHistory(root, limit) {
  const dir = historyDir(root);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const toLoad = limit ? files.slice(-limit) : files;
  return toLoad.map(f => loadJSON(path.join(dir, f))).filter(Boolean);
}

function generateId() {
  return crypto.randomBytes(3).toString('hex');
}

function allBanners(config) {
  return [...new Set([...(config.banners || DEFAULT_BANNERS), ...(config.custom_banners || [])])];
}

function bannerDescription(config, bannerName) {
  return config.banner_descriptions?.[bannerName]
    || DEFAULT_BANNER_DESCRIPTIONS[bannerName]
    || 'Custom project context';
}

function findEntry(state, id) {
  for (const [bannerName, banner] of Object.entries(state.banners)) {
    const entry = banner.entries.find(e => e.id === id || e.id.startsWith(id));
    if (entry) return { entry, bannerName };
  }
  return null;
}

module.exports = {
  AGENCTX_DIR,
  DEFAULT_BANNERS,
  DEFAULT_BANNER_DESCRIPTIONS,
  findRoot,
  requireRoot,
  agenctxDir,
  loadConfig,
  saveConfig,
  loadState,
  saveState,
  loadProposals,
  saveProposals,
  appendHistory,
  loadHistory,
  generateId,
  allBanners,
  bannerDescription,
  findEntry,
};
