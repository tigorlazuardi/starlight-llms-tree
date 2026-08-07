import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { publishGeneratedArtifacts, validateOutputManifest } from '../dist/publish.js';
import { assertSafeRoute } from '../dist/route.js';

const artifact = (root, target, sourceRoute) => ({
  url: pathToFileURL(path.join(root, target)),
  content: 'generated\n',
  sourceRoute,
});

const fixture = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'starlight-output-manifest-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
};

test('unsafe routes fail before output target construction', () => {
  for (const route of [
    '/docs/../secret/',
    '/docs/%2e%2e/secret/',
    '/docs/a%2Fb/',
    '/docs/a%5Cb/',
    '/docs/a\\b/',
    '/docs/a\0b/',
    '/docs/a%00b/',
    '/docs/%not-encoded/',
  ]) {
    assert.throws(() => assertSafeRoute(route), /Unsafe generated route/);
  }
  assert.doesNotThrow(() => assertSafeRoute('/docs/unicode/é/'));
});

test('manifest rejects portable generated collisions and output-directory escapes', async (t) => {
  const root = await fixture(t);
  const outputDirectory = pathToFileURL(`${root}${path.sep}`);

  await assert.rejects(
    validateOutputManifest(
      [artifact(root, 'Guide.md', '/docs/Guide/'), artifact(root, 'guide.MD', '/docs/guide/')],
      outputDirectory,
    ),
    /routes \/docs\/Guide\/ and \/docs\/guide\/ targeting .*guide\.MD/,
  );
  await assert.rejects(
    validateOutputManifest(
      [artifact(root, 'é.md', '/docs/nfc/'), artifact(root, 'é.md', '/docs/nfd/')],
      outputDirectory,
    ),
    /routes \/docs\/nfc\/ and \/docs\/nfd\//,
  );
  await assert.rejects(
    validateOutputManifest(
      [artifact(root, 'folder', '/docs/file/'), artifact(root, 'folder/child.md', '/docs/child/')],
      outputDirectory,
    ),
    /routes \/docs\/file\/ and \/docs\/child\//,
  );
  await assert.rejects(
    validateOutputManifest(
      [artifact(root, 'Guides/one.md', '/docs/one/'), artifact(root, 'guides/two.md', '/docs/two/')],
      outputDirectory,
    ),
    /routes \/docs\/one\/ and \/docs\/two\//,
  );
  await assert.rejects(
    validateOutputManifest([artifact(path.dirname(root), 'escape.md', '/docs/escape/')], outputDirectory),
    /Unsafe generated output target .*escape\.md.*\/docs\/escape\//,
  );

  const encodedSeparator = new URL('encoded%2Fseparator.md', outputDirectory);
  await assert.rejects(
    validateOutputManifest(
      [{ url: encodedSeparator, content: 'generated', sourceRoute: '/docs/encoded/' }],
      outputDirectory,
    ),
    /Unsafe generated output target .*encoded%2Fseparator\.md.*\/docs\/encoded\//,
  );
  assert.deepEqual(await readdir(root), []);
});

test('publisher failures name source route and target without partial artifacts', async (t) => {
  const root = await fixture(t);
  const outputDirectory = pathToFileURL(`${root}${path.sep}`);
  const failures = [
    {
      artifact: artifact(root, 'missing/open.md', '/docs/open/'),
      publish: (candidate) => publishGeneratedArtifacts([candidate], undefined, undefined, outputDirectory),
      message: /Failed to open temporary generated output for route \/docs\/open\/ targeting .*open\.md/,
    },
    {
      artifact: artifact(root, 'write.md', '/docs/write/'),
      publish: (candidate) =>
        publishGeneratedArtifacts(
          [candidate],
          undefined,
          async () => {
            throw new Error('injected write failure');
          },
          outputDirectory,
        ),
      message: /Failed to write temporary generated output for route \/docs\/write\/ targeting .*write\.md/,
    },
    {
      artifact: artifact(root, 'link.md', '/docs/link/'),
      publish: (candidate) =>
        publishGeneratedArtifacts(
          [candidate],
          async () => {
            throw Object.assign(new Error('injected link failure'), { code: 'EACCES' });
          },
          undefined,
          outputDirectory,
        ),
      message: /Failed to publish generated output for route \/docs\/link\/ targeting .*link\.md/,
    },
  ];

  for (const failure of failures) {
    await assert.rejects(failure.publish(failure.artifact), failure.message);
  }
  assert.deepEqual(await readdir(root), []);
});

test('existing portable file and directory collisions leave zero generated artifacts', async (t) => {
  const root = await fixture(t);
  const outputDirectory = pathToFileURL(`${root}${path.sep}`);
  await writeFile(path.join(root, 'É.MD'), 'existing file\n');
  await mkdir(path.join(root, 'LLMS.TXT'));
  await mkdir(path.join(root, 'Docs'));
  await writeFile(path.join(root, 'parent'), 'existing parent file\n');
  let writes = 0;

  for (const candidate of [
    artifact(root, 'é.md', '/docs/unicode/'),
    artifact(root, 'llms.txt', '/docs/'),
    artifact(root, 'parent/child.md', '/docs/child/'),
    artifact(root, 'docs/child.md', '/docs/directory-case/'),
  ]) {
    await assert.rejects(
      publishGeneratedArtifacts(
        [candidate],
        undefined,
        async () => {
          writes++;
        },
        outputDirectory,
      ),
      new RegExp(`route ${candidate.sourceRoute.replaceAll('/', '\\/')} targeting`),
    );
  }

  assert.equal(writes, 0);
  assert.deepEqual((await readdir(root)).sort(), ['Docs', 'LLMS.TXT', 'parent', 'É.MD'].sort());
});
