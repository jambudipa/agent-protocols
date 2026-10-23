---
name: semver
description: Analyze the diff between the last git tag and HEAD to determine the appropriate semantic version bump (PATCH / MINOR / MAJOR). Inspects public API changes, breaking changes, new features, and bug fixes. Use whenever the user asks "what version bump", "is this a major or minor", "should we bump to X.Y.Z", "what semver", or invokes /semver. Output is a recommendation with justification — not an automatic version change.
---

# Semantic Version Bump Analyzer

Compare current code to the last tag and recommend a semver bump.

## Procedure

This repository is an npm workspace. The root `package.json` is private and never published. Run the analysis once for each package under `packages/`, and give one result for each package.

1. Find the last tag of the package. Tags use the Changesets format `@scope/name@x.y.z`, and `git describe` misses them:
   ```bash
   PKG_DIR=packages/<dir>
   PKG_NAME=$(node -p "require('./${PKG_DIR}/package.json').name")
   git tag --list "${PKG_NAME}@*" --sort=-version:refname | head -n1
   ```

2. Generate the diff of the package, plus the shared compiler options that change its emitted declarations:
   ```bash
   git diff <last-tag> HEAD -- "$PKG_DIR" tsconfig.base.json
   git log <last-tag>..HEAD --oneline -- "$PKG_DIR" tsconfig.base.json
   ```
   The public API is what the `exports` map of the package reaches.

3. Categorize each change.

## Bump rules

### MAJOR — breaking changes

- Removed or renamed public API (functions, classes, exports).
- Changed function signature in a non-backward-compatible way (required params added, return type changed).
- Removed or renamed config options, env vars, CLI flags.
- Incompatible changes to data structures, schemas, or wire formats.
- Removal of previously deprecated features.
- Behaviour change that would break a reasonable caller's assumptions.
- Minimum runtime/Node version raised.
- Peer dependency range raised (for example `effect`).

### MINOR — backward-compatible additions

- New public API (functions, classes, modules).
- New optional parameters with sensible defaults.
- New backward-compatible feature flags or config.
- Deprecating (but not removing) an existing API.
- Backward-compatible performance improvements that change observable timing in ways callers might rely on are MINOR; pure internal speedups are PATCH.

### PATCH — fixes and internals

- Bug fixes that don't change the public contract.
- Documentation, comments, examples.
- Internal refactoring with no API impact.
- Performance improvements with no observable behaviour change.
- Dependency bumps that don't expose new types or change behaviour.

## Edge cases

- **Pre-1.0 (`0.x.y`)**: by strict semver, minor can be breaking. But for predictable downstream behaviour, treat breaking changes as MINOR (`0.x → 0.x+1`) and additions as PATCH (`0.x.y → 0.x.y+1`). Flag this so the user can decide.
- **Untagged package**: no tag for the package and `npm view <name> version` gives E404 → recommend the first release at the current `package.json` version, with no bump and no changeset, and explain.
- **Multiple changes mixing categories**: the highest category wins (any breaking → MAJOR).

## Output template

```
📦 Semver Analysis

Current version: <last-tag-version> (from <tag>)
Commits since tag: <n>

Changes by category:
  Breaking (<n>):
    - <change> (<file>)
  Features (<n>):
    - <change> (<file>)
  Fixes / internal (<n>):
    - <change> (<file>)

Recommended bump: <MAJOR | MINOR | PATCH>
Suggested new version: <x.y.z>

Justification:
  <one paragraph — what tipped it into this category>

Release-notes-worthy breaking changes:
  - <change> — <migration guidance>
```

## Boundaries

Recommend only. Do not run `npm version`, edit changelogs, or create tags — that is the publish skill's job.
