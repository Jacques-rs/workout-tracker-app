# Skills — canonical source

The **unpacked directories in this folder are canonical**: `program-planner/` and `program-builder/`.
Edit those. Nothing else.

A `.skill` file is just a zip of one of these directories — a build artefact, not a source.
Never edit a bundle, and never treat one as the current version: it is a snapshot that goes
stale the moment a `SKILL.md` changes here.

## Rebuilding a bundle

Only needed when installing or sharing a skill. Build it fresh, use it, then delete it —
do not leave bundles lying around in the project.

```bash
cd skills/program-builder && \
  zip -r ../../program-builder.skill . -x '*.DS_Store' '*__pycache__/*' '*.pyc' && cd -
```

The exclude patterns need the leading `*` — a bare `.DS_Store` only matches one at the zip
root, and `scripts/__pycache__/` will otherwise ship compiled bytecode inside the bundle.

The zip must contain `SKILL.md` at its **root**, not nested inside a folder — hence the
`cd` into the directory rather than zipping the directory by name.

Verify before installing:

```bash
unzip -l program-builder.skill   # SKILL.md must be the first-level entry
```

## Current contents

| Directory | Contains |
|---|---|
| `program-planner/` | `SKILL.md`, `reference/planning-doc-template.md` |
| `program-builder/` | `SKILL.md`, `scripts/build_program_json.py`, `scripts/build_xlsx.py`, `scripts/rows_common.py` |

`rows_common.py` is shared by both builder scripts — it holds the single definition of how
`rows.json` is validated, how weeks are read and how days are ordered. It exists because the
two scripts once disagreed about the same input file, which meant the workbook and
`program.json` could describe different programmes. Any bundle must include it.
