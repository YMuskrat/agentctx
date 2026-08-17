'use strict';

const readline = require('readline');
const store = require('../store');
const { c, truncate } = require('../format');

const BANNER_ALIASES = {
  warn: 'warnings',
  warning: 'warnings',
  decision: 'decisions',
  dec: 'decisions',
  rule: 'rules',
  test: 'testing',
  package: 'packages',
  pkg: 'packages',
  note: 'notes',
  ref: 'refs',
  reference: 'refs',
  task: 'tasks',
  blocker: 'blockers',
  block: 'blockers',
};

function confirmClear(message) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${message} [y/N] `, answer => {
      rl.close();
      resolve(/^y(?:es)?$/i.test(answer.trim()));
    });
  });
}

function entryCount(state) {
  return Object.values(state.banners)
    .reduce((total, banner) => total + (banner.entries || []).length, 0);
}

async function clearContext(args) {
  const root = store.requireRoot();
  const config = store.loadConfig(root);
  const state = store.loadState(root);
  const force = args.includes('--force');
  let target = args.includes('--all') ? 'all' : args.find(arg => !arg.startsWith('-'));

  if (!target) {
    console.error(c.red('Usage: agenctx clear <id|banner|all> [--force]'));
    process.exit(1);
  }

  target = BANNER_ALIASES[target] || target;
  const banners = store.allBanners(config);
  let scope;
  let removed;
  let message;

  if (target === 'all') {
    const count = entryCount(state);
    if (!count) {
      console.log(c.gray('\n  Live context is already empty.\n'));
      return;
    }
    scope = { type: 'all', target: 'all', count };
    message = `Clear all ${count} entries from live context?`;
  } else if (banners.includes(target)) {
    const entries = state.banners[target]?.entries || [];
    if (!entries.length) {
      console.log(c.gray(`\n  ${target} is already empty.\n`));
      return;
    }
    scope = { type: 'banner', target, count: entries.length };
    message = `Clear ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${target}?`;
  } else {
    const result = store.findEntry(state, target);
    if (!result) {
      console.error(c.red(`Entry or banner not found: ${target}`));
      process.exit(1);
    }
    scope = { type: 'entry', target: result.entry.id, banner: result.bannerName, count: 1 };
    message = `Clear [${result.entry.id}] ${truncate(result.entry.content, 55)}?`;
  }

  if (!force) {
    if (!process.stdin.isTTY) {
      console.error(c.red('Clear requires confirmation. Use --force for non-interactive execution.'));
      process.exit(1);
    }
    const confirmed = await confirmClear(message);
    if (!confirmed) {
      console.log(c.gray('\n  Clear cancelled.\n'));
      return;
    }
  }

  if (scope.type === 'all') {
    removed = Object.entries(state.banners).flatMap(([banner, data]) =>
      (data.entries || []).map(entry => ({ id: entry.id, banner, status: entry.status })));
    for (const banner of Object.values(state.banners)) banner.entries = [];
  } else if (scope.type === 'banner') {
    removed = (state.banners[scope.target]?.entries || [])
      .map(entry => ({ id: entry.id, banner: scope.target, status: entry.status }));
    state.banners[scope.target].entries = [];
  } else {
    const entries = state.banners[scope.banner].entries;
    const index = entries.findIndex(entry => entry.id === scope.target);
    removed = [{ id: entries[index].id, banner: scope.banner, status: entries[index].status }];
    entries.splice(index, 1);
  }

  store.saveState(root, state);
  store.appendHistory(root, {
    action: 'clear',
    author: process.env.USER || process.env.USERNAME || 'user',
    command: `clear ${scope.target}`,
    scope: scope.type,
    count: removed.length,
    entries: removed,
  });

  if (scope.type === 'entry') {
    console.log(`\n  ${c.green('✓')} Cleared ${c.bold(scope.banner)} ${c.gray('[' + scope.target + ']')} from live context.`);
  } else if (scope.type === 'banner') {
    console.log(`\n  ${c.green('✓')} Cleared ${removed.length} entr${removed.length === 1 ? 'y' : 'ies'} from ${c.bold(scope.target)}.`);
  } else {
    console.log(`\n  ${c.green('✓')} Cleared all ${removed.length} entries from live context.`);
  }
  console.log(c.gray('  Audit history and sealed agent receipts were preserved.\n'));
}

module.exports = { clearContext };
