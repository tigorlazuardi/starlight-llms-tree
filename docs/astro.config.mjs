// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';
import { starlightLlmsTree } from 'starlight-llms-tree';

export default defineConfig({
  site: 'https://tigorlazuardi.github.io',
  base: '/starlight-llms-tree',
  integrations: [
    mermaid({ theme: 'neutral', autoTheme: true }),
    starlight({
      title: 'starlight-llms-tree design docs',
      customCss: ['./src/styles/print.css'],
      expressiveCode: {
        plugins: [pluginLineNumbers()],
        defaultProps: { showLineNumbers: false },
      },
      components: {
        PageTitle: './src/components/PageTitle.astro',
      },
      plugins: [starlightLlmsTree()],
      sidebar: [
        { label: 'Usage', items: [{ autogenerate: { directory: 'usage' } }] },
        { label: 'Design decisions', items: [{ autogenerate: { directory: 'design' } }] },
        { label: 'Reports', collapsed: true, items: [{ autogenerate: { directory: 'reports' } }] },
      ],
    }),
  ],
});
