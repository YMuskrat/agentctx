# Versioned exports

The export envelope uses `format: "agenctx-export"`, `version: 1`, a `kind`
(`context` or `receipt`), and a `data` object. Unknown envelope versions and kinds
must be rejected rather than interpreted as the current format. New optional
fields within data may be preserved by consumers.

A context export contains `config` and `state` objects, including all entry
statuses. It is a snapshot of maintained knowledge, not a selection of trusted
instructions for a particular task. It excludes proposals, history, runtime
sessions, credentials outside the store, and generated agent guides. Entries
have globally unique nonempty string IDs, string content, and one of `active`,
`pinned`, `ambient`, or `archived` statuses. Banner entries remain in source order.

A receipt export contains one sealed receipt, including its original hash and
ordered served events. The export does not recompute timestamps or invent proof
that an agent followed the instructions. Consumers must verify its original
receipt hash. Legacy sessions without a verifiable hash cannot be exported as
verified receipts.

Exports can contain private repository text; they stay local unless the user
chooses to transfer them. Export is read-only. Validation does not approve
imported context, and this format does not introduce automatic import or merge.

Round-trip compatibility means `decode(encode(envelope))` preserves the JSON
values. It does not promise byte-for-byte equality with source files or preserve
formatting. Incompatible changes require a new version and migration guidance.
