import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStarlightPage } from '../dist/normalize.js';

const page = (content) => `<!doctype html>
<html><head><meta name="description" content="Regression page"></head><body>
<h1>Normalization</h1><main class="sl-markdown-content">${content}</main>
</body></html>`;

test('normalization preserves Markdown semantics and rewrites explicit index routes', () => {
  const markdown = normalizeStarlightPage(page(`
<p>Literal &lt;Widget&gt;, \\ slash, [brackets], *stars*, and _underscores_.<br>Next line.</p>
<p># literal heading and ~~strike~~ | pipe</p>
<ul><li>parent<ul><li>child</li></ul></li></ul>
<pre><code class="language-js">if (ready) {
  console.log('indented');
}
\`\`\`\`
</code></pre>
<p><code>a\`b</code> <code> edge </code></p>
<p><abbr title="x > say &quot;hi&quot; &amp; bye">term</abbr></p>
<p><a href="/index.html?q=docs#top">root</a> <a href="/guide/index.html#start">guide</a> <a href="index.html?local=1">relative</a> <a href="./index.html">dot</a> <a href="myindex.html">named</a></p>
`));

  assert.ok(markdown.includes('Literal \\<Widget\\>, \\\\ slash, \\[brackets\\], \\*stars\\*, and \\_underscores\\_.'));
  assert.match(markdown, /underscores\\_\.  \nNext line\./);
  assert.ok(markdown.includes('\\# literal heading and \\~\\~strike\\~\\~ \\| pipe'));
  assert.match(markdown, /- parent\n  - child/);
  assert.match(markdown, /`````js\nif \(ready\) \{\n  console\.log\('indented'\);\n\}\n````\n`````/);
  assert.match(markdown, /`` a`b `` `  edge  `/);
  assert.match(markdown, /<abbr title="x &gt; say &quot;hi&quot; &amp; bye">term<\/abbr>/);
  assert.match(markdown, /\[root\]\(\/index\.md\?q=docs#top\)/);
  assert.match(markdown, /\[guide\]\(\/guide\.md#start\)/);
  assert.match(markdown, /\[relative\]\(index\.md\?local=1\)/);
  assert.match(markdown, /\[dot\]\(\.\/index\.md\)/);
  assert.match(markdown, /\[named\]\(myindex\.md\)/);
});
