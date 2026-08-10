# Releasing

CI already runs `npm test` for pull requests and `main` against lowest and latest-compatible Astro/Starlight versions.

## First publish: manual

Package starts at `0.1.0` and publishes publicly as `@tigorhutasuhut/starlight-llms-tree`.

```sh
npm login
npm ci
npm test
npm pack --dry-run
npm publish --access public
```

Confirm <https://www.npmjs.com/package/@tigorhutasuhut/starlight-llms-tree> exists before enabling trusted publishing.

## Enable npm trusted publishing

1. In GitHub repository settings, create environment named `npm`. Add required reviewers if desired.
2. In npm package settings, add GitHub Actions as trusted publisher with exact values:
   - Organization or user: `tigorlazuardi`
   - Repository: `starlight-llms-tree`
   - Workflow filename: `publish.yml`
   - Environment name: `npm`
   - Allowed action: `npm publish`
3. Do not add `NPM_TOKEN`; `.github/workflows/publish.yml` uses short-lived GitHub OIDC credentials.
4. Revoke obsolete npm automation tokens after one trusted publish succeeds.

## Later releases

1. Update changelog or release notes as needed.
2. Run `npm version patch`, `npm version minor`, or `npm version major`.
3. Push commit and tag: `git push origin main --follow-tags`.
4. Publish a GitHub Release for matching `v<package version>` tag.

Publishing release triggers tests, verifies tag matches `package.json`, then runs `npm publish --access public`. npm adds provenance automatically. Prerelease GitHub Releases are intentionally skipped until npm dist-tag handling exists.
