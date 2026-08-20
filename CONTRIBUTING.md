# Contributing to agenctx

Thanks for helping make agent context safer, smaller, and easier to understand.

## Before you start

- Search the existing issues before opening a new one.
- Use an issue to discuss substantial features or data-format changes before implementation.
- Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.

Bug reports should include the operating system, Node.js version, Agenctx version, exact command, expected result, actual result, and a minimal reproduction. Remove credentials and private repository context before sharing output.

## Development setup

Requirements:

- Node.js 18 or later
- npm
- Git

```sh
git clone https://github.com/YMuskrat/agentctx.git
cd agentctx
npm ci
npm run check
npm test
```

Run `node bin/agenctx.js --help` to use the development checkout directly.

## Pull requests

- Keep each pull request focused on one behavior or concern.
- Add or update tests for observable behavior changes.
- Update the README or command help when the user-facing workflow changes.
- Preserve compatibility with committed `.agenctx/` data or include an explicit migration.
- Avoid new runtime dependencies unless the benefit and security cost are explained.
- Never commit real credentials, private context stores, or active session data.
- Run `npm run check`, `npm test`, and `npm pack --dry-run` before requesting review.

Maintainers may ask for a smaller change, additional tests, or a design issue before merging. A contribution is accepted when it is understandable, tested, documented, compatible with the project direction, and passes CI.

## Design principles

Changes should preserve these properties:

- Humans control trusted context.
- Agents retrieve context deliberately instead of receiving the whole store.
- Agent proposals remain separate until human approval.
- Session receipts describe what Agenctx served, not what an agent understood or followed.
- Repository data remains local-first, inspectable, and usable without a hosted service.
- Defaults remain safe for concurrent agents and version-controlled repositories.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
