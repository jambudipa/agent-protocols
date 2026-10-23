---
name: npm-publish
description: Publish new versions of the workspace packages using Changesets — preflight checks, build/typecheck/lint/test, apply changesets, squash all post-tag commits into a single release commit, push the base branch, publish each package to npm with 2FA OTP, and create/push one git tag per package. Use whenever the user says "publish", "release a new version", "ship to npm", "cut a release", or invokes /npm-publish. Requires interactive npm 2FA — ask the user for the OTP at publish time, and always publish with `npm publish --ignore-scripts` so the code is not expired by prepublishOnly.
---

# Publish New Versions (Changesets-only)

End-to-end release flow. Uses Changesets for versioning, changelogs, tagging, and publishing. Do **not** use `npm version` or manual tag creation as alternatives.

This repository is an npm workspace. The root `package.json` is private and never published; every publishable package lives under `packages/` and gets its own version and its own tag. Two values recur below:

```bash
BASE=$(node -p "require('./.changeset/config.json').baseBranch")
# One line per publishable package: "<name> <path>"
npm query .workspace | node -e 'for (const p of JSON.parse(require("fs").readFileSync(0, "utf8"))) if (!p.private) console.log(p.name, p.path)'
```

## 0. Preflight

- Must be on `$BASE` (`master` today) with clean working tree.
- Node 24+ (`engines` in every package). `nvm use 24` if needed.
- An `origin` remote must exist: steps 5, 6 and 8 push to it.
- npm login with 2FA — OTP needed at step 7.
- The `@agent-protocols` scope must exist on npm and include the logged-in user, or the first publish fails.
- For scoped packages, `publishConfig.access` must be `public` (already set in each package, and `access` is `public` in `.changeset/config.json`).

```bash
node --version
git status --porcelain && git branch --show-current
git remote get-url origin
npm whoami || npm login
npm config get registry
npm org ls agent-protocols
```

If any check fails, stop and report.

## 1. Determine bump type via semver skill

Invoke the **semver** skill for each publishable package. It analyzes the diff between that package's last tag and HEAD and returns a recommended bump (PATCH / MINOR / MAJOR) with justification and a summary of changes. Leave out a package with no changes since its tag.

Capture from the semver output, for each package:
- `BUMP` — `patch` | `minor` | `major`
- `SUMMARY` — the change summary (used as the changeset body)

A package with no tag that npm does not know (`npm view <name> version` gives E404) is a first release: publish it at its current `package.json` version, with no changeset for it.

Then reconcile with Changesets state:

```bash
npx changeset status 2>&1 | tee .changeset-status.txt || true
```

Three cases:

1. **No pending changesets** — create one matching the semver recommendations, non-interactively. This avoids the `npx changeset add` interactive prompt. Put one line for each package to release in the frontmatter:

   ```bash
   # One "<name>": <bump> line per package, BUMP from the semver skill
   # SUMMARY = the change summary from semver skill (escape backticks if any)
   mkdir -p .changeset
   cat > ".changeset/auto-$(date +%s).md" <<EOF
   ---
   "@agent-protocols/<name>": ${BUMP}
   ---

   ${SUMMARY}
   EOF
   ```

2. **Pending changesets present and the resulting bumps match** the semver recommendations — proceed unchanged.

3. **Pending changesets present but a resulting bump disagrees with semver** — **stop and surface the conflict**. Show both:
   - What Changesets will produce (from `changeset status` output).
   - What semver analysis recommends and why.

   Ask the user which to honour. Do not silently override either side — a misaligned release is worse than a paused one.

If the version + CHANGELOG were already manually updated (no pending changesets, no new commits since the last tag), `changeset status` may error — that is expected. Skip step 4 in that case.

## 2. Build, typecheck, lint, test

```bash
npm run clean
npm run typecheck
npm run build
npm run lint
npm run test:run || npm run test
```

Any failure aborts the release. Fix root cause; do not bypass.

## 3. Verify publish contents (recommended)

```bash
# --ignore-scripts: step 2 already built dist/, and the prepack build output would corrupt the JSON
npm pack --dry-run --json --ignore-scripts --workspaces | tee .npm-pack-preview.json
# Optional tarball inspection, per package
PKG_TGZ=$(npm pack -w "@agent-protocols/<name>" --ignore-scripts)
tar -tzf "$PKG_TGZ" | head -n 50
```

Look for accidentally included source files, secrets, or missing dist files.

## 4. Apply changesets

Skip if version + CHANGELOG already manually updated, or if every package is a first release.

```bash
npm run version   # runs "changeset version"
npm install       # moves the new workspace versions into package-lock.json
npm run build     # dist/ must be current, see Notes
```

Do not commit yet — the squash in step 5 handles it.

## 5. Squash to single commit since last tag

### 5a. Safety check

Confirm intermediate commits have **not** been pushed to `origin/$BASE` — otherwise the squash would require a force-push.

