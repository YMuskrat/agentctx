'use strict';

const app = {
  token: '',
  data: null,
  view: 'context',
  selectedEntry: null,
  selectedSession: null,
  banner: 'warnings',
  status: 'visible',
  query: '',
  sessionQuery: '',
  sessionStatus: 'all',
  modalMode: 'add',
  proposal: null,
};

const titles = {
  context: ['Context entries', 'Context'],
  review: ['Needs your attention', 'Review'],
  sessions: ['Agent activity', 'Agent sessions'],
  settings: ['Repository settings', 'Settings'],
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function add(parent, ...children) {
  for (const child of children) if (child) parent.appendChild(child);
  return parent;
}

function button(label, className, handler) {
  const element = node('button', className || 'button', label);
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
}

function empty(message) {
  return node('div', 'empty', message);
}

function formatDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function relative(value) {
  if (!value) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function truncate(value, limit = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function statusPill(status) {
  return node('span', `status ${status}`, status);
}

function showToast(message, error = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast${error ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Agenctx-Token': app.token,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

async function refresh({ quiet = false } = {}) {
  if (!quiet) document.getElementById('refresh').disabled = true;
  try {
    app.data = await api('/api/snapshot');
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-state').classList.add('hidden');
    document.getElementById('view').classList.remove('hidden');
    document.getElementById('repo-name').textContent = app.data.project.name;
    document.getElementById('repo-stack').textContent = (app.data.project.stack || []).join(' · ') || 'Agenctx repository';
    document.getElementById('updated-at').textContent = `Updated ${relative(app.data.generatedAt)}`;
    document.getElementById('review-count').textContent = app.data.proposals.length + app.data.counts.ambient;
    if (!app.selectedEntry || !app.data.entries.some(item => item.id === app.selectedEntry)) {
      app.selectedEntry = app.data.entries[0]?.id || null;
    }
    if (!app.selectedSession || !app.data.sessions.some(item => item.id === app.selectedSession)) {
      app.selectedSession = app.data.sessions[0]?.id || null;
    }
    render();
  } catch (error) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('view').classList.add('hidden');
    document.getElementById('error-state').classList.remove('hidden');
    document.getElementById('error-message').textContent = error.message;
  } finally {
    document.getElementById('refresh').disabled = false;
  }
}

async function mutate(path, method, body, success) {
  try {
    await api(path, { method, body: JSON.stringify(body) });
    showToast(success);
    await refresh({ quiet: true });
  } catch (error) {
    showToast(error.message, true);
    if (/changed outside this browser/i.test(error.message)) await refresh({ quiet: true });
    throw error;
  }
}

function render() {
  const [eyebrow, title] = titles[app.view];
  document.getElementById('page-eyebrow').textContent = eyebrow;
  document.getElementById('page-title').textContent = title;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === app.view));
  const target = document.getElementById('view');
  target.replaceChildren();
  const views = { context: renderContext, review: renderReview, sessions: renderSessions, settings: renderSettings };
  views[app.view](target);
}

function panel(title, copy) {
  const result = node('section', 'panel');
  const head = node('div', 'panel-head');
  const text = node('div');
  add(text, node('h2', '', title), node('p', '', copy));
  add(head, text);
  result.appendChild(head);
  return { panel: result, head };
}

function go(view) {
  app.view = view;
  render();
}

function renderContext(target) {
  const selectedBanner = app.data.banners.find(item => item.name === app.banner);
  const bannerHead = node('div', 'context-banner-head');
  const bannerCopy = node('div');
  add(bannerCopy,
    node('span', 'label', selectedBanner ? 'Selected banner' : 'Repository context'),
    node('h2', '', selectedBanner ? selectedBanner.name : 'All context'),
    node('p', 'muted', selectedBanner ? selectedBanner.description : 'Browse context across every banner. Select one banner to add context.'),
  );
  bannerHead.appendChild(bannerCopy);
  if (selectedBanner) {
    bannerHead.appendChild(button(`+ Add to ${selectedBanner.name}`, 'button primary', () => openEntryModal()));
  }
  target.appendChild(bannerHead);

  const toolbar = node('div', 'toolbar');
  const search = node('input');
  search.type = 'search'; search.placeholder = 'Search context, IDs, or authors…'; search.value = app.query;
  search.addEventListener('input', () => { app.query = search.value; renderContextBody(target); });
  const status = node('select');
  for (const [value, label] of [['visible', 'Visible context'], ['all', 'All states'], ['pinned', 'Pinned'], ['active', 'Active'], ['ambient', 'Ambient'], ['archived', 'Archived']]) {
    const option = node('option', '', label); option.value = value; option.selected = app.status === value; status.appendChild(option);
  }
  status.addEventListener('change', () => { app.status = status.value; renderContextBody(target); });
  add(toolbar, search, status);
  target.appendChild(toolbar);
  const body = node('div'); body.id = 'context-body'; target.appendChild(body);
  renderContextBody(target);
}

function filteredEntries() {
  const query = app.query.trim().toLowerCase();
  return app.data.entries.filter(entry => {
    const bannerMatch = app.banner === 'all' || entry.banner === app.banner;
    const statusMatch = app.status === 'all'
      || (app.status === 'visible' && ['pinned', 'active'].includes(entry.status))
      || entry.status === app.status;
    const queryMatch = !query || `${entry.id} ${entry.banner} ${entry.author} ${entry.content}`.toLowerCase().includes(query);
    return bannerMatch && statusMatch && queryMatch;
  });
}

function renderContextBody(target) {
  const previous = document.getElementById('context-body');
  if (!previous) return;
  const layout = node('div', 'context-layout');
  const banners = node('div', 'banner-list');
  const allButton = node('button', `banner-button${app.banner === 'all' ? ' active' : ''}`);
  allButton.type = 'button'; add(allButton, node('span', '', 'All banners'), node('b', '', String(app.data.entries.length)));
  allButton.addEventListener('click', () => { app.banner = 'all'; render(); });
  banners.appendChild(allButton);
  for (const banner of app.data.banners) {
    const item = node('button', `banner-button${app.banner === banner.name ? ' active' : ''}`);
    item.type = 'button'; add(item, node('span', '', banner.name), node('b', '', String(banner.entries.length)));
    item.title = banner.description;
    item.addEventListener('click', () => { app.banner = banner.name; render(); });
    banners.appendChild(item);
  }

  const entries = filteredEntries();
  if (!entries.some(item => item.id === app.selectedEntry)) app.selectedEntry = entries[0]?.id || null;
  const list = node('div', 'entry-list');
  if (!entries.length) list.appendChild(empty('No context matches these filters.'));
  for (const entry of entries) {
    const row = node('article', `entry-row${entry.id === app.selectedEntry ? ' selected' : ''}`);
    const meta = node('div', 'entry-meta');
    add(meta, statusPill(entry.status), node('span', '', entry.banner), node('span', '', `[${entry.id}]`));
    add(row, meta, node('p', '', truncate(entry.content, 150)), node('div', 'row-meta', `${entry.read_count || 0} full reads · updated ${relative(entry.updated)}`));
    row.addEventListener('click', () => { app.selectedEntry = entry.id; renderContextBody(target); });
    list.appendChild(row);
  }
  const selected = app.data.entries.find(item => item.id === app.selectedEntry);
  add(layout, banners, list, renderEntryDetail(selected));
  previous.replaceWith(layout);
  layout.id = 'context-body';
}

function renderEntryDetail(entry) {
  const detail = node('aside', 'panel detail-panel');
  if (!entry) { detail.appendChild(empty('Select an entry to inspect it.')); return detail; }
  const head = node('div', 'panel-head');
  const title = node('div'); add(title, statusPill(entry.status), node('h2', '', entry.banner), node('p', '', `[${entry.id}]`));
  add(head, title, button('Edit', 'button small ghost', () => openEntryModal(entry)));
  const content = node('div', 'detail-content', entry.content);
  const facts = node('div', 'detail-grid');
  const values = [
    ['Author', entry.author || 'user'], ['Created', formatDate(entry.created, false)],
    ['Last full read', entry.last_read ? relative(entry.last_read) : 'Never'], ['Full reads', String(entry.read_count || 0)],
  ];
  for (const [label, value] of values) { const item = node('div'); add(item, node('span', '', label), node('strong', '', value)); facts.appendChild(item); }
  const actions = node('div', 'detail-actions');
  if (entry.status === 'pinned') actions.appendChild(button('Unpin', 'button small ghost', () => entryAction(entry, 'unpin')));
  else if (entry.status !== 'archived') actions.appendChild(button('Pin', 'button small ghost', () => entryAction(entry, 'pin')));
  if (entry.status === 'archived') actions.appendChild(button('Restore', 'button small', () => entryAction(entry, 'restore')));
  else actions.appendChild(button('Archive', 'button small danger', () => entryAction(entry, 'archive', true)));
  add(detail, head, content, facts, actions);
  return detail;
}

async function entryAction(entry, action, confirmFirst = false) {
  if (confirmFirst && !window.confirm(`Archive [${entry.id}]? It will stop being served to agents.`)) return;
  await mutate(`/api/entries/${encodeURIComponent(entry.id)}/action`, 'POST', {
    action, stateRevision: app.data.revisions.state,
  }, `${action[0].toUpperCase()}${action.slice(1)} complete.`).catch(() => {});
}

function renderReview(target) {
  const proposals = node('section', 'review-section');
  const proposalTitle = node('div', 'review-title'); add(proposalTitle, node('h2', '', 'Agent proposals'), node('span', '', `${app.data.proposals.length} pending`));
  const proposalList = node('div', 'review-list');
  if (!app.data.proposals.length) proposalList.appendChild(empty('No agent proposals await review.'));
  for (const proposal of app.data.proposals) {
    const card = node('article', 'review-card');
    const copy = node('div');
    const meta = node('div', 'entry-meta'); add(meta, node('span', 'status ambient', 'pending'), node('span', '', proposal.banner), node('span', '', `[${proposal.id}]`));
    add(copy, meta, node('p', '', proposal.content), node('div', 'row-meta', `Session ${proposal.session_id} · ${formatDate(proposal.created)}`));
    const actions = node('div', 'review-actions');
    add(actions,
      button('Edit & approve', 'button small primary', () => openProposalModal(proposal)),
      button('Reject', 'button small danger', () => rejectProposal(proposal)),
    );
    add(card, copy, actions); proposalList.appendChild(card);
  }
  add(proposals, proposalTitle, proposalList);

  const ambient = app.data.entries.filter(item => item.status === 'ambient');
  const lifecycle = node('section', 'review-section');
  const lifeTitle = node('div', 'review-title'); add(lifeTitle, node('h2', '', 'Ambient review'), node('span', '', `${ambient.length} waiting`));
  const ambientList = node('div', 'review-list');
  if (!ambient.length) ambientList.appendChild(empty('No context is waiting in ambient review.'));
  for (const entry of ambient) {
    const detail = app.data.forecast.details.find(item => item.id === entry.id);
    const card = node('article', 'review-card');
    const copy = node('div');
    const meta = node('div', 'entry-meta'); add(meta, statusPill('ambient'), node('span', '', entry.banner), node('span', '', `[${entry.id}]`));
    add(copy, meta, node('p', '', entry.content), node('div', 'row-meta', `${entry.read_count || 0} full reads · archives in ${detail?.days ?? '—'} days`));
    const actions = node('div', 'review-actions');
    add(actions,
      button('Restore', 'button small', () => entryAction(entry, 'restore')),
      button('Pin', 'button small ghost', () => entryAction(entry, 'pin')),
      button('Archive now', 'button small danger', () => entryAction(entry, 'archive', true)),
    );
    add(card, copy, actions); ambientList.appendChild(card);
  }
  add(lifecycle, lifeTitle, ambientList);
  add(target, proposals, lifecycle);
}

async function rejectProposal(proposal) {
  if (!window.confirm(`Reject proposal [${proposal.id}]?`)) return;
  await mutate(`/api/proposals/${encodeURIComponent(proposal.id)}/reject`, 'POST', {
    proposalsRevision: app.data.revisions.proposals,
  }, 'Proposal rejected.').catch(() => {});
}

function sessionStatusLabel(session) {
  return session.active ? 'Live' : session.integrity === false ? 'Invalid' : 'Valid';
}

function sessionRow(session, target) {
  const row = node('article', `session-row${session.id === app.selectedSession ? ' selected' : ''}`);
  const top = node('div', 'session-top');
  add(top, node('span', session.active ? 'integrity live' : 'integrity', sessionStatusLabel(session)), node('span', 'muted', formatDate(session.started)));
  add(row, top,
    node('p', '', truncate(session.description || 'Untitled agent task', 135)),
    node('div', 'row-meta', `${session.duration || 'in progress'} · ${session.delivery.preview} preview · ${session.delivery.full} full`));
  row.addEventListener('click', () => { app.selectedSession = session.id; renderSessionsBody(target); });
  return row;
}

function filteredSessions() {
  const query = app.sessionQuery.trim().toLowerCase();
  return app.data.sessions.filter(session => {
    const statusMatch = app.sessionStatus === 'all' || sessionStatusLabel(session).toLowerCase() === app.sessionStatus;
    const queryMatch = !query || `${session.id} ${session.description || ''}`.toLowerCase().includes(query);
    return statusMatch && queryMatch;
  });
}

function renderSessions(target) {
  const toolbar = node('div', 'toolbar');
  const search = node('input');
  search.type = 'search'; search.placeholder = 'Search sessions by description or ID…'; search.value = app.sessionQuery;
  search.addEventListener('input', () => { app.sessionQuery = search.value; renderSessionsBody(target); });
  const status = node('select');
  for (const [value, label] of [['all', 'All statuses'], ['live', 'Live'], ['valid', 'Valid'], ['invalid', 'Invalid']]) {
    const option = node('option', '', label); option.value = value; option.selected = app.sessionStatus === value; status.appendChild(option);
  }
  status.addEventListener('change', () => { app.sessionStatus = status.value; renderSessionsBody(target); });
  add(toolbar, search, status);
  target.appendChild(toolbar);
  const body = node('div'); body.id = 'sessions-body'; target.appendChild(body);
  renderSessionsBody(target);
}

function renderSessionsBody(target) {
  const previous = document.getElementById('sessions-body');
  if (!previous) return;
  const layout = node('div', 'sessions-layout');
  const list = node('div', 'session-list');
  const sessions = filteredSessions();
  if (!app.data.sessions.length) list.appendChild(empty('No agent sessions have been recorded yet.'));
  else if (!sessions.length) list.appendChild(empty('No sessions match these filters.'));
  if (!sessions.some(item => item.id === app.selectedSession)) app.selectedSession = sessions[0]?.id || null;
  for (const session of sessions) list.appendChild(sessionRow(session, target));
  const selected = app.data.sessions.find(item => item.id === app.selectedSession);
  add(layout, list, renderTrace(selected));
  layout.id = 'sessions-body';
  previous.replaceWith(layout);
}

function renderTrace(session) {
  const detail = node('section', 'panel');
  if (!session) { detail.appendChild(empty('Select a session to inspect its receipt.')); return detail; }
  const head = node('div', 'trace-head');
  add(head, node('span', 'label', session.active ? 'Active agent session' : 'Sealed receipt'), node('h2', '', session.description || 'Untitled task'));
  const summary = node('div', 'trace-summary');
  for (const [label, value] of [['Started', formatDate(session.started)], ['Duration', session.duration || 'In progress'], ['Preview', String(session.delivery.preview)], ['Full', String(session.delivery.full)]]) {
    const item = node('div'); add(item, node('span', '', label), node('strong', '', value)); summary.appendChild(item);
  }
  head.appendChild(summary);
  const receiptId = session.hash || session.id;
  const hash = node('div', 'hash', `Receipt ${receiptId.length > 16 ? `${receiptId.slice(0, 16)}…` : receiptId}`);
  hash.title = receiptId;
  head.appendChild(hash);
  detail.appendChild(head);
  if (session.delivery.preview > 0 && session.delivery.full === 0) {
    detail.appendChild(node('div', 'trace-warning', 'Preview-only trace: context was discovered, but no entry was retrieved in full. This does not prove whether context was relevant or followed.'));
  }
  const timeline = node('div', 'timeline');
  if (!(session.served || []).length) timeline.appendChild(empty('Nothing has been served in this session.'));
  for (const event of session.served || []) {
    const entries = event.entries || [];
    const hasFull = entries.some(item => item.mode === 'full');
    const item = node('details', `trace-event${hasFull ? ' full' : ''}`);
    const summaryLine = node('summary');
    const mode = hasFull ? 'FULL' : entries.length ? 'PREVIEW' : String(event.kind || 'EVENT').toUpperCase();
    add(summaryLine, node('span', `mode${hasFull ? ' full' : ''}`, mode), node('strong', '', event.command || event.kind || 'context'), node('span', 'muted', ` · ${formatDate(event.at)}`));
    item.appendChild(summaryLine);
    const content = entries.length
      ? entries.map(entry => `[${entry.banner || 'context'}:${entry.id}] ${entry.content || ''}`).join('\n\n')
      : event.project ? `${event.project.name}${event.project.description ? ` — ${event.project.description}` : ''}` : 'No entry content in this response.';
    item.appendChild(node('pre', '', content)); timeline.appendChild(item);
  }
  detail.appendChild(timeline);
  detail.appendChild(node('p', 'muted', 'Receipts prove what Agenctx served, not whether the agent understood or followed it.'));
  return detail;
}

function renderSettings(target) {
  const layout = node('div', 'settings-grid');
  const formPanel = panel('Repository settings', 'Changes are written to .agenctx/config.json and recorded in audit history.');
  const form = node('form', 'settings-form');
  const projectLabel = node('label', '', 'Project name'); const project = node('input'); project.name = 'project'; project.value = app.data.config.project;
  projectLabel.appendChild(project);
  const descriptionLabel = node('label', '', 'Description'); const description = node('textarea'); description.name = 'description'; description.rows = 3; description.maxLength = 500; description.value = app.data.config.description;
  descriptionLabel.appendChild(description);
  const decay = node('div', 'decay-grid');
  const fields = [
    ['activeToAmbientDays', 'Unread active period'], ['readExtensionDays', 'Days added per full read'],
    ['maxReadExtensionDays', 'Maximum read bonus'], ['ambientToArchivedDays', 'Ambient review period'],
  ];
  for (const [name, label] of fields) {
    const wrapper = node('label', '', label); const input = node('input'); input.type = 'number'; input.name = name; input.min = '0'; input.max = '3650'; input.required = true; input.value = app.data.config.decay[name]; wrapper.appendChild(input); decay.appendChild(wrapper);
  }
  add(form, projectLabel, descriptionLabel, decay, button('Save settings', 'button primary', () => {}));
  form.lastChild.type = 'submit';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const nextDecay = {};
    for (const [name] of fields) nextDecay[name] = Number(values[name]);
    await mutate('/api/settings', 'PUT', {
      project: values.project, description: values.description, decay: nextDecay,
      configRevision: app.data.revisions.config, stateRevision: app.data.revisions.state,
    }, 'Settings saved.').catch(() => {});
  });
  formPanel.panel.appendChild(form);

  const explanation = panel('How decay will behave', 'A plain-language preview of the current policy.');
  const d = app.data.config.decay;
  const copy = node('div', 'settings-note');
  add(copy,
    node('p', '', `An unread entry remains active for ${d.activeToAmbientDays} days.`),
    node('p', '', `Each full read adds ${d.readExtensionDays} days, up to a ${d.maxReadExtensionDays}-day bonus.`),
    node('p', '', `Ambient context remains available for human review for ${d.ambientToArchivedDays} days before archival.`),
    node('p', '', 'Pinned entries are protected indefinitely. Archived entries remain retained and restorable.'),
  );
  explanation.panel.appendChild(copy);
  add(layout, formPanel.panel, explanation.panel); target.appendChild(layout);
}

