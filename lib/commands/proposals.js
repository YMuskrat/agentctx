'use strict';

const store = require('../store');
const { c, truncate } = require('../format');
const { hasActiveAgentSessions, loadActiveSession } = require('./session');

const MAX_PER_SESSION = 2;
const MAX_PENDING = 20;

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

function normalizeContent(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function findProposal(data, id) {
  return data.proposals.find(item => item.id === id || item.id.startsWith(id));
}

function contextMatches(state, content) {
  const normalized = normalizeContent(content);
  for (const banner of Object.values(state.banners || {})) {
    for (const entry of banner.entries || []) {
      if (normalizeContent(entry.content) === normalized) return entry;
    }
  }
  return null;
}

function pendingContentMatches(data, content, exceptId = null) {
  const normalized = normalizeContent(content);
  return data.proposals.find(item =>
    item.status === 'pending'
    && item.id !== exceptId
    && normalizeContent(item.content) === normalized);
}

function requireHumanReview(root) {
  if (hasActiveAgentSessions(root)) {
    console.error(c.red('Agents cannot approve or reject context proposals.'));
    console.error('End the agent session, then review the proposal as a human.');
    process.exit(1);
  }
}

function propose(args) {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  const state = store.loadState(root);
  const session = loadActiveSession(root);

  if (!session || session.actor !== 'agent') {
    console.error(c.red('Context proposals require an active tracked agent session.'));
    console.error('Start one with: agenctx --agent start "task description"');
    process.exit(1);
  }

  let bannerName = null;
  const messageParts = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-m' || args[i] === '--message') && args[i + 1] != null) {
      messageParts.length = 0;
      messageParts.push(args[++i]);
    } else if (!args[i].startsWith('-') && !bannerName) {
      bannerName = args[i];
    } else if (!args[i].startsWith('-')) {
      messageParts.push(args[i]);
    }
  }

  if (!bannerName || !messageParts.length) {
    console.error(c.red('Usage: agenctx propose <banner> "durable project knowledge"'));
    process.exit(1);
  }

  bannerName = BANNER_ALIASES[bannerName] || bannerName;
  if (!store.allBanners(config).includes(bannerName)) {
    console.error(c.red(`Unknown banner: ${bannerName}`));
    console.error(`Available: ${store.allBanners(config).join(', ')}`);
    process.exit(1);
  }

  const content = messageParts.join(' ').trim();
  if (!content) {
    console.error(c.red('A proposal must contain durable project knowledge.'));
    process.exit(1);
  }

  const data = store.loadProposals(root);
  const sessionProposals = data.proposals.filter(item => item.session_id === session.id);
  if (sessionProposals.length >= MAX_PER_SESSION) {
    console.error(c.red(`This session has already submitted ${MAX_PER_SESSION} proposals.`));
    console.error('Do not add more. Most tasks should propose no context.');
    process.exit(1);
  }

  const pendingCount = data.proposals.filter(item => item.status === 'pending').length;
  if (pendingCount >= MAX_PENDING) {
    console.error(c.red(`The proposal queue already contains ${MAX_PENDING} pending items.`));
    console.error('A human must approve or reject existing proposals first.');
    process.exit(1);
  }

  const existingEntry = contextMatches(state, content);
  if (existingEntry) {
    console.error(c.red(`This context already exists as entry [${existingEntry.id}].`));
    process.exit(1);
  }
  const existingProposal = pendingContentMatches(data, content);
  if (existingProposal) {
    console.error(c.red(`An identical proposal is already pending as [${existingProposal.id}].`));
    process.exit(1);
  }

  const now = new Date().toISOString();
  const proposal = {
    id: `p-${store.generateId()}`,
    banner: bannerName,
    content,
    session_id: session.id,
    status: 'pending',
    created: now,
  };
  data.proposals.push(proposal);
  store.saveProposals(root, data);
  store.appendHistory(root, {
    action: 'propose',
    author: 'agent',
    command: `propose ${bannerName}`,
    proposal: { ...proposal },
  });

  console.log(`\n  ${c.green('✓')} Proposed ${c.bold(bannerName)} ${c.gray('[' + proposal.id + ']')}`);
  console.log(`  ${truncate(content, 70)}`);
  console.log(c.gray(`  Pending human review · ${sessionProposals.length + 1}/${MAX_PER_SESSION} proposals used this session`));
  console.log();
}

