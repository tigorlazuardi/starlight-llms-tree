import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquireMetadataOwner,
  onRequest,
  readMetadata,
  releaseMetadataOwner,
} from '../dist/metadata-middleware.js';
import { normalizeStarlightPage } from '../dist/normalize.js';

const page = (content) => `<!doctype html>
<html><body><h1>Rendered title is not metadata</h1>
<main class="sl-markdown-content">${content}</main>
</body></html>`;
const frontmatter = { title: 'Normalization', description: 'Regression page', pagefind: false };
const generatedDocs = new Map([
  ['/docs/', '/docs/index.md'],
  ['/docs/guide/', '/docs/guide.md'],
]);
const normalize = (html) => normalizeStarlightPage(html, frontmatter, generatedDocs, '/docs/');

test('concurrent build ownership fails closed without leaking pathname metadata', async () => {
  const firstOwner = acquireMetadataOwner();
  try {
    await onRequest(
      {
        locals: { starlightRoute: { entry: { data: { title: 'First build' } } } },
        url: new URL('https://example.test/docs/'),
      },
      async () => new Response(),
    );
    await onRequest(
      {
        locals: { starlightRoute: { entry: { data: { title: 'Unicode page', tags: ['unicode'] } } } },
        url: new URL('https://example.test/docs/unicode/e%CC%81/'),
      },
      async () => new Response(),
    );
    await onRequest(
      {
        locals: {
          starlightRoute: { entry: { data: { title: 'Fallback copy' } }, isFallback: true },
        },
        url: new URL('https://example.test/docs/fr/guide/'),
      },
      async () => new Response(),
    );
    assert.throws(acquireMetadataOwner, /does not support concurrent builds/);
    assert.throws(() => readMetadata({}), /owner does not match active build/);
    assert.equal(readMetadata(firstOwner).get('/docs/').title, 'First build');
    assert.deepEqual(readMetadata(firstOwner).get('/docs/unicode/é/').tags, ['unicode']);
    assert.equal(readMetadata(firstOwner).has('/docs/fr/guide/'), false);
  } finally {
    releaseMetadataOwner(firstOwner);
  }

  const secondOwner = acquireMetadataOwner();
  try {
    await onRequest(
      {
        locals: { starlightRoute: { entry: { data: { title: 'Second build' } } } },
        url: new URL('https://example.test/docs/'),
      },
      async () => new Response(),
    );
    assert.equal(readMetadata(secondOwner).get('/docs/').title, 'Second build');
  } finally {
    releaseMetadataOwner(secondOwner);
  }
});

