# scripts

Repository tooling that runs outside the packages. At present this is the
documentation gate, `docs-audit.mjs`, and its test, `docs-audit.test.mjs`.

## Usage

Run the gate through `npm run docs:audit`. It reports declarations without a
JSDoc block, source folders without a `README.md`, and a missing upkeep block in
the root files, and exits non-zero while any gap remains. Add `--dir <folder>`
to scope a run to one folder.

## Constraints

Both files are vendored from the `enforce-code-docs` skill. Keep them
byte-identical to that source: change the skill and copy the files in again,
never edit them here. Run the test with `node --test`.
