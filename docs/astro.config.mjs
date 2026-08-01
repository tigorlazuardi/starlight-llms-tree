// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';

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
      // ponytail: llms integration waits for this repo's local plugin export.
      sidebar: [
        { label: 'Design decisions', items: [{ autogenerate: { directory: 'design' } }] },
        { label: 'Reports', collapsed: true, items: [{ autogenerate: { directory: 'reports' } }] },
      ],
    }),
  ],
});