function fillBannerSelect(selected) {
  const select = document.getElementById('entry-banner');
  select.replaceChildren();
  for (const banner of app.data.banners) {
    const option = node('option', '', `${banner.name} — ${banner.description}`);
    option.value = banner.name; option.selected = banner.name === selected; select.appendChild(option);
  }
}

function openEntryModal(entry = null) {
  app.modalMode = entry ? 'edit' : 'add'; app.proposal = null;
  document.getElementById('modal-title').textContent = entry ? 'Edit context' : 'Add context';
  document.getElementById('entry-id').value = entry?.id || '';
  document.getElementById('entry-content').value = entry?.content || '';
  document.getElementById('entry-pinned').checked = entry?.status === 'pinned';
  document.getElementById('pin-field').classList.toggle('hidden', Boolean(entry));
  fillBannerSelect(entry?.banner || (app.banner !== 'all' ? app.banner : app.data.banners[0]?.name));
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('entry-content').focus();
}

function openProposalModal(proposal) {
  app.modalMode = 'proposal'; app.proposal = proposal;
  document.getElementById('modal-title').textContent = 'Edit and approve proposal';
  document.getElementById('entry-id').value = proposal.id;
  document.getElementById('entry-content').value = proposal.content;
  document.getElementById('pin-field').classList.add('hidden');
  fillBannerSelect(proposal.banner);
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('entry-content').focus();
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  app.proposal = null;
}

