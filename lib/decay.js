'use strict';

const DEFAULTS = {
  activeToAmbientDays: 30,
  activeToAmbientMaxReads: 5,
  ambientToArchivedDays: 60,
  staysActiveMinReads: 20,
};

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

function runDecay(state, config) {
  const cfg = { ...DEFAULTS, ...(config?.decay || {}) };
  const decayed = [];
  const archived = [];
  const now = new Date().toISOString();

  for (const [bannerName, banner] of Object.entries(state.banners)) {
    for (const entry of banner.entries) {
      if (entry.status === 'pinned' || entry.status === 'archived') continue;

      const daysSinceRead = daysSince(entry.last_read || entry.created);
      const readCount = entry.read_count || 0;

      if (entry.status === 'active') {
        // High-read entries stay active
        if (readCount >= cfg.staysActiveMinReads) continue;

        if (daysSinceRead > cfg.activeToAmbientDays && readCount < cfg.activeToAmbientMaxReads) {
          entry.status = 'ambient';
          entry.decayed_at = now;
          decayed.push({
            id: entry.id,
            banner: bannerName,
            content: entry.content,
            reason: `no reads in ${Math.floor(daysSinceRead)}d`,
          });
        }
      } else if (entry.status === 'ambient') {
        const daysAmbient = daysSince(entry.decayed_at || entry.last_read || entry.created);
        if (daysAmbient > cfg.ambientToArchivedDays) {
          entry.status = 'archived';
          entry.archived_at = now;
          archived.push({
            id: entry.id,
            banner: bannerName,
            content: entry.content,
            reason: `ambient for ${Math.floor(daysAmbient)}d`,
          });
        }
      }
    }
  }

  return { decayed, archived };
}

module.exports = { runDecay };
