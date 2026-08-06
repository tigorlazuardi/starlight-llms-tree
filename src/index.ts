import { readFile } from 'node:fs/promises';
import type { AstroIntegration } from 'astro';
import {
  acquireMetadataOwner,
  readMetadata,
  releaseMetadataOwner,
} from './metadata-middleware.js';
import { normalizeStarlightPage } from './normalize.js';
import { publishGeneratedArtifacts } from './publish.js';

/** Options for the Starlight LLMs Tree plugin. */
export interface StarlightLlmsTreeOptions {}

const routePath = (pathname: string) => {
  const normalized = `/${pathname.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '/' : `${normalized}/`;
};
const publicPath = (pathname: string, base: string) => {
  const route = routePath(pathname);
  const baseRoute = routePath(base);
  if (baseRoute === '/' || route.startsWith(baseRoute)) return route;
  return routePath(`${baseRoute}${route.slice(1)}`);
};
const pageUrl = (dir: URL, pathname: string) => {
  const route = pathname.replace(/^\/+/, '');
  return new URL(
    route === ''
      ? 'index.html'
      : route.replace(/\/$/, '') === '404'
        ? '404.html'
        : route.endsWith('/')
          ? `${route}index.html`
          : `${route}.html`,
    dir,
  );
};
const markdownUrl = (dir: URL, pathname: string) => {
  const route = routePath(pathname).slice(1, -1);
  return new URL(route === '' ? 'index.md' : `${route}.md`, dir);
};
const markdownPublicPath = (pathname: string) => {
  const route = routePath(pathname);
  return route === '/' ? '/index.md' : `${route.slice(0, -1)}.md`;
};

const integration = (base: string, owner: object): AstroIntegration => ({
  name: 'starlight-llms-tree',
  hooks: {
    'astro:build:done': async ({ dir, pages }) => {
      try {
        const collectionMetadata = readMetadata(owner);
        const docsPages = pages
          .flatMap(({ pathname }) => {
            const finalPathname = publicPath(pathname, base);
            const frontmatter = collectionMetadata.get(finalPathname);
            return frontmatter
              ? [
                  {
                    pathname,
                    finalPathname,
                    frontmatter,
                    outputUrl: markdownUrl(dir, pathname),
                    outputPathname: markdownPublicPath(finalPathname),
                    outputRelative: markdownUrl(new URL('./', dir), pathname).pathname.slice(dir.pathname.length),
                  },
                ]
              : [];
          })
          .sort((left, right) => left.finalPathname.localeCompare(right.finalPathname));
        const root = docsPages.find(({ finalPathname }) => finalPathname === publicPath('/', base));
        if (!root) throw new Error('starlight-llms-tree requires a root Starlight page');

        const generatedDocs = new Map<string, string>();
        const outputTargets = new Set<string>();
        for (const page of docsPages) {
          if (generatedDocs.has(page.finalPathname)) {
            throw new Error(`Duplicate generated page route ${page.finalPathname}`);
          }
          if (outputTargets.has(page.outputUrl.href)) {
            throw new Error(`Duplicate generated output target ${page.outputUrl.pathname}`);
          }
          generatedDocs.set(page.finalPathname, page.outputPathname);
          outputTargets.add(page.outputUrl.href);
        }
        const llmsUrl = new URL('llms.txt', dir);
        if (outputTargets.has(llmsUrl.href)) {
          throw new Error(`Duplicate generated output target ${llmsUrl.pathname}`);
        }

        const pageArtifacts = await Promise.all(
          docsPages.map(async (page) => ({
            url: page.outputUrl,
            content: normalizeStarlightPage(
              await readFile(pageUrl(dir, page.pathname), 'utf8'),
              page.frontmatter,
              generatedDocs,
              page.finalPathname,
            ),
          })),
        );
        const title = root.frontmatter.title;
        if (typeof title !== 'string' || !title.trim()) {
          throw new Error('Normalized root Starlight page has no title');
        }
        const links = docsPages.map((page) => {
          const pageTitle = page.frontmatter.title;
          if (typeof pageTitle !== 'string' || !pageTitle.trim()) {
            throw new Error(`Normalized Starlight page ${page.finalPathname} has no title`);
          }
          return `- [${pageTitle}](./${page.outputRelative})`;
        });
        await publishGeneratedArtifacts([
          ...pageArtifacts,
          { url: llmsUrl, content: `# ${title}\n\n${links.join('\n')}\n` },
        ]);
      } finally {
        releaseMetadataOwner(owner);
      }
    },
  },
});

/** Creates Starlight plugin that emits LLMs Tree artifacts after static builds. */
export const starlightLlmsTree = (_options: StarlightLlmsTreeOptions = {}) => ({
  name: 'starlight-llms-tree',
  hooks: {
    'config:setup': ({
      addIntegration,
      addRouteMiddleware,
      astroConfig,
    }: {
      addIntegration(integration: AstroIntegration): void;
      addRouteMiddleware(config: { entrypoint: string }): void;
      astroConfig: { base: string };
    }) => {
      const owner = acquireMetadataOwner();
      try {
        addRouteMiddleware({ entrypoint: new URL('./metadata-middleware.js', import.meta.url).href });
        addIntegration(integration(astroConfig.base, owner));
      } catch (error) {
        releaseMetadataOwner(owner);
        throw error;
      }
    },
  },
});