async function submitEntry(event) {
  event.preventDefault();
  const content = document.getElementById('entry-content').value;
  const banner = document.getElementById('entry-banner').value;
  try {
    if (app.modalMode === 'add') {
      await mutate('/api/entries', 'POST', { content, banner, pinned: document.getElementById('entry-pinned').checked, stateRevision: app.data.revisions.state }, 'Context added.');
    } else if (app.modalMode === 'edit') {
      const id = document.getElementById('entry-id').value;
      await mutate(`/api/entries/${encodeURIComponent(id)}`, 'PATCH', { content, banner, stateRevision: app.data.revisions.state }, 'Context updated.');
    } else {
      await mutate(`/api/proposals/${encodeURIComponent(app.proposal.id)}/approve`, 'POST', {
        content, banner, stateRevision: app.data.revisions.state, proposalsRevision: app.data.revisions.proposals,
      }, 'Proposal approved into trusted context.');
    }
    closeModal();
  } catch {}
}

function initializeToken() {
  const requestedView = new URLSearchParams(location.search).get('view');
  if (requestedView && titles[requestedView]) app.view = requestedView;
  const params = new URLSearchParams(location.hash.slice(1));
  const fromHash = params.get('token');
  if (fromHash) {
    sessionStorage.setItem('agenctx-ui-token', fromHash);
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
  app.token = fromHash || sessionStorage.getItem('agenctx-ui-token') || '';
  return Boolean(app.token);
}

document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => go(item.dataset.view)));
document.getElementById('refresh').addEventListener('click', () => refresh());
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('entry-form').addEventListener('submit', submitEntry);
document.getElementById('modal').addEventListener('click', event => { if (event.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });

if (!initializeToken()) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error-state').classList.remove('hidden');
  document.getElementById('error-message').textContent = 'Missing launch token. Stop this server and run agenctx ui again.';
} else {
  refresh();
}
