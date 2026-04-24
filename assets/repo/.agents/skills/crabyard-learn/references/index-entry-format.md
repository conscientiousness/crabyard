# Index Entry Format

Use one bullet per knowledge note under `crabyard/knowledge/index.md`.

## Format

```md
- [short-label](./topic.md) - tags: `tag-a`, `tag-b`; summary: one short sentence.
```

## Rules

- Keep the summary to one sentence.
- Refresh existing entries instead of adding duplicates.
- Remove entries that point to deleted or consolidated docs.
- Include the strongest exact retrieval terms in tags or summary, including common symptom wording and user-language aliases when they differ from implementation names.
- Keep stable taxonomy tags short. Use phrase-like tags sparingly, only when they prevent missed retrieval for common queries.
- Do not encode a separate machine index in this file. It should stay readable enough for an LLM to scan before opening the strongest notes.
