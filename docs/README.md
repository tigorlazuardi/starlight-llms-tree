# starlight-llms-tree documentation

Published user guides, design decisions, and lesson-learnt reports for `starlight-llms-tree`.

Read published docs at <https://tigorlazuardi.github.io/starlight-llms-tree/>.

## Run locally

Docs consume packed plugin, matching production deployment. From repository root:

```sh
npm install
tarball=$(npm pack --pack-destination /tmp --silent)
npm install --prefix docs --no-save "/tmp/$tarball"
npm run --prefix docs dev
```

Build static docs with `npm run --prefix docs build`.

Product usage lives under `docs/src/content/docs/usage/`. Long-lived design decisions and reports live beside it under `design/` and `reports/`.
