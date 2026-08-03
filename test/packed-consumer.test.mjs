import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const put = async (root, name, content) => {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
};

test('packed plugin builds a fresh Starlight consumer and writes public artifacts', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'starlight-llms-tree-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const packed = JSON.parse(
    (await exec('npm', ['pack', '--json', '--pack-destination', root])).stdout,
  )[0].filename;

  await put(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      type: 'module',
      scripts: { build: 'astro build' },
      dependencies: {
        '@astrojs/starlight': '0.41.6',
        astro: '7.1.6',
        'starlight-llms-tree': `file:${path.join(root, packed)}`,
      },
    }),
  );
  await put(
    root,
    'astro.config.mjs',
    `import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { starlightLlmsTree } from 'starlight-llms-tree';
export default defineConfig({ integrations: [starlight({ title: 'Fixture docs' }), starlightLlmsTree()] });
`,
  );
  await put(
    root,
    'src/content.config.ts',
    `import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
export const collections = { docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }) };
`,
  );
  await put(
    root,
    'src/content/docs/index.md',
    `---
title: Overview
---

Welcome to the packed consumer. This content must remain readable.
`,
  );

  await exec('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });

  const installed = path.join(root, 'node_modules/starlight-llms-tree');
  const declarations = await readFile(path.join(installed, 'dist/index.d.ts'), 'utf8');
  assert.match(declarations, /export interface StarlightLlmsTreeOptions/);
  assert.match(declarations, /export declare const starlightLlmsTree/);
  const module = await import(pathToFileURL(path.join(installed, 'dist/index.js')));
  assert.equal(typeof module.starlightLlmsTree, 'function');

  const build = await exec('npm', ['run', 'build'], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  assert.match(build.stdout, /generated_artifacts count=2/);

  const llms = await readFile(path.join(root, 'dist/llms.txt'), 'utf8');
  const markdown = await readFile(path.join(root, 'dist/index.md'), 'utf8');
  assert.match(llms, /\[Overview\]\(\.\/index\.md\)/);
  assert.match(markdown, /^# Overview/m);
  assert.match(markdown, /Welcome to the packed consumer\. This content must remain readable\./);

  await rename(
    path.join(root, 'src/content/docs/index.md'),
    path.join(root, 'src/content/docs/guide.md'),
  );
  await assert.rejects(
    exec('npm', ['run', 'build'], { cwd: root, maxBuffer: 10 * 1024 * 1024 }),
    (error) => {
      assert.match(`${error.stdout}\n${error.stderr}`, /requires a root Starlight page/);
      return true;
    },
  );
});
