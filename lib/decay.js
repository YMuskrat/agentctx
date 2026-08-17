'use strict';

const store = require('./store');

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS = Object.freeze({
  activeToAmbientDays: 30,
  readExtensionDays: 3,
  maxReadExtensionDays: 60,
  ambientToArchivedDays: 60,
});

function resolveDecayConfig(config) {
  const configured = config?.decay || {};
  const resolved = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = Number(configured[key]);
    resolved[key] = Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  return resolved;
}

function asTime(value) {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function daysBetween(earlier, later = new Date()) {
  const start = asTime(earlier);
  const end = asTime(later);
  if (start == null || end == null) return Infinity;
  return Math.max(0, (end - start) / DAY_MS);
}

function activeRetentionDays(entry, config) {
  const cfg = resolveDecayConfig(config);
  const reads = Math.max(0, Number(entry.read_count) || 0);
  const extension = Math.min(
    cfg.maxReadExtensionDays,
    reads * cfg.readExtensionDays,
  );
  return cfg.activeToAmbientDays + extension;
}

function activeAnchor(entry) {
  const candidates = [entry.last_read, entry.updated, entry.created]
    .map(value => ({ value, time: asTime(value) }))
    .filter(item => item.time != null)
    .sort((a, b) => b.time - a.time);
  return candidates[0]?.value || null;
}

function runDecay(state, config, options = {}) {
  const cfg = resolveDecayConfig(config);
  const decayed = [];
  const archived = [];
  const nowDate = options.now ? new Date(options.now) : new Date();
  const now = nowDate.toISOString();
  const skipIds = new Set(options.skipIds || []);

  for (const [bannerName, banner] of Object.entries(state.banners)) {
    for (const entry of banner.entries) {
      if (entry.status === 'pinned' || entry.status === 'archived' || skipIds.has(entry.id)) continue;

      if (entry.status === 'active') {
        const inactiveDays = daysBetween(activeAnchor(entry), nowDate);
        const retentionDays = activeRetentionDays(entry, config);

        if (inactiveDays > retentionDays) {
          entry.status = 'ambient';
          entry.decayed_at = now;
          entry.updated = now;
          decayed.push({
            id: entry.id,
            banner: bannerName,
            content: entry.content,
            oldStatus: 'active',
            newStatus: 'ambient',
            inactiveDays: Math.floor(inactiveDays),
            retentionDays,
            reason: `inactive for ${Math.floor(inactiveDays)}d`,
          });
        }
      } else if (entry.status === 'ambient') {
        const ambientDays = daysBetween(entry.decayed_at || activeAnchor(entry), nowDate);
        if (ambientDays > cfg.ambientToArchivedDays) {
          entry.status = 'archived';
          entry.archived_at = now;
          entry.updated = now;
          archived.push({
            id: entry.id,
            banner: bannerName,
            content: entry.content,
            oldStatus: 'ambient',
            newStatus: 'archived',
            ambientDays: Math.floor(ambientDays),
            reason: `ambient for ${Math.floor(ambientDays)}d`,
          });
        }
      }
    }
  }

  return { decayed, archived };
}

function appendTransition(root, action, transition) {
  store.appendHistory(root, {
    action,
    author: 'agenctx-lifecycle',
    command: 'lifecycle auto',
    entry: {
      id: transition.id,
      banner: transition.banner,
      content: transition.content,
      oldStatus: transition.oldStatus,
      newStatus: transition.newStatus,
    },
    reason: transition.reason,
  });
}

function applyLifecycle(root, state, config, options = {}) {
  const result = runDecay(state, config, options);
  if (!result.decayed.length && !result.archived.length) return result;

  store.saveState(root, state);
  for (const transition of result.decayed) appendTransition(root, 'decay', transition);
  for (const transition of result.archived) appendTransition(root, 'auto_archive', transition);
  return result;
}

module.exports = {
  DEFAULTS,
  activeAnchor,
  activeRetentionDays,
  applyLifecycle,
  daysBetween,
  resolveDecayConfig,
  runDecay,
};