test('normalization treats script and style bodies as raw text before page content', async (t) => {
  for (const [tag, closingTag, rawText] of [
    ['script', 'ScRiPt', `const fake = "<main class='sl-markdown-content'><p>Fake script</p></main>";`],
    ['style', 'StYlE', `.fake::before { content: "<main class='sl-markdown-content'><p>Fake style</p></main>"; }`],
  ]) {
    await t.test(tag, () => {
      const markdown = normalize(`<!doctype html>
<html><head><${tag}>${rawText}</${closingTag}></head><body>
<h1>Normalization</h1><main class="sl-markdown-content"><p>Real content</p></main>
</body></html>`);

      assert.match(markdown, /# Normalization/);
      assert.match(markdown, /Real content/);
      assert.doesNotMatch(markdown, /Fake (?:script|style)/);
    });
  }
});

test('normalization preserves Markdown semantics and rewrites explicit index routes', () => {
  const markdown = normalize(page(`
<p>Literal &lt;Widget&gt;, \\ slash, [brackets], *stars*, and _underscores_.<br>Next line.</p>
<p># literal heading and ~~strike~~ | pipe &copy;</p>
<h2>Rich <a href="/docs/guide/#start">heading</a> with <code>code</code><a class="sl-anchor-link" href="#rich">#</a></h2>
<ul><li>parent<ul><li>child</li></ul></li></ul>
<pre><code class="language-js">if (ready) {
  console.log('indented');
}
\`\`\`\`
</code></pre>
<p><code>a\`b</code> <code> edge </code></p>
<p><abbr title="x > say &quot;hi&quot; &amp; bye">term</abbr></p>
<p><a href="/docs/index.html?q=docs#top">root</a> <a href="/docs/guide/index.html#start">guide</a> <a href="index.html?local=1">relative</a> <a href="./index.html">dot</a> <a href="myindex.html">named</a> <a href="/docs/download">download</a> <a href="/docs/feed/">feed</a> <a href="/docs/report.html?q=1#raw">report</a></p>
<ol start="3"><li>Three</li><li value="7">Seven</li><li>Eight</li></ol>
<ol reversed><li>Three</li><li>Two</li><li>One</li></ol>
<ol reversed start="8"><li>Eight</li><li value="4">Four</li><li>Three</li></ol>
<table class="results"><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td><a href="/docs/guide/#start">Ada</a></td><td>10</td></tr></tbody></table>
<video controls src="/docs/demo.mp4"><source src="/docs/demo.webm" type="video/webm">Fallback</video>
<iframe src="https://example.com/embed" title="Demo"></iframe>
<aside class="starlight-aside starlight-aside--tip"><p class="starlight-aside__title"><svg aria-hidden="true"></svg>Remember</p><div class="starlight-aside__content"><p>Keep body.</p></div></aside>
`));

  assert.ok(markdown.includes('Literal \\<Widget\\>, \\\\ slash, \\[brackets\\], \\*stars\\*, and \\_underscores\\_.'));
  assert.match(markdown, /underscores\\_\.  \nNext line\./);
  assert.ok(markdown.includes('\\# literal heading and \\~\\~strike\\~\\~ \\| pipe ©'));
  assert.match(markdown, /## Rich \[heading\]\(\/docs\/guide\.md#start\) with `code`/);
  assert.match(markdown, /- parent\n  - child/);
  assert.match(markdown, /`````js\nif \(ready\) \{\n  console\.log\('indented'\);\n\}\n````\n`````/);
  assert.match(markdown, /`` a`b `` `  edge  `/);
  assert.match(markdown, /<abbr title="x &gt; say &quot;hi&quot; &amp; bye">term<\/abbr>/);
  assert.match(markdown, /\[root\]\(\/docs\/index\.md\?q=docs#top\)/);
  assert.match(markdown, /\[guide\]\(\/docs\/guide\.md#start\)/);
  assert.match(markdown, /\[relative\]\(index\.md\?local=1\)/);
  assert.match(markdown, /\[dot\]\(\.\/index\.md\)/);
  assert.match(markdown, /\[named\]\(myindex\.html\)/);
  assert.match(markdown, /\[download\]\(\/docs\/download\)/);
  assert.match(markdown, /\[feed\]\(\/docs\/feed\/\)/);
  assert.match(markdown, /\[report\]\(\/docs\/report\.html\?q=1#raw\)/);
  assert.match(markdown, /3\. Three\n7\. Seven\n8\. Eight/);
  assert.match(markdown, /3\. Three\n2\. Two\n1\. One/);
  assert.match(markdown, /8\. Eight\n4\. Four\n3\. Three/);
  assert.match(markdown, /<table class="results"><thead><tr><th>Name<\/th><th>Score<\/th><\/tr><\/thead><tbody><tr><td><a href="\/docs\/guide\.md#start">Ada<\/a><\/td><td>10<\/td><\/tr><\/tbody><\/table>/);
  assert.match(markdown, /<video controls="" src="\/docs\/demo\.mp4"><source src="\/docs\/demo\.webm" type="video\/webm">Fallback<\/video>/);
  assert.match(markdown, /<iframe src="https:\/\/example\.com\/embed" title="Demo"><\/iframe>/);
  assert.match(markdown, /> \[!TIP\]\n> \*\*Remember\*\*\n> Keep body\./);
  assert.match(markdown, /^---\n\{[\s\S]*"pagefind": false[\s\S]*\n---/);
});
