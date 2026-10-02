# Retrieval regression evaluation

Run `node scripts/evaluate-retrieval.js` from the checkout. It emits JSON and
exits nonzero when any expected result list changes. Supply another fixture
path as the first argument to evaluate additional cases.

The version-1 fixture contains a fixed state and queries with explicit expected
entry IDs. Cases cover case-insensitive substring matching, banner/date filters,
multiline matches, no matches, and ambient/archived visibility. The unit suite
also checks exact-ID access to full text. The evaluator calls the same pure
selection functions as noninteractive search without changing stored state.

Precision is the fraction of returned IDs that are relevant; recall is the
fraction of expected IDs returned. Empty expected and returned sets receive 1
for both. An empty result against nonempty expectations receives zero. Exact
match additionally requires the expected order. Macro metrics weight cases
equally. The regression gate is 100% exact match on the checked-in cases.

This is a synthetic mechanics suite, not a study of agent task completion,
retrieval relevance in arbitrary repositories, lifecycle scheduling, UI behavior,
or token savings. Add fixtures with explicit expected outcomes before changing
the baseline; do not regenerate expectations from the implementation.
