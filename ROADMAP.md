# Agenctx roadmap

This roadmap covers the public beta from August 2026 through August 2027. Priorities may change in response to real usage, but changes will be discussed in public issues and reflected here.

## August-October 2026: credible public beta

- Publish and document the `v0.1.0` npm and GitHub releases.
- Stabilize context, proposal, lifecycle, session-receipt, and local-UI workflows.
- Add packaged-install smoke tests and maintain the Windows, macOS, and Linux CI matrix.
- Publish integration recipes for at least three coding-agent environments.
- Recruit the first external users and turn their onboarding friction into tracked issues.

Exit signal: external users can install Agenctx, initialize an existing repository, retrieve context from an agent, and inspect a receipt without maintainer assistance.

## November 2026-January 2027: retrieval quality and integrations

- Build a reproducible retrieval evaluation set covering exact IDs, banner filtering, keyword discovery, previews, and full reads.
- Document recommended context-writing patterns and repository-scale limits from beta evidence.
- Define a stable, versioned export format for entries and served-context receipts.
- Add integration examples driven by community demand rather than agent-specific hidden behavior.
- Document at least one sustained startup or open-source project pilot.

Exit signal: retrieval behavior is measured, documented, and reproducible across supported environments.

## February-April 2027: interoperability and observability

- Define a tool-neutral context request and response contract based on pilot findings.
- Evaluate MCP and other agent interoperability surfaces without replacing the deterministic CLI.
- Add machine-readable receipt export for external observability and evaluation systems.
- Establish compatibility and migration policy for the `.agenctx/` data format.
- Expand security testing around local UI authorization, concurrent sessions, and untrusted repository data.

Exit signal: an external integration can retrieve context and consume receipts without parsing terminal presentation output.

## May-August 2027: sustainable project governance

- Document maintainer roles, decision making, release authority, and the contributor path to maintainership.
- Publish a compatibility matrix and conformance suite for integrations.
- Document two organizational production deployments, including lessons and measurable outcomes where disclosure is permitted.
- Review the 1.0 scope using adoption, security, interoperability, and retrieval-evaluation evidence.
- Prepare an Agentic AI Foundation proposal only when adoption and governance evidence meet its expectations.

Exit signal: Agenctx is maintained in the open, has repeatable releases, multiple active contributors, and documented organizational use.

## How to contribute to the roadmap

Open an issue describing the user problem, evidence, proposed outcome, and how success could be measured. A roadmap item is not a promise of implementation; maintainers prioritize work that improves safe context retrieval, interoperability, reliability, observability, or governance.