```bash
git fetch origin

LAST_TAG=$(git tag --list '@agent-protocols/*' --sort=-creatordate | head -n1 || echo "")
REMOTE_BASE=$(git rev-parse "origin/${BASE}")
echo "Last tag: ${LAST_TAG:-<none>}"
echo "Remote ${BASE}: $REMOTE_BASE"

if [ -n "$LAST_TAG" ] && [ "$REMOTE_BASE" != "$(git rev-parse "${LAST_TAG}^{commit}" 2>/dev/null || echo '')" ]; then
  echo "Warning: origin/${BASE} is not at the last tag. Squashing would require a force-push."
fi

git log --oneline --decorate ${LAST_TAG:+"${LAST_TAG}..HEAD"}
```

If the warning fires, **stop and confirm with the user** before proceeding. Force-pushing the base branch rewrites shared history.

### 5b. Squash

```bash
LAST_TAG=$(git tag --list '@agent-protocols/*' --sort=-creatordate | head -n1 || echo "")

if [ -n "$LAST_TAG" ]; then
  git reset --soft "$LAST_TAG"
else
  git reset --soft $(git rev-list --max-parents=0 HEAD)
fi

git add -A
# RELEASES = "<name>@<version>" of each released package, comma-separated
git commit -m "chore: release ${RELEASES}"
```

## 6. Push the base branch

```bash
git push origin "$BASE"
```

Push before publishing so CI and tags line up.

## 7. Get OTP and publish

npm has 2FA enabled (`auth-and-writes`). `npm publish` blocks on an interactive prompt that cannot be automated.

**Always publish with `--ignore-scripts`.** Each package's `prepublishOnly` runs `clean && build && typecheck`, and npm runs it *before* uploading the tarball and validating the OTP. A 30-second TOTP is therefore already expired by the time npm checks it, and the publish fails with `EOTP` no matter how fresh the code was when the user sent it. Steps 2 and 3 have already run exactly those checks against exactly this tree, so re-running them buys nothing and costs the release.

**Ask the user**: *"Open your authenticator app and give me your npm 2FA OTP — I'll publish immediately."*

Then publish every released package in one command, so one code covers them all:

```bash
OTP=<OTP_FROM_USER>
for PKG in <released package names>; do
  npm publish -w "$PKG" --ignore-scripts --otp="$OTP" || break
done
```

If the code expires partway, ask for a fresh one and publish only the packages that remain.

`--ignore-scripts` is safe **only because steps 2–3 are mandatory and must have passed on the current tree**. If you skipped or short-circuited them, do not skip the scripts — fix the checks first.

### If the OTP is rejected

`EOTP` means the server refused the code. Diagnose before asking for another — burning the user's codes one at a time teaches you nothing:

1. **Did `prepublishOnly` run?** If the output shows `clean`/`build`/`typecheck` before the tarball notices, you forgot `--ignore-scripts`. That is the cause. Add the flag and ask for one fresh code.
2. **Two fresh codes rejected with the flag on?** Then it is not timing. Check the account:
   ```bash
   npm profile get          # two-factor auth mode
   npm config get auth-type
   ```
   `auth-and-writes` plus a passkey/WebAuthn second factor has no typeable code — the user must run `npm publish` themselves in a real terminal and complete the browser flow.
3. **Never run `npm login` on the user's behalf**, and never ask for their password. If auth is broken, hand them the command and stop.

Resolve auth *before* step 5, not after: a pushed release commit and tag for a version that never published leaves the base branch claiming a release that does not exist.

## 8. Create and push tags

We bypassed `changeset publish`, so the tags must be created manually, one for each published package. Changesets format: `@scope/name@version` (e.g. `@agent-protocols/agent-protocol@0.1.0`).

```bash
for PKG in <published package names>; do
  DIR=$(npm query .workspace | node -e 'const n = process.argv[1]; for (const p of JSON.parse(require("fs").readFileSync(0, "utf8"))) if (p.name === n) console.log(p.path)' "$PKG")
  TAG="${PKG}@$(node -p "require('${DIR}/package.json').version")"
  git tag "$TAG"
  git push origin "$TAG"
  echo "Tagged and pushed: $TAG"
done
```

## 9. Verify

```bash
for PKG in <published package names>; do
  npm view "$PKG" version
done
```

Optionally create a GitHub Release from each tag with notes from the package CHANGELOG.

## Notes

- `npm pack --dry-run` respects `files` and `.npmignore` — trust it for what will publish.
- `--ignore-scripts` at publish time skips `prepublishOnly` **and** `prepack`. `prepack` also runs the build, so `dist/` must already be current — step 4 rebuilds after `changeset version` so each shipped bundle comes from the released tree.
- Granular access tokens no longer bypass 2FA (npm deprecated `bypass2FA` in 2026), so interactive OTP is now unavoidable for an `auth-and-writes` account. There is no token you can add to `.npmrc` to make this step non-interactive except a CI automation token.
- Changesets tags are **lightweight** (not annotated). `git push --follow-tags` will not push them — always use explicit `git push origin "<tag>"`.
- `git describe --tags --abbrev=0` may miss Changesets-format tags. Use the `git tag --list` pattern instead.
- For CI, use `NODE_AUTH_TOKEN` via `//registry.npmjs.org/:_authToken` in `.npmrc` instead of interactive OTP.
