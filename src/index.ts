import { readFile } from 'node:fs/promises';
import type { AstroIntegration } from 'astro';
import { normalizeStarlightPage } from './normalize.js';
import { publishGeneratedArtifacts } from './publish.js';

/** Options for the Starlight LLMs Tree plugin. */
export interface StarlightLlmsTreeOptions {}

const integration = (): AstroIntegration => ({
  name: 'starlight-llms-tree',
  hooks: {
    'astro:build:done': async ({ dir, pages }) => {
      if (!pages.some(({ pathname }) => pathname === '' || pathname === '/')) {
        throw new Error('starlight-llms-tree requires a root Starlight page');
      }

      const html = await readFile(new URL('index.html', dir), 'utf8');
      const markdown = normalizeStarlightPage(html);
      const titleMatch = markdown.match(/^# (.+)$/m);
      if (!titleMatch) throw new Error('Normalized root Starlight page has no title');
      const manifest = [
        { url: new URL('index.md', dir), content: markdown },
        { url: new URL('llms.txt', dir), content: `# ${titleMatch[1]}\n\n- [Overview](./index.md)\n` },
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
