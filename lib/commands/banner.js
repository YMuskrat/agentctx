'use strict';
const store = require('../store');
const { c } = require('../format');

function normalizeName(name) {
  const normalized = (name || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    console.error(c.red('Banner names may contain lowercase letters, numbers, and hyphens.'));
    process.exit(1);
  }
  return normalized;
}

function add(args) {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  const state = store.loadState(root);
  const name = normalizeName(args.find(arg => !arg.startsWith('-')));
  let description = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--description=')) description = args[i].slice(14);
    else if ((args[i] === '--description' || args[i] === '-d') && args[i + 1]) description = args[++i];
  }
  if (!description.trim()) {
    console.error(c.red('A description tells agents when this context type is relevant.'));
    console.error('Usage: agenctx banner add <name> --description="purpose"');
    process.exit(1);
  }

  const isDefault = (config.banners || store.DEFAULT_BANNERS).includes(name);
  config.custom_banners = config.custom_banners || [];
  if (!isDefault && !config.custom_banners.includes(name)) config.custom_banners.push(name);
  config.banner_descriptions = config.banner_descriptions || {};
  config.banner_descriptions[name] = description.trim();
  if (!state.banners[name]) state.banners[name] = { entries: [] };
  store.saveConfig(root, config);
  store.saveState(root, state);
  store.appendHistory(root, {
    action: 'banner',
    author: process.env.USER || process.env.USERNAME || 'user',
    command: `banner add ${name}`,
    banner: { name, description: description.trim() },
  });
  console.log(`${c.green('✓')} ${c.bold(name)}: ${description.trim()}`);
}

function list() {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  console.log(`\n  ${c.bold('Context types')}\n`);
  for (const name of store.allBanners(config)) {
    console.log(`  ${c.cyan(name.padEnd(15))} ${store.bannerDescription(config, name)}`);
  }
  console.log();
}

function banner(args) {
  const sub = args[0];
  if (sub === 'add') add(args.slice(1));
  else if (!sub || sub === 'list') list();
  else {
    console.error(c.red(`Unknown banner command: ${sub}`));
    console.error('Available: banner list, banner add');
    process.exit(1);
  }
}

module.exports = { banner };
