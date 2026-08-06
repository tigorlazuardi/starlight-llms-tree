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

interface IndexPage {
  route: string;
  title: string;
  description?: string;
  tags: string[];
  outputPathname: string;
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const publicPath = (pathname: string, base: string) => {
  const route = routePath(pathname);
  const baseRoute = routePath(base);
  if (baseRoute === '/' || route.startsWith(baseRoute)) return route;
  return routePath(`${baseRoute}${route.slice(1)}`);
};
const routeFromPathname = (pathname: string, base: string) => {
  const finalPathname = publicPath(pathname, base);
  const baseRoute = routePath(base);
  const route =
    baseRoute === '/'
      ? finalPathname.slice(1, -1)
      : finalPathname === baseRoute
        ? ''
        : finalPathname.slice(baseRoute.length, -1);
  if (route.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe generated route ${finalPathname}`);
  }
  return route;
};
const parentRoute = (route: string) => route.slice(0, Math.max(0, route.lastIndexOf('/')));
const humanize = (route: string) => {
  const segment = route.slice(route.lastIndexOf('/') + 1).replace(/[-_]+/g, ' ');
  return segment ? `${segment[0].toUpperCase()}${segment.slice(1)}` : segment;
};
const indexPath = (route: string) => (route ? `${route}/llms.txt` : 'llms.txt');
const artifactPublicUrl = (path: string, base: string, site?: string) => {
  const pathname = `${routePath(base)}${path}`;
  return site ? new URL(pathname, site).href : pathname;
};
const indexPublicPath = (route: string, base: string, site?: string) =>
  artifactPublicUrl(indexPath(route), base, site);
const renderMetadata = (label: 'Tags' | 'Scopes', values: string[]) =>
  values.length > 0 ? `\n  - ${label}: ${values.map((value) => `\`${value}\``).join(', ')}` : '';

const renderIndex = (
  folder: string,
  pages: IndexPage[],
  folders: string[],
  base: string,
  site?: string,
) => {
  const overview = pages.find(({ route }) => route === folder);
  const title = overview?.title ?? humanize(folder);
  const folderSet = new Set(folders);
  const directPages = pages
    .filter(({ route }) =>
      route === folder ? true : !folderSet.has(route) && parentRoute(route) === folder,
    )
    .sort((left, right) =>
      left.route === folder && right.route === folder
        ? 0
        : left.route === folder
          ? -1
          : right.route === folder
            ? 1
            : compare(left.title, right.title),
    );
  const directFolders = folders
    .filter((route) => route !== folder && parentRoute(route) === folder)
    .map((route) => {
      const index = pages.find((page) => page.route === route);
      const scopes = [
        ...new Set(
          pages
            .filter((page) => page.route === route || page.route.startsWith(`${route}/`))
            .flatMap((page) => page.tags.map((tag) => tag.split('/', 1)[0])),
        ),
      ].sort(compare);
      return { route, title: index?.title ?? humanize(route), description: index?.description, scopes };
    })
    .sort((left, right) => compare(left.title, right.title));

  const sections = [`# ${title}`, ...(overview?.description ? [`> ${overview.description}`] : [])];
  if (directPages.length > 0) {
    sections.push(
      `## Pages\n\n${directPages
        .map(
          (page) =>
            `- [${page.route === folder ? 'Overview' : page.title}](${page.outputPathname})${page.description ? `: ${page.description}` : ''}${renderMetadata('Tags', page.tags)}`,
        )
        .join('\n')}`,
    );
  }
  if (directFolders.length > 0) {
    sections.push(
      `## Folders\n\n${directFolders
        .map(
          ({ route, title: folderTitle, description, scopes }) =>
            `- [${folderTitle}](${indexPublicPath(route, base, site)})${description ? `: ${description}` : ''}${renderMetadata('Scopes', scopes)}`,
        )
        .join('\n')}`,
    );
  }
  return `${sections.join('\n\n')}\n`;
};

const pageUrl = (dir: URL, route: string, format: 'directory' | 'file' | 'preserve') =>
  new URL(
    route === ''
      ? 'index.html'
      : route === '404'
        ? '404.html'
        : `${route}${format === 'directory' ? '/index' : ''}.html`,
    dir,
  );
const markdownUrl = (dir: URL, route: string) =>
  new URL(route === '' ? 'index.md' : `${route}.md`, dir);
const markdownPublicPath = (route: string, base: string, site?: string) =>
  artifactPublicUrl(route === '' ? 'index.md' : `${route}.md`, base, site);
const renderedPathname = (
  route: string,
  base: string,
  format: 'directory' | 'file' | 'preserve',
) => publicPath(format === 'file' ? `/${route || 'index'}.html` : `/${route}`, base);

const integration = (
  base: string,
  site: string | undefined,
  format: 'directory' | 'file' | 'preserve',
  owner: object,
): AstroIntegration => ({
  name: 'starlight-llms-tree',
  hooks: {
    'astro:build:done': async ({ dir, pages }) => {
      try {
        const collectionMetadata = readMetadata(owner);
        const docsPages = pages
          .flatMap(({ pathname }) => {
            const finalPathname = publicPath(pathname, base);
            const route = routeFromPathname(finalPathname, base);
            const frontmatter = collectionMetadata.get(renderedPathname(route, base, format));
            return frontmatter
              ? [
                  {
                    route,
                    finalPathname,
                    frontmatter,
                    outputUrl: markdownUrl(dir, route),
                    outputPathname: markdownPublicPath(route, base, site),
                  },
                ]
              : [];
          })
          .sort((left, right) => compare(left.finalPathname, right.finalPathname));
        const rootPathname = publicPath('/', base);
        const root = docsPages.find(({ route }) => route === '');
        if (!root) {
          throw new Error(
            `starlight-llms-tree requires a root Starlight page at route ${rootPathname} targeting ${markdownPublicPath('', base, site)}`,
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
        for (const page of docsPages) {
          if (typeof page.frontmatter.title !== 'string' || !page.frontmatter.title.trim()) {
            throw new Error(
              `Normalized Starlight page ${page.finalPathname} for ${page.outputUrl.pathname} has no title`,
            );
          }
        }
        const indexPages: IndexPage[] = docsPages
          .filter(({ route }) => route !== '404')
          .map((page) => {
            const tags = page.frontmatter.tags ?? [];
            if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
              throw new Error(
                `Starlight page tags for route ${page.finalPathname} targeting ${page.outputUrl.pathname} must be an array of strings`,
              );
            }
            return {
              route: page.route,
              title: page.frontmatter.title as string,
              description:
                typeof page.frontmatter.description === 'string' && page.frontmatter.description.trim()
                  ? page.frontmatter.description
                  : undefined,
              tags,
              outputPathname: page.outputPathname,
            };
          });
        const folders = [
          ...new Set([
            '',
            ...indexPages.flatMap(({ route }) => {
              const segments = route.split('/');
              return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
            }),
          ]),
        ].sort(compare);
        const folderSet = new Set(folders);
        for (const page of indexPages) {
          if (indexPages.some(({ route }) => route.startsWith(`${page.route}/`))) {
            folderSet.add(page.route);
          }
        }
        const allFolders = [...folderSet].sort(compare);
        const indexArtifacts = allFolders.map((folder) => ({
          url: new URL(indexPath(folder), dir),
          content: renderIndex(folder, indexPages, allFolders, base, site),
        }));
        for (const artifact of indexArtifacts) {
          if (outputTargets.has(artifact.url.href)) {
            throw new Error(`Duplicate generated output target ${artifact.url.pathname}`);
          }
          outputTargets.add(artifact.url.href);
        }

        const pageArtifacts = await Promise.all(
          docsPages.map(async (page) => {
            let html: string;
            try {
              html = await readFile(pageUrl(dir, page.route, format), 'utf8');
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
        await publishGeneratedArtifacts([...pageArtifacts, ...indexArtifacts]);
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
      astroConfig: {
        base: string;
        site?: string;
        build: { format: 'directory' | 'file' | 'preserve' };
      };
    }) => {
      const owner = acquireMetadataOwner();
      try {
        addRouteMiddleware({ entrypoint: new URL('./metadata-middleware.js', import.meta.url).href });
        addIntegration(
          integration(astroConfig.base, astroConfig.site, astroConfig.build.format, owner),
        );
      } catch (error) {
        releaseMetadataOwner(owner);
        throw error;
      }
    },
  },
});
