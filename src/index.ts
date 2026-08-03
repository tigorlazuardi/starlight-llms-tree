import { readFile } from 'node:fs/promises';
import type { AstroIntegration } from 'astro';
import { publishGeneratedArtifacts } from './publish.js';

/** Options for the Starlight LLMs Tree plugin. */
export interface StarlightLlmsTreeOptions {}

const decodeEntities = (value: string) =>
  value.replace(/&(#(?:x[\da-f]+|\d+)|amp|apos|gt|lt|quot);/gi, (_, entity: string) => {
    const named: Record<string, string> = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      quot: '"',
    };
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? `&${entity};`;
    const hex = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : `&${entity};`;
  });

const text = (html: string) =>
  decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const markdownContent = (html: string) => {
  const start = html.search(/<div\b[^>]*class="[^"]*\bsl-markdown-content\b[^"]*"[^>]*>/i);
  if (start === -1) throw new Error('Starlight page has no .sl-markdown-content element');

  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let contentStart = -1;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    if (!match[0].startsWith('</')) {
      depth += 1;
      if (contentStart === -1) contentStart = tags.lastIndex;
    } else if (--depth === 0) {
      return html.slice(contentStart, match.index);
    }
  }
  throw new Error('Starlight page has an unclosed .sl-markdown-content element');
};

const htmlToMarkdown = (html: string) =>
  decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->|<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) =>
        `[${text(label)}](${decodeEntities(href)})`,
      )
      .replace(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, value) =>
        `${'#'.repeat(Number(level))} ${text(value)}\n\n`,
      )
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|ul|ol|blockquote|pre)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const integration = (): AstroIntegration => ({
  name: 'starlight-llms-tree',
  hooks: {
    'astro:build:done': async ({ dir, pages }) => {
      if (!pages.some(({ pathname }) => pathname === '' || pathname === '/')) {
        throw new Error('starlight-llms-tree requires a root Starlight page');
      }

      const html = await readFile(new URL('index.html', dir), 'utf8');
      const titleMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
      if (!titleMatch) throw new Error('Root Starlight page has no h1 title');

      const title = text(titleMatch[1]);
      const manifest = [
        { url: new URL('index.md', dir), content: `# ${title}\n\n${htmlToMarkdown(markdownContent(html))}\n` },
        { url: new URL('llms.txt', dir), content: `# ${title}\n\n- [Overview](./index.md)\n` },
      ];

      await publishGeneratedArtifacts(manifest);
    },
  },
});

/** Creates Starlight plugin that emits LLMs Tree artifacts after static builds. */
export const starlightLlmsTree = (_options: StarlightLlmsTreeOptions = {}) => ({
  name: 'starlight-llms-tree',
  hooks: {
    'config:setup': ({ addIntegration }: { addIntegration(integration: AstroIntegration): void }) =>
      addIntegration(integration()),
  },
});
