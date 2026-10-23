---
name: npm-publish
description: Publish a new version of this package using Changesets — preflight checks, build/typecheck/test, apply changesets, squash all post-tag commits into a single release commit, push main, publish to npm with 2FA OTP, and create/push the git tag. Use whenever the user says "publish", "release a new version", "ship to npm", "cut a release", or invokes /npm-publish. Requires interactive npm 2FA — ask the user for the OTP at publish time, and always publish with `npm publish --ignore-scripts` so the code is not expired by prepublishOnly.
---

# Publish New Version (Changesets-only)

End-to-end release flow. Uses Changesets for versioning, changelogs, tagging, and publishing. Do **not** use `npm version` or manual tag creation as alternatives.

## 0. Preflight

- Must be on `main` with clean working tree.
- Node 18+ (Vite 5 fails on Node 14). `nvm use 20` if needed.
- npm login with 2FA — OTP needed at step 7.
- For scoped packages, `publishConfig.access` must be `public` (already set in this repo).

```bash
node --version
git status --porcelain && git branch --show-current
npm whoami || npm login
npm config get registry
```

If any check fails, stop and report.

## 1. Determine bump type via semver skill

Invoke the **semver** skill to analyze the diff between the last tag and HEAD. It returns a recommended bump (PATCH / MINOR / MAJOR) with justification and a summary of changes.

Capture from the semver output:
- `BUMP` — `patch` | `minor` | `major`
- `SUMMARY` — the change summary (used as the changeset body)

Then reconcile with Changesets state:

```bash
npx changeset status 2>&1 | tee .changeset-status.txt || true
```

Three cases:

1. **No pending changesets** — create one matching the semver recommendation, non-interactively. This avoids the `npx changeset add` interactive prompt:

   ```bash
   PKG_NAME=$(node -p "require('./package.json').name")
   # BUMP = patch | minor | major from semver skill
   # SUMMARY = the change summary from semver skill (escape backticks if any)
   mkdir -p .changeset
   cat > ".changeset/auto-$(date +%s).md" <<EOF
   ---
   "${PKG_NAME}": ${BUMP}
   ---

   ${SUMMARY}
   EOF
   ```

2. **Pending changesets present and the resulting bump matches** the semver recommendation — proceed unchanged.

3. **Pending changesets present but the resulting bump disagrees with semver** — **stop and surface the conflict**. Show both:
   - What Changesets will produce (from `changeset status` output).
   - What semver analysis recommends and why.

   Ask the user which to honour. Do not silently override either side — a misaligned release is worse than a paused one.

If the version + CHANGELOG were already manually updated (no pending changesets, no new commits since the last tag), `changeset status` may error — that is expected. Skip step 4 in that case.

## 2. Build, typecheck, test

```bash
npm run clean
npm run typecheck
npm run build
npm run test:run || npm run test
```

Any failure aborts the release. Fix root cause; do not bypass.

## 3. Verify publish contents (recommended)

```bash
npm pack --dry-run --json | tee .npm-pack-preview.json
# Optional tarball inspection
PKG_TGZ=$(npm pack)
tar -tzf "$PKG_TGZ" | head -n 50
```

Look for accidentally included source files, secrets, or missing dist files.

## 4. Apply changesets

Skip if version + CHANGELOG already manually updated.

```bash
npm run version   # runs "changeset version"
```

Do not commit yet — the squash in step 5 handles it.

## 5. Squash to single commit since last tag

### 5a. Safety check

Confirm intermediate commits have **not** been pushed to `origin/main` — otherwise the squash would require a force-push.

```bash
git fetch origin

PKG_NAME=$(node -p "require('./package.json').name")
LAST_TAG=$(git tag --sort=-version:refname | grep "^${PKG_NAME}@" | head -n1 || echo "")
REMOTE_MAIN=$(git rev-parse origin/main)
echo "Package: $PKG_NAME"
echo "Last tag: ${LAST_TAG:-<none>}"
echo "Remote main: $REMOTE_MAIN"

if [ -n "$LAST_TAG" ] && [ "$REMOTE_MAIN" != "$(git rev-parse "${LAST_TAG}^{commit}" 2>/dev/null || echo '')" ]; then
  echo "Warning: origin/main is not at the last tag. Squashing would require a force-push."
fi

git log --oneline --decorate ${LAST_TAG:+"${LAST_TAG}..HEAD"}
```

