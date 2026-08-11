---
name: release-npm-package
description: Release and deploy this repository's npm package through GitHub Release and npm trusted publishing. Use whenever asked to publish, deploy, or cut a package release for @tigorhutasuhut/starlight-llms-tree.
---

# Release npm package

Read `RELEASING.md`, `package.json`, and `.github/workflows/publish.yml` before acting. Current files are source of truth.

1. Fetch `origin/main`; confirm local `main` matches remote and preserve unrelated changes.
2. Read current npm version with `npm view @tigorhutasuhut/starlight-llms-tree version`. Choose next stable semver with user; workflow intentionally skips prereleases.
3. Get explicit confirmation immediately before outward-facing release actions. State version, commit/tag/release actions, and npm publish effect.
4. Set version with `npm version <version> --no-git-tag-version`. Run `git diff --check` and `npm test`.
5. Stage only release scope. Commit conventional change, push `main`, create annotated `v<version>` tag, then push tag. Never force-push.
6. Create public GitHub Release for exact tag. `.github/workflows/publish.yml` publishes via OIDC; never add `NPM_TOKEN`.
7. Watch resulting Publish package workflow through completion. Verify `npm view @tigorhutasuhut/starlight-llms-tree@<version> version dist-tags.latest --json`.
8. Report commit, release URL, workflow URL/verdict, npm version, checks, and residual untracked files.

Fail closed on tag/package version mismatch, failed tests, remote divergence, existing npm version, or failed workflow. Diagnose before retrying; npm versions are immutable.
