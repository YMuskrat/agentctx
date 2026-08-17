'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const store = require('../store');
const { c } = require('../format');
const { guideContent, stripManagedContent } = require('./dump');

const REPLACEABLE_AGENT_FILES = {
  'agents.md': 'md',
  'claude.md': 'md',
  '.cursorrules': 'cursor',
};

const HEADING_RULES = [
  ['warnings', /\b(warn(?:ing)?s?|gotchas?|hazards?|cautions?|pitfalls?|security|secrets?|credentials?)\b/i],
  ['blockers', /\b(blockers?|limitations?|known issues?|constraints?)\b/i],
  ['testing', /\b(tests?|testing|validation|verification|quality|lint(?:ing)?|ci)\b/i],
  ['decisions', /\b(architecture|architectural|decisions?|design|rationale|principles?|trade[ -]?offs?)\b/i],
  ['rules', /\b(rules?|conventions?|standards?|guidelines?|requirements?|instructions?|practices?|contributing)\b/i],
  ['env', /\b(environment|configuration|config|setup|installation|install|run locally|local development|deployment)\b/i],
  ['packages', /\b(dependencies|packages?|technology|tech stack)\b/i],
  ['refs', /\b(references?|links?|resources?|documentation)\b/i],
  ['tasks', /\b(tasks?|todos?|roadmap|milestones?|next steps?)\b/i],
  ['notes', /\b(notes?|usage|workflows?|how[ -]?tos?|operations?|development)\b/i],
];

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeForComparison(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[~*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function clip(value, width) {
  if (value.length <= width) return value;
  return value.slice(0, Math.max(1, width - 1)) + '…';
}

function classifyHeading(heading, fallback) {
  for (const [banner, pattern] of HEADING_RULES) {
    if (pattern.test(heading)) return banner;
  }
  return fallback;
}

function slugifyHeading(heading) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '') || 'imported-context';
}

function extractPurpose(body) {
  let purpose = null;
  const lines = body.split('\n').filter(line => {
    const match = !purpose && line.match(/^\s*>\s*Purpose:\s*(.+?)\s*$/i);
    if (!match) return true;
    purpose = match[1].trim();
    return false;
  });
  return { purpose, body: lines.join('\n').trim() };
}

function parseSections(markdown) {
  const sections = [];
  let current = { heading: 'General instructions', level: 0, lines: [], explicit: false };
  let fence = null;

  function finish() {
    const body = current.lines.join('\n').trim();
    if (body || current.explicit) sections.push({ ...current, body });
  }

  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
      current.lines.push(line);
      continue;
    }

    const headingMatch = !fence && line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      finish();
      current = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        lines: [],
        explicit: true,
      };
      continue;
    }
    current.lines.push(line);
  }
  finish();
  return sections;
}

function buildCandidates(content, { readme, agentFile, bannerDescriptions = {} }) {
  const sections = parseSections(content);
  const candidates = [];
  const customBanners = new Map();
  const parents = [];
  let skipped = 0;

  function addCandidate(section, banner, body, customBanner = null) {
    if (!body.trim()) return;
    const prefix = section.heading === 'General instructions'
      ? ''
      : `${'#'.repeat(Math.max(2, section.level))} ${section.heading}\n\n`;
    const entryContent = `${prefix}${body}`.trim();
    candidates.push({
      banner,
      customBanner,
      heading: section.heading,
      body: body.trim(),
      normalizedBody: normalizeForComparison(body),
      content: entryContent,
      contentHash: hash(entryContent),
      lines: entryContent.split('\n').length,
    });
  }

  for (const section of sections) {
    while (parents.length && parents.at(-1).level >= section.level) parents.pop();
    const parent = parents.at(-1) || null;

    if (section.heading === 'General instructions') {
      if (agentFile) addCandidate(section, 'rules', section.body);
      else if (section.body) skipped++;
      continue;
    }

    const inherited = section.level >= 3 ? parent : null;
    const directBanner = classifyHeading(section.heading, null);
    const extracted = extractPurpose(section.body);
    let banner = inherited?.banner || directBanner;
    let customBanner = inherited?.customBanner || null;

    if (!banner && section.level === 2 && (!readme || extracted.purpose)) {
      banner = slugifyHeading(section.heading);
      customBanner = banner;
      const knownDescription = bannerDescriptions[banner];
      const current = customBanners.get(banner);
      customBanners.set(banner, {
        name: banner,
        heading: section.heading,
        description: knownDescription || extracted.purpose || current?.description || null,
      });
    } else if (!banner && agentFile) {
      banner = 'rules';
    }

    if (!banner) {
      skipped++;
      continue;
    }

    parents.push({ level: section.level, banner, customBanner });
    addCandidate(section, banner, customBanner ? extracted.body : section.body, customBanner);
  }

  return { candidates, customBanners, sections, skipped };
}

function replacementType(root, sourcePath) {
  if (path.dirname(sourcePath) !== root) return null;
  return REPLACEABLE_AGENT_FILES[path.basename(sourcePath).toLowerCase()] || null;
}

