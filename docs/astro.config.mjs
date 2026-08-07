// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { starlightLlmsTree } from 'starlight-llms-tree';

export default defineConfig({
  site: 'https://tigorlazuardi.github.io',
  base: '/starlight-llms-tree',
  integrations: [
    starlight({
      title: 'starlight-llms-tree',
      plugins: [starlightLlmsTree()],
      sidebar: [
        { label: 'Get started', items: [{ label: 'Installation and usage', slug: 'usage' }] },
        {
          label: 'Reference',
          items: [
            { label: 'Configuration and troubleshooting', slug: 'usage/configuration' },
            { label: 'Output and traversal', slug: 'usage/output' },
          ],
        },
      ],
    }),
  ],
});
