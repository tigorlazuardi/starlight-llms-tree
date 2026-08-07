# starlight-llms-tree documentation

Published installation, configuration, output, and troubleshooting guides for `starlight-llms-tree`.

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

User documentation lives under `docs/src/content/docs/usage/`.