function sourceType(sourcePath) {
  const name = path.basename(sourcePath).toLowerCase();
  return REPLACEABLE_AGENT_FILES[name] || 'md';
}

function backupPath(root, sourcePath, sourceHash) {
  const basename = path.basename(sourcePath);
  const extension = path.extname(basename) || '.txt';
  const stem = (path.extname(basename) ? basename.slice(0, -extension.length) : basename)
    .replace(/^\./, '')
    .replace(/[^a-z0-9_-]+/gi, '-');
  return path.join(store.agenctxDir(root), 'imports', `${stem}.${sourceHash.slice(0, 12)}${extension}`);
}

function safeWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function askToApply(count, replace) {
  return new Promise(resolve => {
    const prompt = replace
      ? `\n  Import ${count} entries and replace the source with the static guide? [y/N] `
      : `\n  Import ${count} entries? [y/N] `;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(/^y(?:es)?$/i.test(answer.trim()));
    });
  });
}

function askPurpose(item) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  Purpose for custom banner ${item.name} (${item.heading}): `, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askToDescribeCustoms(count) {
  return new Promise(resolve => {
    const label = `${count} custom banner${count === 1 ? '' : 's'}`;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${label} need${count === 1 ? 's' : ''} a purpose. Describe ${count === 1 ? 'it' : 'them'} now? [Y/n] `, answer => {
      rl.close();
      resolve(!/^n(?:o)?$/i.test(answer.trim()));
    });
  });
}

async function resolveCustomPurposes(customBanners) {
  if (!process.stdin.isTTY) return;
  const unresolved = [...customBanners.values()].filter(item => !item.description);
  if (!unresolved.length || !await askToDescribeCustoms(unresolved.length)) return;
  for (const item of unresolved) {
    const purpose = await askPurpose(item);
    if (purpose) item.description = purpose;
  }
}

function printPreview(relativeSource, candidates, duplicates, skipped, replace, customBanners, unresolved) {
  const unresolvedNames = new Set(unresolved.map(item => item.name));
  const readyCount = candidates.filter(item => !item.customBanner || !unresolvedNames.has(item.customBanner)).length;
  console.log(`\n  ${c.bold('IMPORT PREVIEW')}  ${c.gray(relativeSource)}\n`);
  console.log(`  ${'Source section'.padEnd(30)}  ${'Banner'.padEnd(22)}  Status`);
  console.log(`  ${'─'.repeat(30)}  ${'─'.repeat(22)}  ${'─'.repeat(13)}`);
  for (const item of candidates) {
    const status = item.customBanner && unresolvedNames.has(item.customBanner)
      ? 'needs purpose'
      : `${item.lines} line${item.lines === 1 ? '' : 's'}`;
    console.log(`  ${clip(item.heading, 30).padEnd(30)}  ${clip(item.banner, 22).padEnd(22)}  ${status}`);
  }
  console.log();
  if (unresolved.length) {
    console.log(`  ${c.bold(`${readyCount} entr${readyCount === 1 ? 'y' : 'ies'} ready`)}  ${c.gray(`· ${unresolved.length} custom banner${unresolved.length === 1 ? '' : 's'} need${unresolved.length === 1 ? 's' : ''} purpose · ${duplicates} already imported · ${skipped} sections skipped`)}`);
  } else {
    console.log(`  ${c.bold(`${candidates.length} new entr${candidates.length === 1 ? 'y' : 'ies'}`)}  ${c.gray(`· ${duplicates} already imported · ${skipped} sections skipped`)}`);
  }
  if (customBanners.length) {
    console.log(`\n  ${c.bold('CUSTOM BANNERS')}`);
    for (const item of customBanners) {
      console.log(`  ${c.cyan(item.name)}: ${item.description}`);
    }
  }
  if (unresolved.length) {
    console.log(`\n  ${c.yellow('CUSTOM BANNERS NEED PURPOSE')}`);
    for (const item of unresolved) {
      console.log(`  ${item.heading}  ${c.gray('→')}  ${item.name}`);
    }
  }
  if (replace) {
    console.log(c.gray('  The exact original will be archived in .agenctx/imports/ before this file is replaced.'));
  } else {
    console.log(c.gray('  The source file will remain unchanged.'));
  }
}

