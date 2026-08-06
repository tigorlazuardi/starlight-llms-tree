import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, link, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const maxBuffer = 10 * 1024 * 1024;

const put = async (root, name, content) => {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
};

const failedBuild = async (root, message) => {
  await assert.rejects(exec('npm', ['run', 'build'], { cwd: root, maxBuffer }), (error) => {
    assert.match(`${error.stdout}\n${error.stderr}`, message);
    return true;
  });
};

test('packed plugin typechecks and builds a real Starlight consumer safely', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'starlight-llms-tree-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const packed = JSON.parse(
    (await exec('npm', ['pack', '--json', '--pack-destination', root], { maxBuffer })).stdout,
  )[0].filename;

  await put(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      type: 'module',
      scripts: { build: 'astro build', typecheck: 'astro sync && tsc --noEmit' },
      dependencies: {
        '@astrojs/starlight': '0.41.6',
        astro: '7.1.6',
        'starlight-llms-tree': `file:${path.join(root, packed)}`,
        typescript: '5.9.3',
      },
    }),
  );
  await put(
    root,
    'astro.config.mjs',
    `import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { starlightLlmsTree } from 'starlight-llms-tree';
export default defineConfig({ base: '/docs', integrations: [starlight({ title: 'Fixture docs', plugins: [starlightLlmsTree()] })] });
`,
  );
  await put(
    root,
    'tsconfig.json',
    JSON.stringify({ extends: 'astro/tsconfigs/strict' }),
  );
  await put(
    root,
    'type-proof.ts',
    `import type { StarlightPlugin } from '@astrojs/starlight/types';
import { starlightLlmsTree, type StarlightLlmsTreeOptions } from 'starlight-llms-tree';
const options: StarlightLlmsTreeOptions = {};
const plugin: StarlightPlugin = starlightLlmsTree(options);
plugin.name satisfies string;
`,
  );
  await put(
    root,
    'src/content.config.ts',
    `import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
export const collections = { docs: defineCollection({ loader: docsLoader({ generateId: ({ entry }) => entry === 'nfd.md' ? 'unicode/e\\u0301' : entry.replace(/\\.mdx?$/, '') }), schema: docsSchema({ extend: z.object({ category: z.enum(['guide', 'reference']).optional(), tags: z.array(z.string()).optional() }) }) }) };
`,
  );
  await put(
    root,
    'src/content/docs/index.mdx',
    `---
title: Overview
description: Rich fixture page
category: guide
tags: [product, product/core]
pagefind: false
sidebar:
  order: 2
  label: Packed overview
---

import { Aside, FileTree, TabItem, Tabs } from '@astrojs/starlight/components';

Welcome to the packed consumer. This content must remain readable.

## Install [guide heading](/docs/guide/#start) with \`code\`

- First item
- Second item

<ol start="3"><li>Third</li><li value="7">Seventh</li><li>Eighth</li></ol>

<ol reversed><li>Third</li><li>Second</li><li>First</li></ol>

<ol reversed start="8"><li>Eighth</li><li value="4">Fourth</li><li>Third</li></ol>

<table><thead><tr><th>Tool</th><th>Ready</th></tr></thead><tbody><tr><td><a href="/docs/guide/#start">Pack</a></td><td>yes</td></tr></tbody></table>

<video controls src="/docs/demo.mp4"><source src="/docs/demo.webm" type="video/webm" />Video fallback</video>

<iframe src="https://example.com/embed" title="Demo"></iframe>

<Aside type="tip" title="Remember">Keep **semantic content**.</Aside>

<Tabs>
  <TabItem label="npm">\`npm install package\`</TabItem>
  <TabItem label="pnpm">\`pnpm add package\`</TabItem>
</Tabs>

<details>
  <summary>More information</summary>

  Details stay readable.
</details>

\`\`\`js title="example.js"
console.log('rich code');
\`\`\`

<FileTree>
- src/
  - index.ts
- package.json
</FileTree>

<section class="feature">Useful [guide link](/docs/guide/?view=full#start), [download](/docs/download), [feed](/docs/feed/), [report](/docs/report.html?raw=1#top), <kbd>Ctrl</kbd>, [fragment](#install), [external](https://example.com/docs), and [asset](/docs/logo.svg).</section>

{/* converter must remove this comment */}
`,
  );
  await put(
    root,
    'src/content/docs/guide.md',
    `---
title: Guide
category: reference
description: Direct guide.
tags: [guide]
---

# Start
`,
  );
  const extraPages = {
    'changelog.md': `---
title: Changelog
description: Product changes.
tags: [releases/history]
---

Release notes.
`,
    'nfd.md': `---
title: NFD route
tags: [unicode/survive]
---

NFD page.
`,
    'zulu.md': `---
title: Zulu
tags: [plain]
---

Zulu page.
`,
    'eclair.md': `---
title: Éclair
tags: [accent/topic]
---

Éclair page.
`,
    'guides/index.md': `---
title: Guides
description: Build fixture apps.
tags: [guide, setup/basics]
---

Guide overview.
`,
    'guides/install.md': `---
title: Install
description: Install fixture apps.
tags: [setup/linux, setup/mac]
---

Install steps.
`,
    'reference/api/endpoints.md': `---
title: Endpoints
description: HTTP endpoint reference.
tags: [api/http]
---

Endpoint details.
`,
    'zulu-folder/index.md': `---
title: Zulu folder
tags: [zulu]
---

Zulu folder overview.
`,
    'zulu-folder/child.md': `---
title: Child Zulu
tags: [zulu/child]
---

Zulu child.
`,
    'eclair-folder/index.md': `---
title: Éclair folder
tags: [éclair]
---

Éclair folder overview.
`,
    'eclair-folder/child.md': `---
title: Child Éclair
tags: [éclair/child]
---

Éclair child.
`,
  };
  for (const [name, content] of Object.entries(extraPages)) {
    await put(root, `src/content/docs/${name}`, content);
  }
  await put(root, 'src/pages/download.astro', '<h1>Download endpoint</h1>\n');
  await put(root, 'public/feed/index.html', '<p>Feed endpoint</p>\n');
  await put(root, 'public/report.html', '<p>Raw report</p>\n');
  await put(root, 'public/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');

  await exec('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: root,
    maxBuffer,
  });

  const installed = path.join(root, 'node_modules/starlight-llms-tree');
  const module = await import(pathToFileURL(path.join(installed, 'dist/index.js')));
  assert.deepEqual(Object.keys(module), ['starlightLlmsTree']);

  const { publishGeneratedArtifacts } = await import(
    pathToFileURL(path.join(installed, 'dist/publish.js'))
  );
  const writeFailureRoot = path.join(root, 'write-failure');
  await mkdir(writeFailureRoot);
  await put(writeFailureRoot, 'collision.txt', 'unrelated collision must survive\n');
  const failedWriteTarget = pathToFileURL(path.join(writeFailureRoot, 'index.md'));
  await assert.rejects(
    publishGeneratedArtifacts(
      [{ url: failedWriteTarget, content: 'generated index\n' }],
      link,
      async (file) => {
        await file.writeFile('partial');
        throw new Error('injected write failure');
      },
    ),
    /injected write failure/,
  );
  await assert.rejects(readFile(failedWriteTarget), { code: 'ENOENT' });
  assert.equal(
    await readFile(path.join(writeFailureRoot, 'collision.txt'), 'utf8'),
    'unrelated collision must survive\n',
  );
  assert.deepEqual(await readdir(writeFailureRoot), ['collision.txt']);

  const lateFailureRoot = path.join(root, 'late-failure');
  await mkdir(lateFailureRoot);
  const firstTarget = pathToFileURL(path.join(lateFailureRoot, 'index.md'));
  const secondTarget = pathToFileURL(path.join(lateFailureRoot, 'llms.txt'));
  let publishes = 0;
  await assert.rejects(
    publishGeneratedArtifacts(
      [
        { url: firstTarget, content: 'generated index\n' },
        { url: secondTarget, content: 'generated manifest\n' },
      ],
      async (source, target) => {
        if (++publishes === 2) await writeFile(target, 'late collision must survive\n', { flag: 'wx' });
        await link(source, target);
      },
    ),
    /Refusing to overwrite generated output target .*llms\.txt/,
  );
  await assert.rejects(readFile(firstTarget), { code: 'ENOENT' });
  assert.equal(await readFile(secondTarget, 'utf8'), 'late collision must survive\n');
  assert.deepEqual(await readdir(lateFailureRoot), ['llms.txt']);

  await exec('npm', ['run', 'typecheck'], { cwd: root, maxBuffer });

  const build = await exec('npm', ['run', 'build'], { cwd: root, maxBuffer });
  assert.doesNotMatch(`${build.stdout}\n${build.stderr}`, /generated_artifacts/);

  const llms = await readFile(path.join(root, 'dist/llms.txt'), 'utf8');
  const markdown = await readFile(path.join(root, 'dist/index.md'), 'utf8');
  const guideMarkdown = await readFile(path.join(root, 'dist/guide.md'), 'utf8');
  assert.equal(
    llms,
    `# Overview

> Rich fixture page

## Pages

- [Overview](/docs/index.md): Rich fixture page
  - Tags: \`product\`, \`product/core\`
- [Changelog](/docs/changelog.md): Product changes.
  - Tags: \`releases/history\`
- [Guide](/docs/guide.md): Direct guide.
  - Tags: \`guide\`
- [Zulu](/docs/zulu.md)
  - Tags: \`plain\`
- [Éclair](/docs/eclair.md)
  - Tags: \`accent/topic\`

## Folders

- [Guides](/docs/guides/llms.txt): Build fixture apps.
  - Scopes: \`guide\`, \`setup\`
- [Reference](/docs/reference/llms.txt)
  - Scopes: \`api\`
- [Unicode](/docs/unicode/llms.txt)
  - Scopes: \`unicode\`
- [Zulu folder](/docs/zulu-folder/llms.txt)
  - Scopes: \`zulu\`
- [Éclair folder](/docs/eclair-folder/llms.txt)
  - Scopes: \`éclair\`
`,
  );
  assert.equal(
    await readFile(path.join(root, 'dist/guides/llms.txt'), 'utf8'),
    `# Guides

> Build fixture apps.

## Pages

- [Overview](/docs/guides.md): Build fixture apps.
  - Tags: \`guide\`, \`setup/basics\`
- [Install](/docs/guides/install.md): Install fixture apps.
  - Tags: \`setup/linux\`, \`setup/mac\`
`,
  );
  assert.equal(
    await readFile(path.join(root, 'dist/reference/llms.txt'), 'utf8'),
    `# Reference

## Folders

- [Api](/docs/reference/api/llms.txt)
  - Scopes: \`api\`
`,
  );
  assert.equal(
    await readFile(path.join(root, 'dist/reference/api/llms.txt'), 'utf8'),
    `# Api

## Pages

- [Endpoints](/docs/reference/api/endpoints.md): HTTP endpoint reference.
  - Tags: \`api/http\`
`,
  );
  assert.equal(
    await readFile(path.join(root, 'dist/unicode/llms.txt'), 'utf8'),
    `# Unicode

## Pages

- [NFD route](/docs/unicode/é.md)
  - Tags: \`unicode/survive\`
`,
  );
  assert.deepEqual(
    ['Zulu', 'Éclair'].toSorted((left, right) => left.localeCompare(right, 'en')),
    ['Éclair', 'Zulu'],
  );
  assert.ok(llms.indexOf('[Zulu]') < llms.indexOf('[Éclair]'));
  assert.deepEqual(
    ['Zulu folder', 'Éclair folder'].toSorted((left, right) => left.localeCompare(right, 'en')),
    ['Éclair folder', 'Zulu folder'],
  );
  assert.ok(llms.indexOf('[Zulu folder]') < llms.indexOf('[Éclair folder]'));
  assert.match(guideMarkdown, /^---[\s\S]*"title": "Guide"[\s\S]*---\n\n# Guide/);
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---\n\n# Overview/);
  assert.ok(frontmatterMatch);
  const frontmatter = JSON.parse(frontmatterMatch[1]);
  assert.equal(frontmatter.title, 'Overview');
  assert.equal(frontmatter.description, 'Rich fixture page');
  assert.equal(frontmatter.category, 'guide');
  assert.deepEqual(frontmatter.tags, ['product', 'product/core']);
  assert.equal(frontmatter.pagefind, false);
  assert.equal(frontmatter.template, 'doc');
  assert.equal(frontmatter.editUrl, true);
  assert.equal(frontmatter.sidebar.order, 2);
  assert.equal(frontmatter.sidebar.label, 'Packed overview');
  assert.equal(frontmatter.sidebar.hidden, false);
  assert.match(markdown, /Welcome to the packed consumer\. This content must remain readable\./);
  assert.match(markdown, /## Install \[guide heading\]\(\/docs\/guide\.md#start\) with `code`/);
  assert.match(markdown, /- First item\n- Second item/);
  assert.match(markdown, /3\. Third\n7\. Seventh\n8\. Eighth/);
  assert.match(markdown, /3\. Third\n2\. Second\n1\. First/);
  assert.match(markdown, /8\. Eighth\n4\. Fourth\n3\. Third/);
  assert.match(markdown, /<table><thead><tr><th>Tool<\/th><th>Ready<\/th><\/tr><\/thead><tbody><tr><td><a href="\/docs\/guide\.md#start">Pack<\/a><\/td><td>yes<\/td><\/tr><\/tbody><\/table>/);
  assert.match(markdown, /<video controls="" src="\/docs\/demo\.mp4"><source src="\/docs\/demo\.webm" type="video\/webm">Video fallback<\/video>/);
  assert.match(markdown, /<iframe src="https:\/\/example\.com\/embed" title="Demo"><\/iframe>/);
  assert.match(markdown, /> \[!TIP\]\n> \*\*Remember\*\*\n> Keep \*\*semantic content\*\*\./);
  assert.match(markdown, /### npm\n\n`npm install package`/);
  assert.match(markdown, /### pnpm\n\n`pnpm add package`/);
  assert.match(markdown, /<details>[\s\S]*<summary>More information<\/summary>[\s\S]*Details stay readable\.[\s\S]*<\/details>/);
  assert.match(markdown, /```js\nconsole\.log\('rich code'\);\n```/);
  assert.match(markdown, /<summary>src\/<\/summary>[\s\S]*- index\.ts[\s\S]*- package\.json/);
  assert.match(markdown, /\[guide link\]\(\/docs\/guide\.md\?view=full#start\)/);
  assert.match(markdown, /\[download\]\(\/docs\/download\)/);
  assert.match(markdown, /\[feed\]\(\/docs\/feed\/\)/);
  assert.match(markdown, /\[report\]\(\/docs\/report\.html\?raw=1#top\)/);
  assert.match(markdown, /<kbd>Ctrl<\/kbd>/);
  assert.match(markdown, /\[fragment\]\(#install\)/);
  assert.match(markdown, /\[external\]\(https:\/\/example\.com\/docs\)/);
  assert.match(markdown, /\[asset\]\(\/docs\/logo\.svg\)/);
  assert.doesNotMatch(markdown, /converter must remove this comment|tablist-wrapper|starlight-aside__title/);

  const generatedMarkdown = (await readdir(path.join(root, 'dist'), { recursive: true }))
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(root, 'dist', name));
  assert.deepEqual(
    generatedMarkdown.map((name) => path.relative(path.join(root, 'dist'), name)).sort(),
    [
      '404.md',
      'changelog.md',
      'eclair-folder.md',
      'eclair-folder/child.md',
      'eclair.md',
      'guide.md',
      'guides.md',
      'guides/install.md',
      'index.md',
      'reference/api/endpoints.md',
      'unicode/é.md',
      'zulu-folder.md',
      'zulu-folder/child.md',
      'zulu.md',
    ],
  );
  const generatedIndexes = (await readdir(path.join(root, 'dist'), { recursive: true }))
    .filter((name) => name.endsWith('llms.txt'))
    .map((name) => path.join(root, 'dist', name));
  assert.deepEqual(
    generatedIndexes.map((name) => path.relative(path.join(root, 'dist'), name)).sort(),
    [
      'eclair-folder/llms.txt',
      'guides/llms.txt',
      'llms.txt',
      'reference/api/llms.txt',
      'reference/llms.txt',
      'unicode/llms.txt',
      'zulu-folder/llms.txt',
    ],
  );
  for (const source of [...generatedIndexes, ...generatedMarkdown]) {
    const content = await readFile(source, 'utf8');
    for (const match of content.matchAll(/\]\(([^)?#]+(?:\.md|llms\.txt))(?:[?#][^)]*)?\)/g)) {
      const target = match[1].startsWith('/docs/')
        ? path.join(root, 'dist', match[1].slice('/docs/'.length))
        : path.resolve(path.dirname(source), match[1]);
      assert.ok(target.startsWith(path.join(root, 'dist') + path.sep));
      await access(target);
    }
  }

  await put(root, 'public/index.md', 'existing file must survive\n');
  await failedBuild(root, /Refusing to overwrite generated output target .*index\.md/);
  await assert.rejects(readFile(path.join(root, 'dist/llms.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(root, 'dist/index.md'), 'utf8'), 'existing file must survive\n');

  await rm(path.join(root, 'public/index.md'));
  await put(root, 'public/llms.txt/marker', 'existing directory must survive\n');
  await failedBuild(root, /Refusing to overwrite generated output target .*llms\.txt/);
  await assert.rejects(readFile(path.join(root, 'dist/index.md')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(root, 'dist/guide.md')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(root, 'dist/404.md')), { code: 'ENOENT' });
  assert.equal(
    await readFile(path.join(root, 'dist/llms.txt/marker'), 'utf8'),
    'existing directory must survive\n',
  );

  await rm(path.join(root, 'public/llms.txt'), { recursive: true });
  await rename(
    path.join(root, 'src/content/docs/index.mdx'),
    path.join(root, 'src/content/docs/renamed-root.mdx'),
  );
  await failedBuild(root, /requires a root Starlight page/);
});
