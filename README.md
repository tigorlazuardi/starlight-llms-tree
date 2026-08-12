# starlight-llms-tree

Generate recursive `llms.txt` indexes and Markdown endpoints for every published page in a static Starlight site.

**[Read documentation →](https://tigorlazuardi.github.io/starlight-llms-tree/)** · **[Open generated top-level llms.txt →](https://tigorlazuardi.github.io/starlight-llms-tree/llms.txt)**

## Requirements

- Node.js 22.12 or later
- Astro 7.0.2–7.x
- Starlight 0.41.6–0.41.x

## Install

```sh
npm install @tigorhutasuhut/starlight-llms-tree
```

Add plugin to Starlight integration:

```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { starlightLlmsTree } from '@tigorhutasuhut/starlight-llms-tree';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Docs',
      plugins: [starlightLlmsTree()],
    }),
  ],
});
```

Run normal static build:

```sh
npm run build
```

Build output includes:

- root `llms.txt` plus recursive folder indexes;
- one `.md` endpoint per published Starlight page;
- links based on final public routes, Astro `base`, and `site`.

```text
/
/guides/
/guides/install/
```

```text
dist/llms.txt
dist/index.md
dist/guides/llms.txt
dist/guides.md
dist/guides/install.md
```

## Configuration

```js
starlightLlmsTree({
  strict: false,
  rawContent: false,
  debug: false,
})
```

All options default to `false`. `strict` and `rawContent` cannot both be `true`.

- `strict`: fail build on recoverable normalization errors.
- `rawContent`: emit authored Markdown body without rendered-page normalization.
- `debug`: emit content-free route, manifest, and normalization diagnostics.

Enable debug for one build with `STARLIGHT_LLMS_TREE_DEBUG=1 npm run build`.

## Documentation

- [Usage](https://tigorlazuardi.github.io/starlight-llms-tree/usage/)
- [Configuration and diagnostics](https://tigorlazuardi.github.io/starlight-llms-tree/usage/configuration/)
- [Output contract and recursive traversal](https://tigorlazuardi.github.io/starlight-llms-tree/usage/output/)
