# Crabyard Manifest Contract

The canonical routing contract lives at `crabyard/manifest.yaml`.

## Recommended fields

- `version`
- `root`
- `project_file`
- `task_format_file`
- `specs_root`
- `changes_root`
- `knowledge.root`
- `knowledge.index`
- `source_docs`
- `refresh_scope`
- `write_policy`
- `default_tags`
- `notes`

## Usage rules

- Treat the manifest as the machine-readable routing contract.
- If the manifest and `AGENTS.md` disagree, prefer `AGENTS.md` for safety and mention the mismatch.
- If the manifest is missing, continue conservatively and recommend adding it.