If the warning fires, **stop and confirm with the user** before proceeding. Force-pushing main rewrites shared history.

### 5b. Squash

```bash
PKG_NAME=$(node -p "require('./package.json').name")
LAST_TAG=$(git tag --sort=-version:refname | grep "^${PKG_NAME}@" | head -n1 || echo "")

if [ -n "$LAST_TAG" ]; then
  git reset --soft "$LAST_TAG"
else
  git reset --soft $(git rev-list --max-parents=0 HEAD)
fi

git add -A
NEW_VERSION=$(node -p "require('./package.json').version")
git commit -m "chore: release ${PKG_NAME} v${NEW_VERSION}"
```

## 6. Push to main

```bash
git push origin main
```

Push before publishing so CI and tags line up.

## 7. Get OTP and publish

npm has 2FA enabled (`auth-and-writes`). `npm publish` blocks on an interactive prompt that cannot be automated.

**Always publish with `--ignore-scripts`.** This package's `prepublishOnly` runs `clean && build && typecheck` — roughly 40 seconds — and npm runs it *before* uploading the tarball and validating the OTP. A 30-second TOTP is therefore already expired by the time npm checks it, and the publish fails with `EOTP` no matter how fresh the code was when the user sent it. Steps 2 and 3 have already run exactly those checks against exactly this tree, so re-running them buys nothing and costs the release.

**Ask the user**: *"Open your authenticator app and give me your npm 2FA OTP — I'll publish immediately."*

Then publish:

```bash
NEW_VERSION=$(node -p "require('./package.json').version")
PKG_NAME=$(node -p "require('./package.json').name")
npm publish --ignore-scripts --otp=<OTP_FROM_USER>
```

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

Resolve auth *before* step 5, not after: a pushed release commit and tag for a version that never published leaves `main` claiming a release that does not exist.

## 8. Create and push tag

We bypassed `changeset publish`, so the tag must be created manually. Changesets format: `@scope/name@version` (e.g. `@jambudipa/spider@0.9.0`).

```bash
NEW_VERSION=$(node -p "require('./package.json').version")
PKG_NAME=$(node -p "require('./package.json').name")
TAG="${PKG_NAME}@${NEW_VERSION}"

git tag "$TAG"
git push origin "$TAG"
echo "Tagged and pushed: $TAG"
```

## 9. Verify

```bash
PKG_NAME=$(node -p "require('./package.json').name")
NEW_VERSION=$(node -p "require('./package.json').version")
npm view "$PKG_NAME" version
echo "Published ${PKG_NAME}@${NEW_VERSION}"
```

Optionally create a GitHub Release from the tag with notes from CHANGELOG.

## Notes

- `npm pack --dry-run` respects `files` and `.npmignore` — trust it for what will publish.
- `--ignore-scripts` at publish time skips `prepublishOnly` **and** `prepack`. `prepack` also runs the build, so `dist/` must already be current — rebuild after `changeset version` (step 4) so the shipped bundle carries the new version, not the previous one.
- Granular access tokens no longer bypass 2FA (npm deprecated `bypass2FA` in 2026), so interactive OTP is now unavoidable for an `auth-and-writes` account. There is no token you can add to `.npmrc` to make this step non-interactive except a CI automation token.
- Changesets tags are **lightweight** (not annotated). `git push --follow-tags` will not push them — always use explicit `git push origin "<tag>"`.
- `git describe --tags --abbrev=0` may miss Changesets-format tags. Use the `git tag | grep` pattern instead.
- For CI, use `NODE_AUTH_TOKEN` via `//registry.npmjs.org/:_authToken` in `.npmrc` instead of interactive OTP.
