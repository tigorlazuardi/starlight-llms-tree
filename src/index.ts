import { readFile } from 'node:fs/promises';
import type { AstroIntegration } from 'astro';
import {
  acquireMetadataOwner,
  readMetadata,
  releaseMetadataOwner,
} from './metadata-middleware.js';
import { normalizeStarlightPage } from './normalize.js';
import { publishGeneratedArtifacts, validateOutputManifest } from './publish.js';
import { assertSafeRoute, routePath } from './route.js';

/** Options controlling normalization fallback and diagnostics. */
export interface StarlightLlmsTreeOptions {
  /** Treat recoverable normalization failures as fatal. Defaults to `false`. Cannot be combined with `rawContent`. */
  strict?: boolean;
  /** Emit authored page bodies without normalization. Defaults to `false`. Cannot be combined with `strict`. */
  rawContent?: boolean;
  /** Emit content-free diagnostic logs. Defaults to `false`; also enabled by `STARLIGHT_LLMS_TREE_DEBUG=1`. */
  debug?: boolean;
}

interface IndexPage {
  route: string;
  pathname: string;
  locale?: string;
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
  assertSafeRoute(pathname);
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
  site: string | undefined,
  navigationOrder: Map<string, number>,
) => {
  const overview = pages.find(({ route }) => route === folder);
  const title = overview?.title ?? humanize(folder);
  const folderSet = new Set(folders);
  const directPages = pages
    .filter(({ route }) =>
      route === folder ? true : !folderSet.has(route) && parentRoute(route) === folder,
    )
    .sort((left, right) => {
      if (left.route === folder) return right.route === folder ? 0 : -1;
      if (right.route === folder) return 1;
      const leftOrder = navigationOrder.get(left.pathname) ?? Number.MAX_VALUE;
      const rightOrder = navigationOrder.get(right.pathname) ?? Number.MAX_VALUE;
      return leftOrder === rightOrder ? compare(left.pathname, right.pathname) : leftOrder - rightOrder;
    });
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
    .sort((left, right) => {
      const order = (route: string) =>
        pages
          .filter((page) => page.route === route || page.route.startsWith(`${route}/`))
          .reduce(
            (first, page) => Math.min(first, navigationOrder.get(page.pathname) ?? Number.MAX_VALUE),
            Number.MAX_VALUE,
          );
      const leftOrder = order(left.route);
      const rightOrder = order(right.route);
      return leftOrder === rightOrder ? compare(left.route, right.route) : leftOrder - rightOrder;
    });

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

interface DiagnosticLogger {
  info(message: string): void;
  warn(message: string): void;
}

type RecoverableStage = 'asset' | 'component' | 'link' | 'metadata' | 'page';

const integration = (
  base: string,
  site: string | undefined,
  format: 'directory' | 'file' | 'preserve',
  owner: object,
  options: StarlightLlmsTreeOptions,
): AstroIntegration => ({
  name: 'starlight-llms-tree',
  hooks: {
    'astro:build:done': async ({ dir, logger, pages }) => {
      try {
        const diagnostics = logger as DiagnosticLogger;
        const debug = options.debug === true || process.env.STARLIGHT_LLMS_TREE_DEBUG === '1';
        const debugLog = (message: string) => {
          if (debug) diagnostics.info(`[starlight-llms-tree] ${message}`);
        };
        const recover = (stage: RecoverableStage, route: string, target: string, fallback: string) => {
          const message = `Recoverable ${stage} normalization failure for route ${route} targeting ${target}`;
          if (options.strict) throw new Error(message);
          diagnostics.warn(`[starlight-llms-tree] ${message}; using ${fallback}`);
          debugLog(`fallback stage=${stage} route=${route} target=${target} mode=${fallback}`);
        };
        const collectionMetadata = readMetadata(owner);
        const docsPages = pages
          .flatMap(({ pathname }) => {
            const finalPathname = publicPath(pathname, base);
            const route = routeFromPathname(finalPathname, base);
            const metadata = collectionMetadata.get(renderedPathname(route, base, format));
            return metadata
              ? [
                  {
                    route,
                    finalPathname,
                    frontmatter: metadata.frontmatter,
                    body: metadata.body,
                    locale: metadata.locale,
                    navigation: metadata.navigation,
                    outputUrl: markdownUrl(dir, route),
                    outputPathname: markdownPublicPath(route, base, site),
                  },
                ]
              : [];
          })
          .filter(({ route }) => route !== '404')
          .sort((left, right) => compare(left.finalPathname, right.finalPathname));
        for (const page of docsPages) {
          debugLog(`route pathname=${page.finalPathname} target=${page.outputUrl.pathname}`);
        }
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
            if (!page.route) {
              throw new Error(
                `Normalized Starlight page ${page.finalPathname} for ${page.outputUrl.pathname} has no title`,
              );
            }
            recover('metadata', page.finalPathname, page.outputUrl.pathname, 'route-derived title');
            page.frontmatter = { ...page.frontmatter, title: humanize(page.route) };
          }
        }
        const indexPages: IndexPage[] = docsPages.map((page) => {
          let tags = page.frontmatter.tags ?? [];
          if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
            recover('metadata', page.finalPathname, page.outputUrl.pathname, 'empty tags');
            tags = [];
          }
          return {
            route: page.route,
            pathname: page.finalPathname,
            locale: page.locale,
            title: page.frontmatter.title as string,
            description:
              typeof page.frontmatter.description === 'string' && page.frontmatter.description.trim()
                ? page.frontmatter.description
                : undefined,
            tags: tags as string[],
            outputPathname: page.outputPathname,
          };
        });
        const navigationOrder = new Map<string, number>();
        for (const page of docsPages) {
          for (const href of page.navigation) {
            if (typeof href !== 'string' || !href.startsWith('/')) continue;
            let pathname: string;
            try {
              pathname = routePath(decodeURI(new URL(href, 'https://starlight.invalid').pathname));
            } catch {
              recover('metadata', page.finalPathname, page.outputUrl.pathname, 'remaining navigation');
              continue;
            }
            if (generatedDocs.has(pathname) && !navigationOrder.has(pathname)) {
              navigationOrder.set(pathname, navigationOrder.size);
            }
          }
        }
        debugLog(
          `ordering routes=${docsPages.map((page) => page.finalPathname).join(',')} navigation=${[
            ...navigationOrder.keys(),
          ].join(',')}`,
        );
        const pagesByLocale = new Map<string | undefined, IndexPage[]>();
        for (const page of indexPages) {
          pagesByLocale.set(page.locale, [...(pagesByLocale.get(page.locale) ?? []), page]);
        }
        const indexArtifacts = [...pagesByLocale.entries()].flatMap(([locale, localePages]) => {
          const folders = [
            ...new Set([
              locale ?? '',
              ...localePages.flatMap(({ route }) => {
                const segments = route.split('/');
                return segments
                  .slice(0, -1)
                  .map((_, index) => segments.slice(0, index + 1).join('/'));
              }),
            ]),
          ].sort(compare);
          const folderSet = new Set(folders);
          for (const page of localePages) {
            if (localePages.some(({ route }) => route.startsWith(`${page.route}/`))) {
              folderSet.add(page.route);
            }
          }
          const allFolders = [...folderSet].sort(compare);
          return allFolders.map((folder) => ({
            url: new URL(indexPath(folder), dir),
            content: renderIndex(folder, localePages, allFolders, base, site, navigationOrder),
            sourceRoute: publicPath(`/${folder}`, base),
          }));
        });
        await validateOutputManifest(
          [
            ...docsPages.map((page) => ({
              url: page.outputUrl,
              content: '',
              sourceRoute: page.finalPathname,
            })),
            ...indexArtifacts,
          ],
          dir,
        );

        debugLog(
          `manifest pages=${docsPages.length} indexes=${indexArtifacts.length} targets=${docsPages.length + indexArtifacts.length}`,
        );
        const pageArtifacts = await Promise.all(
          docsPages.map(async (page) => {
            const rawBody = () => {
              if (typeof page.body !== 'string' || !page.body.trim()) {
                throw new Error(
                  `Authored raw body unavailable for route ${page.finalPathname} targeting ${page.outputUrl.pathname}`,
                );
              }
              return page.body;
            };
            if (options.rawContent) {
              debugLog(`normalization stage=bypass route=${page.finalPathname} mode=raw-content`);
              return { url: page.outputUrl, sourceRoute: page.finalPathname, content: rawBody() };
            }
            let html: string;
            try {
              html = await readFile(pageUrl(dir, page.route, format), 'utf8');
            } catch (error) {
              throw new Error(
                `Failed to read rendered page ${page.finalPathname} for ${page.outputUrl.pathname}`,
                { cause: error },
              );
            }
            debugLog(`normalization stage=start route=${page.finalPathname}`);
            try {
              const content = normalizeStarlightPage(
                html,
                page.frontmatter,
                generatedDocs,
                page.finalPathname,
                (stage) => recover(stage, page.finalPathname, page.outputUrl.pathname, 'preserved value'),
              );
              debugLog(`normalization stage=complete route=${page.finalPathname}`);
              return { url: page.outputUrl, sourceRoute: page.finalPathname, content };
            } catch (error) {
              if (options.strict) {
                throw new Error(
                  `Failed to normalize page ${page.finalPathname} for ${page.outputUrl.pathname}`,
                  { cause: error },
                );
              }
              recover('page', page.finalPathname, page.outputUrl.pathname, 'authored raw body');
              return { url: page.outputUrl, sourceRoute: page.finalPathname, content: rawBody() };
            }
          }),
        );
        debugLog(`manifest publish targets=${pageArtifacts.length + indexArtifacts.length}`);
        await publishGeneratedArtifacts(
          [...pageArtifacts, ...indexArtifacts],
          undefined,
          undefined,
          dir,
        );
      } finally {
        releaseMetadataOwner(owner);
      }
    },
  },
});

/**
 * Creates Starlight plugin that emits LLMs Tree artifacts after static builds.
 * `strict`, `rawContent`, and `debug` default to `false`; debug is also enabled by
 * `STARLIGHT_LLMS_TREE_DEBUG=1`. `strict` and `rawContent` cannot both be enabled.
 */
export const starlightLlmsTree = (options: StarlightLlmsTreeOptions = {}) => {
  for (const key of ['strict', 'rawContent', 'debug'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new TypeError(`starlight-llms-tree option ${key} must be a boolean`);
    }
  }
  if (options.strict && options.rawContent) {
    throw new Error('starlight-llms-tree options strict and rawContent cannot both be true');
  }

  return {
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
            integration(astroConfig.base, astroConfig.site, astroConfig.build.format, owner, options),
          );
        } catch (error) {
          releaseMetadataOwner(owner);
          throw error;
        }
      },
    },
  };
};