async function importContext(args) {
  const root = store.requireRoot();
  const sourceArg = args.find(arg => !arg.startsWith('-'));
  const apply = args.includes('--apply') || args.includes('--yes');
  const keepSource = args.includes('--keep-source');

  if (!sourceArg) {
    console.error(c.red('Usage: agenctx import <file> [--apply] [--keep-source]'));
    process.exit(1);
  }

  const sourcePath = path.resolve(process.cwd(), sourceArg);
  const relative = path.relative(root, sourcePath);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Import source must be a file inside the agenctx project.');
  }
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Import source not found: ${sourceArg}`);
  }

  const original = fs.readFileSync(sourcePath, 'utf8');
  const type = sourceType(sourcePath);
  const content = stripManagedContent(original, type);
  const lowerName = path.basename(sourcePath).toLowerCase();
  const agentFile = Boolean(REPLACEABLE_AGENT_FILES[lowerName]);
  const readme = /^readme(?:\.[^.]+)?\.md$/i.test(path.basename(sourcePath));
  const config = store.loadConfig(root);
  const plan = buildCandidates(content, {
    readme,
    agentFile,
    bannerDescriptions: config.banner_descriptions || {},
  });
  const replace = Boolean(replacementType(root, sourcePath)) && !keepSource;

  if (!plan.candidates.length) {
    console.log(c.gray('\n  No importable context found. The file may contain only the generated agenctx guide.\n'));
    return;
  }

  const state = store.loadState(root);
  const existing = Object.entries(state.banners)
    .flatMap(([banner, data]) => (data.entries || []).map(entry => ({ ...entry, banner })));
  const previewCandidates = plan.candidates.filter(item => !existing.some(entry =>
    entry.banner === item.banner && (
      entry.content.trim() === item.content
      || normalizeForComparison(entry.content) === item.normalizedBody
      || (entry.source?.file === normalizePath(relative) && entry.source?.hash === item.contentHash))));
  const duplicates = plan.candidates.length - previewCandidates.length;
  const activeCustomNames = new Set(previewCandidates.map(item => item.customBanner).filter(Boolean));
  const activeCustomBanners = new Map(
    [...plan.customBanners].filter(([name]) => activeCustomNames.has(name)),
  );
  const unresolvedBefore = [...activeCustomBanners.values()].filter(item => !item.description);
  const resolvedBefore = [...activeCustomBanners.values()].filter(item => item.description);
  printPreview(
    normalizePath(relative),
    previewCandidates,
    duplicates,
    plan.skipped,
    replace,
    resolvedBefore,
    unresolvedBefore,
  );

  await resolveCustomPurposes(activeCustomBanners);
  const unresolved = [...activeCustomBanners.values()].filter(item => !item.description);
  const unresolvedNames = new Set(unresolved.map(item => item.name));
  const candidates = previewCandidates.filter(item => !item.customBanner || !unresolvedNames.has(item.customBanner));

  if (!candidates.length) {
    console.log(c.gray('\n  Nothing to import.\n'));
    return;
  }

  let confirmed = apply;
  if (!confirmed && process.stdin.isTTY) confirmed = await askToApply(candidates.length, replace);
  if (!confirmed) {
    console.log(c.gray('\n  Preview only; no files were changed.\n'));
    return;
  }

  const now = new Date().toISOString();
  const author = process.env.USER || process.env.USERNAME || 'user';
  const usedIds = new Set(existing.map(entry => entry.id));
  const created = [];
  const usedCustomBanners = new Map();
  for (const item of candidates) {
    let id;
    do { id = store.generateId(); } while (usedIds.has(id));
    usedIds.add(id);
    const entry = {
      id,
      status: 'active',
      content: item.content,
      author,
      created: now,
      updated: now,
      last_read: null,
      read_count: 0,
      source: {
        type: 'import',
        file: normalizePath(relative),
        section: item.heading,
        hash: item.contentHash,
      },
    };
    if (!state.banners[item.banner]) state.banners[item.banner] = { entries: [] };
    state.banners[item.banner].entries.push(entry);
    if (item.customBanner) {
      const banner = plan.customBanners.get(item.customBanner);
      if (banner?.description) usedCustomBanners.set(banner.name, banner);
    }
    created.push({ id, banner: item.banner, section: item.heading, hash: item.contentHash });
  }

  config.custom_banners = config.custom_banners || [];
  config.banner_descriptions = config.banner_descriptions || {};
  for (const item of usedCustomBanners.values()) {
    if (!config.custom_banners.includes(item.name)) config.custom_banners.push(item.name);
    config.banner_descriptions[item.name] = item.description;
  }

  let archivedSource = null;
  if (replace) {
    const archivedPath = backupPath(root, sourcePath, hash(original));
    if (!fs.existsSync(archivedPath)) safeWrite(archivedPath, original);
    archivedSource = normalizePath(path.relative(root, archivedPath));
  }

  if (usedCustomBanners.size) store.saveConfig(root, config);
  store.saveState(root, state);
  if (replace) safeWrite(sourcePath, guideContent(type));
  store.appendHistory(root, {
    action: 'import',
    author,
    command: `import ${normalizePath(relative)}`,
    source: normalizePath(relative),
    archived_source: archivedSource,
    replaced: replace,
    banners: [...usedCustomBanners.values()].map(item => ({ name: item.name, description: item.description })),
    entries: created,
  });

  console.log(`\n  ${c.green('✓')} ${c.bold(`Imported ${created.length} entr${created.length === 1 ? 'y' : 'ies'}`)} from ${relative}`);
  if (archivedSource) console.log(c.gray(`  Original: ${archivedSource}`));
  if (replace) console.log(c.gray('  Source replaced with the static agenctx guide.'));
  console.log();
}

module.exports = { importContext, parseSections, buildCandidates };
