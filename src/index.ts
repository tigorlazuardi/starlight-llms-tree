import { readFile } from 'node:fs/promises';
import type { AstroIntegration } from 'astro';
import {
  acquireMetadataOwner,
  readMetadata,
  releaseMetadataOwner,
} from './metadata-middleware.js';
import { normalizeStarlightPage } from './normalize.js';
import { publishGeneratedArtifacts } from './publish.js';
import { routePath } from './route.js';

/** Options for the Starlight LLMs Tree plugin. */
export interface StarlightLlmsTreeOptions {}

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
        const rootPathname = publicPath('/', base);
        const root = docsPages.find(({ finalPathname }) => finalPathname === rootPathname);
        if (!root) {
          throw new Error(
            `starlight-llms-tree requires a root Starlight page at route ${rootPathname} targeting ${markdownPublicPath(rootPathname)}`,
          );
        }

        const generatedDocs = new Map<string, string>();
        const outputTargets = new Set<string>();
        for (const page of docsPages) {
          if (generatedDocs.has(page.finalPathname)) {
            throw new Error(
              `Duplicate generated page route ${page.finalPathname} targeting ${page.outputUrl.pathname}`,
            );
          }
          if (outputTargets.has(page.outputUrl.href)) {
            throw new Error(
              `Duplicate generated output target ${page.outputUrl.pathname} for route ${page.finalPathname}`,
            );
          }
          generatedDocs.set(page.finalPathname, page.outputPathname);
          outputTargets.add(page.outputUrl.href);
        }
        const llmsUrl = new URL('llms.txt', dir);
        if (outputTargets.has(llmsUrl.href)) {
          throw new Error(`Duplicate generated output target ${llmsUrl.pathname}`);
        }

        for (const page of docsPages) {
          if (typeof page.frontmatter.title !== 'string' || !page.frontmatter.title.trim()) {
            throw new Error(
              `Normalized Starlight page ${page.finalPathname} for ${page.outputUrl.pathname} has no title`,
            );
          }
        }
        const pageArtifacts = await Promise.all(
          docsPages.map(async (page) => {
            let html: string;
            try {
              html = await readFile(pageUrl(dir, page.pathname), 'utf8');
            } catch (error) {
              throw new Error(
                `Failed to read rendered page ${page.finalPathname} for ${page.outputUrl.pathname}`,
                { cause: error },
              );
            }
            try {
              return {
                url: page.outputUrl,
                content: normalizeStarlightPage(
                  html,
                  page.frontmatter,
                  generatedDocs,
                  page.finalPathname,
                ),
              };
            } catch (error) {
              throw new Error(
                `Failed to normalize page ${page.finalPathname} for ${page.outputUrl.pathname}`,
                { cause: error },
              );
            }
          }),
        );
        const title = root.frontmatter.title as string;
        const links = docsPages.map(
          (page) => `- [${page.frontmatter.title}](./${page.outputRelative})`,
        );
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
