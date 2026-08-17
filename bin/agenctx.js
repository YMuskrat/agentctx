#!/usr/bin/env node
'use strict';

const HELP = `
agenctx: version control for agent context

Usage:
  agenctx <command> [args] [options]

Core commands:
  init [--hook]            Initialize agenctx in the current project
  add <banner> [message]   Add entry to a banner  (-m inline, -e editor)
  banner add <name>        Add or describe a custom context type
  view                     Show project, pinned context, and every context type
  view <banner>            Show pinned and other entries in one context type
  edit <id> [-m message]   Update an entry inline or in an editor
  import <file>             Preview Markdown migration into managed context
  import <file> --apply     Import sections and migrate a root agent guide
  clear <id|banner|all>     Remove entries from live context
  dump [target]            Generate agent guides (openai/claude/cursor/all)
  dump [target] --check    Check generated sections without changing files
  sync                     Re-scan project for package/env changes

Lifecycle:
  lifecycle [--all]        Inspect policy, states, decay, and archive
  pin <id>                 Pin entry; always shown to agents
  unpin <id>               Unpin entry; return to normal lifecycle
  archive <id>             Archive entry; hidden from agents
  restore <id>             Restore archived entry to active
  revert <id>              Archive a decision and document its reversion

Views:
  feed                     All entries newest first, across all banners
  top                      Most read entries with read frequency bar

Search:
  search                   Interactive fuzzy search (fzf-style)
  search "keyword"         Search by keyword across all banners
  search --since=2d        Filter by date (2d, 1w, 1m, "march 1")
  search "jwt" --since=1w  Combine keyword and date

Sessions:
  --agent start "question" Start a tracked agent interaction
  --agent end              Seal its ordered served-context receipt
  session start "question" Start a session (one per user question)
  session end              Close the active session
  session list             All past sessions
  session show <id|hash>   Show the exact ordered served-context receipt

Audit:
  audit                    Show recent read/write activity
  audit --session=latest   Show last agent session
  audit <id> --detail      Show context agent had at time of entry
  status                   List agent receipt hashes and task names

Banners:
  warnings   decisions   rules     testing
  env        packages    notes     refs
  tasks      blockers

Flags:
  agenctx view --agent         Log what was served (agent mode)
  agenctx view --about="jwt"   Filter entries by topic
  agenctx view --ambient       Include ambient entries
  agenctx archive <id> --force Skip conflict check

Examples:
  agenctx init
  agenctx add warn "don't touch legacy/api.js"
  agenctx add decision -m "chose JWT over sessions; stateless"
  agenctx view
  agenctx view warnings
  agenctx search "authentication"
  agenctx import AGENTS.md
  agenctx --agent start "fix authentication"
  agenctx --agent end
  agenctx dump
  agenctx pin abc123
  agenctx audit --session=latest
`.trim();

async function main() {
  const [,, command, ...args] = process.argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    const pkg = require('../package.json');
    console.log(pkg.version);
    return;
  }

  try {
    if (command === '--agent') {
      const { agentSession } = require('../lib/commands/session');
      agentSession(args);
      return;
    }

    switch (command) {
      case 'init': {
        const { init } = require('../lib/commands/init');
        await init(args);
        break;
      }
      case 'add': {
        const { add } = require('../lib/commands/add');
        await add(args);
        break;
      }
      case 'banner': {
        const { banner } = require('../lib/commands/banner');
        banner(args);
        break;
      }
      case 'view': {
        const { view } = require('../lib/commands/view');
        view(args);
        break;
      }
      case 'edit': {
        const { edit } = require('../lib/commands/edit');
        edit(args);
        break;
      }
      case 'import': {
        const { importContext } = require('../lib/commands/import');
        await importContext(args);
        break;
      }
      case 'clear': {
        const { clearContext } = require('../lib/commands/clear');
        await clearContext(args);
        break;
      }
      case 'dump': {
        const { dump } = require('../lib/commands/dump');
        dump(args);
        break;
      }
      case 'sync': {
        const { sync } = require('../lib/commands/sync');
        sync(args);
        break;
      }
      case 'pin': {
        const { pin } = require('../lib/commands/lifecycle');
        pin(args);
        break;
      }
      case 'lifecycle': {
        const { lifecycleReport } = require('../lib/commands/lifecycle-report');
        lifecycleReport(args);
        break;
      }
      case 'unpin': {
        const { unpin } = require('../lib/commands/lifecycle');
        unpin(args);
        break;
      }
      case 'archive': {
        const { archive } = require('../lib/commands/lifecycle');
        archive(args);
        break;
      }
      case 'restore': {
        const { restore } = require('../lib/commands/lifecycle');
        restore(args);
        break;
      }
      case 'revert': {
        const { revert } = require('../lib/commands/lifecycle');
        revert(args);
        break;
      }
      case 'resolve': {
        const { resolve } = require('../lib/commands/lifecycle');
        resolve(args);
        break;
      }
      case 'audit': {
        const { audit } = require('../lib/commands/audit');
        audit(args);
        break;
      }
      case 'status': {
        const { status } = require('../lib/commands/status');
        status(args);
        break;
      }
      case 'search': {
        const { search } = require('../lib/commands/search');
        await search(args);
        break;
      }
      case 'session': {
        const { session } = require('../lib/commands/session');
        session(args);
        break;
      }
      case 'feed': {
        const { feed } = require('../lib/commands/feed');
        feed(args);
        break;
      }
      case 'top': {
        const { top } = require('../lib/commands/feed');
        top(args);
        break;
      }
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run: agenctx --help');
        process.exit(1);
    }
  } catch (err) {
    console.error(err.message || String(err));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});
