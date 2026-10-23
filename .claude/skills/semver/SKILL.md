---
name: semver
description: Analyze the diff between the last git tag and HEAD to determine the appropriate semantic version bump (PATCH / MINOR / MAJOR). Inspects public API changes, breaking changes, new features, and bug fixes. Use whenever the user asks "what version bump", "is this a major or minor", "should we bump to X.Y.Z", "what semver", or invokes /semver. Output is a recommendation with justification — not an automatic version change.
---

# Semantic Version Bump Analyzer

Compare current code to the last tag and recommend a semver bump.

## Procedure

1. Find the last tag:
   ```bash
   git describe --tags --abbrev=0
   ```
   If the project uses Changesets-style tags (`@scope/name@x.y.z`), fall back to:
   ```bash
   PKG_NAME=$(node -p "require('./package.json').name")
   git tag --sort=-version:refname | grep "^${PKG_NAME}@" | head -n1
   ```

2. Generate the diff:
   ```bash
   git diff <last-tag> HEAD
   git log <last-tag>..HEAD --oneline
   ```

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
- **Untagged repo**: no last tag → recommend starting at `0.1.0` and explain.
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
