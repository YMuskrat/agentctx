'use strict';

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
}

function validate(envelope) {
  object(envelope, 'Export');
  if (envelope.format !== 'agenctx-export' || envelope.version !== 1) {
    throw new Error('Unsupported agenctx export format/version.');
  }
  object(envelope.data, 'Export data');
  if (envelope.kind !== 'context') throw new Error('Unsupported export kind.');
  const { config, state } = envelope.data;
  object(config, 'config');
  object(state, 'state');
  object(state.banners, 'state.banners');
  const ids = new Set();
  for (const [name, banner] of Object.entries(state.banners)) {
    object(banner, `banner ${name}`);
    if (!Array.isArray(banner.entries)) throw new Error(`banner ${name} needs entries.`);
    for (const entry of banner.entries) {
      object(entry, 'entry');
      if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) {
        throw new Error('Entry IDs must be nonempty and globally unique.');
      }
      ids.add(entry.id);
      if (typeof entry.content !== 'string') throw new Error(`Entry ${entry.id} needs string content.`);
      if (!['active', 'pinned', 'ambient', 'archived'].includes(entry.status)) {
        throw new Error(`Entry ${entry.id} has an unsupported status.`);
      }
    }
  }
  return envelope;
}

function encode(envelope) {
  return JSON.stringify(validate(envelope), null, 2) + '\n';
}

function decode(text) {
  return validate(JSON.parse(text.replace(/^\uFEFF/, '')));
}

function contextExport(config, state) {
  return decode(JSON.stringify({ format: 'agenctx-export', version: 1,
    kind: 'context', data: { config, state } }));
}

module.exports = { validate, encode, decode, contextExport };
