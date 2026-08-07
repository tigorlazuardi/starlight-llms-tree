import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const maxBuffer = 10 * 1024 * 1024;
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const run = (cwd, args) => exec('npm', args, { cwd, maxBuffer });

test('packed package builds repository usage site with documented endpoints', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'starlight-llms-tree-docs-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const site = path.join(root, 'docs');
  await cp(path.join(repository, 'docs'), site, {
    recursive: true,
    filter: (source) => !['node_modules', 'dist', '.astro'].includes(path.basename(source)),
  });

  const packed = JSON.parse((await run(repository, ['pack', '--json', '--pack-destination', root])).stdout)[0]
    .filename;
  await run(site, ['ci']);
  await run(site, ['install', '--no-save', '--package-lock=false', path.join(root, packed)]);
  await run(site, ['run', 'build']);

  const dist = path.join(site, 'dist');
  const [rootIndex, usageIndex, usagePage, configurationPage, outputPage] = await Promise.all([
    readFile(path.join(dist, 'llms.txt'), 'utf8'),
    readFile(path.join(dist, 'usage/llms.txt'), 'utf8'),
    readFile(path.join(dist, 'usage.md'), 'utf8'),
    readFile(path.join(dist, 'usage/configuration.md'), 'utf8'),
    readFile(path.join(dist, 'usage/output.md'), 'utf8'),
  ]);

  assert.match(rootIndex, /\[Usage\]\(https:\/\/tigorlazuardi\.github\.io\/starlight-llms-tree\/usage\/llms\.txt\)/);
  assert.match(usageIndex, /\[Configuration\].*configuration\.md/);
  assert.match(usageIndex, /\[Output\].*output\.md/);
  assert.match(usagePage, /starlightLlmsTree\(\)/);
  assert.match(configurationPage, /STARLIGHT_LLMS_TREE_DEBUG=1/);
  assert.match(outputPage, /dist\/reference\/api\/llms\.txt/);
});
