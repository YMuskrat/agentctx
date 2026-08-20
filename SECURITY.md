# Security policy

## Supported versions

During the public beta, security fixes are applied to the latest `0.1.x` release. Users should reproduce an issue against the newest release before reporting it when practical.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private **Report a vulnerability** form on the repository's [Security Advisories page](https://github.com/YMuskrat/agentctx/security/advisories/new).

Include:

- The affected version and operating system
- A minimal reproduction or proof of concept
- The expected and observed security boundary
- The likely impact
- Any suggested mitigation

Remove real credentials and private repository context from the report. The maintainer will aim to acknowledge a report within seven days and provide an initial assessment within fourteen days. Resolution timing depends on severity and complexity.

## Security model

- Agenctx stores context locally inside the repository. Committed `.agenctx/` data is visible to everyone who can read that repository.
- Agenctx is not a secret manager. Do not store tokens, passwords, private keys, or other credentials as context.
- The UI binds to `127.0.0.1`, uses a fresh launch token for API access, makes no external requests, and rejects stale writes.
- Active agent-session state is runtime data and is excluded from Git by default.
- Session receipts prove what Agenctx served and make later content edits detectable. They do not prove that an agent understood or followed the context.

Security-sensitive changes should include regression tests and avoid weakening these boundaries without an explicit design discussion.