function list() {
  const root = store.requireRoot();
  const pending = store.loadProposals(root).proposals.filter(item => item.status === 'pending');

  console.log(`\n  ${c.bold('CONTEXT PROPOSALS')}  ${c.gray(`${pending.length} pending`)}\n`);
  if (!pending.length) {
    console.log(c.gray('  Nothing awaiting human review.\n'));
    return;
  }

  for (const item of pending) {
    console.log(`  ${c.yellow('PENDING')} ${c.gray('[' + item.id + ']')}  ${c.cyan(item.banner)}`);
    console.log(`          ${truncate(item.content, 68)}`);
    console.log(c.gray(`          from ${item.session_id} · ${item.created.slice(0, 10)}`));
  }
  console.log();
  console.log(c.gray('  Review: agenctx approve <id>  ·  agenctx reject <id>'));
  console.log();
}

function approve(args) {
  const root = store.requireRoot();
  requireHumanReview(root);
  const id = args.find(arg => !arg.startsWith('-'));
  if (!id) {
    console.error(c.red('Usage: agenctx approve <proposal-id>'));
    process.exit(1);
  }

  const data = store.loadProposals(root);
  const proposal = findProposal(data, id);
  if (!proposal) {
    console.error(c.red(`Proposal not found: ${id}`));
    process.exit(1);
  }
  if (proposal.status !== 'pending') {
    console.error(c.red(`Proposal [${proposal.id}] is already ${proposal.status}.`));
    process.exit(1);
  }

  const state = store.loadState(root);
  const duplicate = contextMatches(state, proposal.content);
  if (duplicate) {
    console.error(c.red(`This context already exists as entry [${duplicate.id}].`));
    console.error(`Reject the duplicate proposal with: agenctx reject ${proposal.id}`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const author = process.env.USER || process.env.USERNAME || 'user';
  const entry = {
    id: store.generateId(),
    status: 'active',
    content: proposal.content,
    author,
    created: now,
    updated: now,
    last_read: null,
    read_count: 0,
    proposal_id: proposal.id,
    source_session: proposal.session_id,
  };
  if (!state.banners[proposal.banner]) state.banners[proposal.banner] = { entries: [] };
  state.banners[proposal.banner].entries.push(entry);

  proposal.status = 'approved';
  proposal.reviewed_at = now;
  proposal.reviewed_by = author;
  proposal.entry_id = entry.id;
  data.proposals = data.proposals.filter(item => item.id !== proposal.id);
  store.saveState(root, state);
  store.saveProposals(root, data);
  store.appendHistory(root, {
    action: 'approve',
    author,
    command: `approve ${proposal.id}`,
    proposal: { ...proposal },
    entry: { id: entry.id, banner: proposal.banner, content: proposal.content },
  });

  console.log(`\n  ${c.green('✓')} Approved ${c.bold(proposal.banner)} ${c.gray('[' + proposal.id + ']')}`);
  console.log(`  Created trusted context ${c.gray('[' + entry.id + ']')}`);
  console.log();
}

function reject(args) {
  const root = store.requireRoot();
  requireHumanReview(root);
  const id = args.find(arg => !arg.startsWith('-'));
  if (!id) {
    console.error(c.red('Usage: agenctx reject <proposal-id>'));
    process.exit(1);
  }

  const data = store.loadProposals(root);
  const proposal = findProposal(data, id);
  if (!proposal) {
    console.error(c.red(`Proposal not found: ${id}`));
    process.exit(1);
  }
  if (proposal.status !== 'pending') {
    console.error(c.red(`Proposal [${proposal.id}] is already ${proposal.status}.`));
    process.exit(1);
  }

  const now = new Date().toISOString();
  const author = process.env.USER || process.env.USERNAME || 'user';
  proposal.status = 'rejected';
  proposal.reviewed_at = now;
  proposal.reviewed_by = author;
  data.proposals = data.proposals.filter(item => item.id !== proposal.id);
  store.saveProposals(root, data);
  store.appendHistory(root, {
    action: 'reject',
    author,
    command: `reject ${proposal.id}`,
    proposal: { ...proposal },
  });

  console.log(`\n  ${c.green('✓')} Rejected proposal ${c.gray('[' + proposal.id + ']')}`);
  console.log(c.gray('  It was removed from the pending queue and retained in audit history.'));
  console.log();
}

module.exports = {
  MAX_PER_SESSION,
  MAX_PENDING,
  approve,
  list,
  propose,
  reject,
};
