import { readFile } from 'node:fs/promises';
import type { AstroIntegration } from 'astro';
import { pageTags } from './metadata.js';
import { publishGeneratedArtifacts } from './publish.js';

/** Options for the Starlight LLMs Tree plugin. */
export interface StarlightLlmsTreeOptions {}

interface Page {
  route: string;
  title: string;
  description?: string;
  tags: string[];
  markdown: string;
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

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

const routeFromPathname = (pathname: string) => {
  const route = pathname.replace(/^\/+|\/+$/g, '');
  if (route.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe generated route ${pathname}`);
  }
  return route;
};

const parentRoute = (route: string) => route.slice(0, Math.max(0, route.lastIndexOf('/')));
const humanize = (route: string) => {
  const segment = route.slice(route.lastIndexOf('/') + 1).replace(/[-_]+/g, ' ');
  return segment ? `${segment[0].toUpperCase()}${segment.slice(1)}` : segment;
};
const markdownPath = (route: string) => (route ? `${route}.md` : 'index.md');
const indexPath = (route: string) => (route ? `${route}/llms.txt` : 'llms.txt');
const link = (target: string) => `/${target}`;

const renderMetadata = (label: 'Tags' | 'Scopes', values: string[]) =>
  values.length > 0 ? `\n  - ${label}: ${values.map((value) => `\`${value}\``).join(', ')}` : '';

const renderIndex = (folder: string, pages: Page[], folders: string[]) => {
  const overview = pages.find(({ route }) => route === folder);
  const title = overview?.title ?? humanize(folder);
  const description = overview?.description;
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

  const sections = [`# ${title}`, ...(description ? [`> ${description}`] : [])];
  if (directPages.length > 0) {
    sections.push(
      `## Pages\n\n${directPages
        .map(
          (page) =>
            `- [${page.route === folder ? 'Overview' : page.title}](${link(markdownPath(page.route))})${page.description ? `: ${page.description}` : ''}${renderMetadata('Tags', page.tags)}`,
        )
        .join('\n')}`,
    );
  }
  if (directFolders.length > 0) {
    sections.push(
      `## Folders\n\n${directFolders
        .map(
          ({ route, title: folderTitle, description: folderDescription, scopes }) =>
            `- [${folderTitle}](${link(indexPath(route))})${folderDescription ? `: ${folderDescription}` : ''}${renderMetadata('Scopes', scopes)}`,
        )
        .join('\n')}`,
    );
  }
  return `${sections.join('\n\n')}\n`;
};

const integration = (): AstroIntegration => ({
  name: 'starlight-llms-tree',
  hooks: {
    'astro:config:setup': () => pageTags.clear(),
    'astro:build:done': async ({ dir, pages: builtPages }) => {
      const pages: Page[] = [];
      for (const { pathname } of builtPages) {
        const route = routeFromPathname(pathname);
        if (route === '404') continue;
        const html = await readFile(new URL(route ? `${route}/index.html` : 'index.html', dir), 'utf8');
        const titleMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
        if (!titleMatch) throw new Error(`Starlight page ${pathname} has no h1 title`);
        const descriptionMatch = html.match(
          /<meta\b(?=[^>]*\bname=["']description["'])(?=[^>]*\bcontent=["']([^"']*)["'])[^>]*>/i,
        );
        pages.push({
          route,
          title: text(titleMatch[1]),
          description: descriptionMatch ? decodeEntities(descriptionMatch[1]).trim() || undefined : undefined,
          tags: pageTags.get(route) ?? [],
          markdown: htmlToMarkdown(markdownContent(html)),
        });
      }

      if (!pages.some(({ route }) => route === '')) {
        throw new Error('starlight-llms-tree requires a root Starlight page');
      }

      const folders = [
        ...new Set([
          '',
          ...pages.flatMap(({ route }) => {
            const segments = route.split('/');
            return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
          }),
        ]),
      ].sort(compare);
      const folderSet = new Set(folders);
      for (const page of pages) {
        if (pages.some(({ route }) => route.startsWith(`${page.route}/`))) folderSet.add(page.route);
      }
      const allFolders = [...folderSet].sort(compare);
      const manifest = [
        ...pages.map(({ route, title, markdown }) => ({
          url: new URL(markdownPath(route), dir),
          content: `# ${title}\n\n${markdown}\n`,
        })),
        ...allFolders.map((folder) => ({
          url: new URL(indexPath(folder), dir),
          content: renderIndex(folder, pages, allFolders),
        })),
      ];

      pageTags.clear();
      await publishGeneratedArtifacts(manifest);
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
    }: {
      addIntegration(integration: AstroIntegration): void;
      addRouteMiddleware(config: { entrypoint: string; order: 'post' }): void;
    }) => {
      addRouteMiddleware({
        entrypoint: new URL('./metadata-middleware.js', import.meta.url).pathname,
        order: 'post',
      });
      addIntegration(integration());
    },
  },
});
