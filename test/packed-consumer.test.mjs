import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
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
export default defineConfig({ integrations: [starlight({ title: 'Fixture docs', plugins: [starlightLlmsTree()] })] });
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
  assert.match(llms, /\[Overview\]\(\.\/index\.md\)/);
  assert.match(markdown, /^# Overview/m);
  assert.match(markdown, /Welcome to the packed consumer\. This content must remain readable\./);

  await put(root, 'public/index.md', 'existing file must survive\n');
  await failedBuild(root, /Refusing to overwrite generated output target .*index\.md/);
  await assert.rejects(readFile(path.join(root, 'dist/llms.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(root, 'dist/index.md'), 'utf8'), 'existing file must survive\n');

  await rm(path.join(root, 'public/index.md'));
  await put(root, 'public/llms.txt/marker', 'existing directory must survive\n');
  await failedBuild(root, /Refusing to overwrite generated output target .*llms\.txt/);
  await assert.rejects(readFile(path.join(root, 'dist/index.md')), { code: 'ENOENT' });
  assert.equal(
    await readFile(path.join(root, 'dist/llms.txt/marker'), 'utf8'),
    'existing directory must survive\n',
  );

  await rm(path.join(root, 'public/llms.txt'), { recursive: true });
  await rename(
    path.join(root, 'src/content/docs/index.md'),
    path.join(root, 'src/content/docs/guide.md'),
  );
  await failedBuild(root, /requires a root Starlight page/);
});
