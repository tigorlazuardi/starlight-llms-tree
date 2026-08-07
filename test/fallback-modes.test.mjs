import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { starlightLlmsTree } from '../dist/index.js';
import { onRequest } from '../dist/metadata-middleware.js';

const runBuild = async (root, options = {}, includeGuide = false) => {
  let integration;
  const plugin = starlightLlmsTree(options);
  plugin.hooks['config:setup']({
    addIntegration(value) {
      integration = value;
    },
    addRouteMiddleware() {},
    astroConfig: { base: '/', build: { format: 'directory' } },
  });
  await onRequest(
    {
      locals: {
        starlightRoute: {
          entry: {
            body: 'Authored **raw** body.\n',
            collection: 'docs',
            data: { title: 'Fallback fixture' },
          },
          sidebar: [],
        },
      },
      url: new URL('https://example.test/'),
    },
    async () => new Response(),
  );
  if (includeGuide) {
    await onRequest(
      {
        locals: {
          starlightRoute: {
            entry: {
              body: 'Guide authored body.\n',
              collection: 'docs',
              data: { title: 'Guide' },
            },
            sidebar: [],
          },
        },
        url: new URL('https://example.test/guide/'),
      },
      async () => new Response(),
    );
  }
  const messages = { debug: [], warn: [] };
  await integration.hooks['astro:build:done']({
    dir: pathToFileURL(`${root}${path.sep}`),
    logger: {
      info(message) {
        messages.debug.push(message);
      },
      warn(message) {
        messages.warn.push(message);
      },
    },
    pages: [{ pathname: '/' }, ...(includeGuide ? [{ pathname: '/guide/' }] : [])],
  });
  return messages;
};

test('recoverable page failure emits authored raw body and warning', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'starlight-fallback-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(path.join(root, 'index.html'), '<main>missing Starlight content</main>');
  await mkdir(path.join(root, 'guide'));
  await writeFile(
    path.join(root, 'guide/index.html'),
    '<main class="sl-markdown-content"><p>Normalized guide body.</p></main>',
  );

  const messages = await runBuild(root, {}, true);

  assert.equal(await readFile(path.join(root, 'index.md'), 'utf8'), 'Authored **raw** body.\n');
  assert.match(await readFile(path.join(root, 'guide.md'), 'utf8'), /Normalized guide body\./);
  assert.equal(messages.warn.length, 1);
  assert.match(messages.warn[0], /Recoverable page normalization failure.*authored raw body/);
  assert.deepEqual(messages.debug, []);
  assert.ok((await readdir(root)).includes('llms.txt'));
});

test('strict page failure is fatal without generated artifacts', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'starlight-strict-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(path.join(root, 'index.html'), '<main>missing Starlight content</main>');

  await assert.rejects(runBuild(root, { strict: true }), /Failed to normalize page/);
  assert.deepEqual(await readdir(root), ['index.html']);
});

test('STARLIGHT_LLMS_TREE_DEBUG=1 enables content-free diagnostics', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'starlight-env-debug-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(path.join(root, 'index.html'), '<main class="sl-markdown-content"><p>Safe output</p></main>');
  const previous = process.env.STARLIGHT_LLMS_TREE_DEBUG;
  process.env.STARLIGHT_LLMS_TREE_DEBUG = '1';
  try {
    const messages = await runBuild(root);
    assert.ok(messages.debug.some((message) => message.includes('normalization stage=complete')));
    assert.ok(messages.debug.every((message) => !message.includes('Safe output')));
  } finally {
    if (previous === undefined) delete process.env.STARLIGHT_LLMS_TREE_DEBUG;
    else process.env.STARLIGHT_LLMS_TREE_DEBUG = previous;
  }
});

test('raw content bypasses rendered-page normalization globally', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'starlight-raw-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(root, { recursive: true });

  const messages = await runBuild(root, { debug: true, rawContent: true });

  assert.equal(await readFile(path.join(root, 'index.md'), 'utf8'), 'Authored **raw** body.\n');
  assert.deepEqual(messages.warn, []);
  assert.ok(messages.debug.some((message) => message.includes('normalization stage=bypass')));
  assert.ok(messages.debug.some((message) => message.includes('manifest publish targets=')));
  assert.ok(messages.debug.every((message) => !message.includes('Authored **raw** body.')));
});
