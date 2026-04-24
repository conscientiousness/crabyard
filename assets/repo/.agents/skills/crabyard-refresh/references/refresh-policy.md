# Refresh Policy

## Update

Choose update when:

- the note is still fundamentally correct
- code paths, filenames, or commands changed
- wording drifted but the retrieval target is the same
- tags, aliases, concepts, summaries, or index entries are too weak for likely future retrieval

Do not choose update only because an old valid note lacks newer optional metadata.

## Consolidate

Choose consolidate when:

- two notes answer the same future question
- one note clearly subsumes the other
- keeping both would create retrieval ambiguity
- the index cannot clearly rank one canonical note without confusing future agents

## Replace

Choose replace when:

- the old note is actively misleading
- a new canonical note is clearly available
- a successor note can carry a clear `supersedes` relationship

## Stale

Choose stale when:

- drift is likely but not proven strongly enough
- the correct replacement is ambiguous
- rewriting would require unsupported guesswork

For migration cleanup, stale marking is better than broad normalization when the only evidence is age or old formatting.

## Leave unchanged

Choose leave unchanged when:

- the note is valid and indexed
- missing optional fields would not improve retrieval
- changing the note would create review noise without making future work easier
