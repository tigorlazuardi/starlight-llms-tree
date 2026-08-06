import { posix } from 'node:path';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { routePath } from './route.js';

interface ElementNode {
  type: 'element';
  tag: string;
  attributes: Record<string, string>;
  children: HtmlNode[];
}

interface TextNode {
  type: 'text';
  value: string;
}

type HtmlNode = ElementNode | TextNode;

const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const parseHtml = (html: string): ElementNode => {
  const convert = (node: DefaultTreeAdapterTypes.ChildNode): HtmlNode | undefined => {
    if ('value' in node) return { type: 'text', value: node.value };
    if (!('tagName' in node)) return;
    return {
      type: 'element',
      tag: node.tagName,
      attributes: Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])),
      children: node.childNodes.flatMap((child) => {
        const converted = convert(child);
        return converted ? [converted] : [];
      }),
    };
  };
  return {
    type: 'element',
    tag: 'root',
    attributes: {},
    children: parse(html).childNodes.flatMap((node) => {
      const converted = convert(node);
      return converted ? [converted] : [];
    }),
  };
};

const hasClass = (node: ElementNode, name: string) =>
  node.attributes.class?.split(/\s+/).includes(name) ?? false;

const findElement = (node: ElementNode, predicate: (node: ElementNode) => boolean): ElementNode | undefined => {
  if (predicate(node)) return node;
  for (const child of node.children) {
    if (child.type === 'element') {
      const match = findElement(child, predicate);
      if (match) return match;
    }
  }
};

const plainText = (node: HtmlNode): string =>
  node.type === 'text' ? node.value : node.children.map(plainText).join('');

const cleanText = (node: HtmlNode) => plainText(node).replace(/\s+/g, ' ').trim();

const rewriteDocsLink = (
  href: string,
  pagePathname: string,
  generatedDocs: ReadonlyMap<string, string>,
) => {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(href)) return href;
  let resolved: URL;
  try {
    resolved = new URL(href, `https://generated.invalid${routePath(pagePathname)}`);
  } catch {
    return href;
  }
  const resolvedPath = resolved.pathname
    .replace(/(?:^|\/)index\.html$/i, (value) => value.slice(0, -10))
    .replace(/\.html$/i, '');
  const target = generatedDocs.get(routePath(resolvedPath));
  const source = generatedDocs.get(routePath(pagePathname));
  if (!target || !source) return href;

  const sourcePath = href.match(/^[^?#]*/)?.[0] ?? '';
  const suffix = href.slice(sourcePath.length);
  if (sourcePath.startsWith('/')) return `${target}${suffix}`;
  const relative = posix.relative(posix.dirname(source), target);
  return `${sourcePath.startsWith('./') && !relative.startsWith('.') ? './' : ''}${relative}${suffix}`;
};

const normalizeBlocks = (value: string) =>
  value
    .replace(/\n(?:[ \t]*\n){2,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/^[ \t]+|[ \t]+$/g, '');

const escapeGfmText = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/[\\`*_[\]<>~|]/g, '\\$&')
    .replace(/(^|\n)([ \t]*)([#>+-])(?=\s|$)/g, '$1$2\\$3')
    .replace(/(^|\n)([ \t]*\d+)([.)])(?=\s)/g, '$1$2\\$3');

const escapeHtmlAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const codeDelimiter = (value: string, minimum: number) => {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(Math.max(minimum, longest + 1));
};

const renderRaw = (
  node: ElementNode,
  pagePathname: string,
  generatedDocs: ReadonlyMap<string, string>,
): string => {
  if (
    ['script', 'style', 'svg', 'template'].includes(node.tag) ||
    node.attributes['aria-hidden'] === 'true' ||
    hasClass(node, 'sr-only') ||
    hasClass(node, 'sl-anchor-link') ||
    hasClass(node, 'tablist-wrapper')
  )
    return '';
  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => {
      const rewritten = name === 'href' ? rewriteDocsLink(value, pagePathname, generatedDocs) : value;
      return ` ${name}="${escapeHtmlAttribute(rewritten)}"`;
    })
    .join('');
  const children = node.children
    .map((child) =>
      child.type === 'text'
        ? child.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        : renderRaw(child, pagePathname, generatedDocs),
    )
    .join('');
  return voidElements.has(node.tag)
    ? `<${node.tag}${attributes}>`
    : `<${node.tag}${attributes}>${children}</${node.tag}>`;
};

const renderMarkdown = (
  content: ElementNode,
  pagePathname: string,
  generatedDocs: ReadonlyMap<string, string>,
) => {
  const ids = new Map<string, string>();
  const collectIds = (node: ElementNode) => {
    if (node.attributes.id) ids.set(node.attributes.id, cleanText(node));
    for (const child of node.children) if (child.type === 'element') collectIds(child);
  };
  collectIds(content);

  const renderChildren = (node: ElementNode) => node.children.map(render).join('');
  const renderList = (node: ElementNode, ordered: boolean) => {
    const items = node.children.filter(
      (child): child is ElementNode => child.type === 'element' && child.tag === 'li',
    );
    const reversed = ordered && 'reversed' in node.attributes;
    let index =
      ordered && /^-?\d+$/.test(node.attributes.start ?? '')
        ? Number(node.attributes.start)
        : reversed
          ? items.length
          : 1;
    return `${items
      .map((child) => {
        if (ordered && /^-?\d+$/.test(child.attributes.value ?? '')) index = Number(child.attributes.value);
        const value = normalizeBlocks(
          child.children
            .map((item) =>
              item.type === 'element' && (item.tag === 'ul' || item.tag === 'ol') ? `\n${render(item)}` : render(item),
            )
            .join(''),
        );
        const lines = value.split('\n');
        const marker = ordered ? `${index}. ` : '- ';
        index += reversed ? -1 : 1;
        return `${marker}${lines.join(`\n${' '.repeat(marker.length)}`)}`;
      })
      .join('\n')}\n\n`;
  };
  const render = (node: HtmlNode): string => {
    if (node.type === 'text') return escapeGfmText(node.value);
    if (
      ['script', 'style', 'svg', 'template'].includes(node.tag) ||
      node.attributes['aria-hidden'] === 'true' ||
      hasClass(node, 'sr-only') ||
      hasClass(node, 'sl-anchor-link')
    )
      return '';
    if (hasClass(node, 'tablist-wrapper')) return '';
    if (node.attributes.role === 'tabpanel') {
      const label = ids.get(node.attributes['aria-labelledby']) ?? 'Tab';
      return `### ${escapeGfmText(label)}\n\n${renderChildren(node)}\n\n`;
    }
    if (/^h[1-6]$/.test(node.tag))
      return `${'#'.repeat(Number(node.tag[1]))} ${normalizeBlocks(renderChildren(node))}\n\n`;
    if (node.tag === 'p') return `${renderChildren(node)}\n\n`;
    if (node.tag === 'br') return '  \n';
    if (node.tag === 'hr') return '\n---\n\n';
    if (node.tag === 'a') {
      if (node.attributes['aria-label']?.startsWith('Section titled')) return '';
      return `[${normalizeBlocks(renderChildren(node))}](${rewriteDocsLink(
        node.attributes.href ?? '',
        pagePathname,
        generatedDocs,
      )})`;
    }
    if (node.tag === 'img') return `![${escapeGfmText(node.attributes.alt ?? '')}](${node.attributes.src ?? ''})`;
    if (node.tag === 'strong' || node.tag === 'b') return `**${renderChildren(node)}**`;
    if (node.tag === 'em' || node.tag === 'i') return `_${renderChildren(node)}_`;
    if (node.tag === 'del' || node.tag === 's') return `~~${renderChildren(node)}~~`;
    if (node.tag === 'code' && node.children.every((child) => child.type === 'text')) {
      const value = plainText(node);
      const fence = codeDelimiter(value, 1);
      const padding = /`/.test(value) || (/^ | $/.test(value) && !/^ +$/.test(value));
      return `${fence}${padding ? ` ${value} ` : value}${fence}`;
    }
    if (node.tag === 'pre') {
      const code = findElement(node, (child) => child.tag === 'code');
      const value = (code ? plainText(code) : plainText(node)).replace(/^\n|\n$/g, '');
      const language = code?.attributes.class?.match(/language-([\w-]+)/)?.[1] ?? node.attributes['data-language'] ?? '';
      const fence = codeDelimiter(value, 3);
      return `${fence}${language}\n${value}\n${fence}\n\n`;
    }
    if (node.tag === 'ul') return renderList(node, false);
    if (node.tag === 'ol') return renderList(node, true);
    if (node.tag === 'blockquote') {
      return `${normalizeBlocks(renderChildren(node))
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n`;
    }
    if (node.tag === 'aside' && hasClass(node, 'starlight-aside')) {
      const type = node.attributes.class.match(/starlight-aside--([\w-]+)/)?.[1]?.toUpperCase() ?? 'NOTE';
      const title = node.children.find(
        (child): child is ElementNode => child.type === 'element' && hasClass(child, 'starlight-aside__title'),
      );
      const body = node.children.find(
        (child): child is ElementNode => child.type === 'element' && hasClass(child, 'starlight-aside__content'),
      );
      const value = normalizeBlocks(body ? renderChildren(body) : renderChildren(node));
      const renderedTitle = title && cleanText(title);
      const titleLine = renderedTitle ? `\n> **${escapeGfmText(renderedTitle)}**` : '';
      return `> [!${type}]${titleLine}\n${value.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    }
    if (node.tag === 'details') {
      const summary = node.children.find(
        (child): child is ElementNode => child.type === 'element' && child.tag === 'summary',
      );
      const body = node.children.filter((child) => child !== summary).map(render).join('');
      const label = summary ? cleanText(summary).replace(/^Directory(?=\S)/, '') : 'Details';
      return `<details>\n<summary>${escapeGfmText(label)}</summary>\n\n${normalizeBlocks(body)}\n\n</details>\n\n`;
    }
    if (node.tag === 'summary') return '';
    if (['kbd', 'mark', 'sub', 'sup', 'abbr'].includes(node.tag))
      return renderRaw(node, pagePathname, generatedDocs);
    if (['table', 'video', 'audio', 'iframe', 'picture', 'source', 'track'].includes(node.tag))
      return `${renderRaw(node, pagePathname, generatedDocs)}\n\n`;
    if (['figure', 'figcaption'].includes(node.tag)) return `${renderChildren(node)}\n\n`;
    return renderChildren(node);
  };

  return normalizeBlocks(renderChildren(content));
};

export const normalizeStarlightPage = (
  html: string,
  frontmatter: Record<string, unknown>,
  generatedDocs: ReadonlyMap<string, string>,
  pagePathname = '/',
) => {
  const root = parseHtml(html);
  const content = findElement(root, (node) => hasClass(node, 'sl-markdown-content'));
  if (!content) throw new Error('Starlight page has no .sl-markdown-content element');
  const title = typeof frontmatter.title === 'string' && frontmatter.title.trim();
  if (!title) throw new Error('Normalized Starlight collection frontmatter has no title');
  return `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n# ${escapeGfmText(title)}\n\n${renderMarkdown(content, pagePathname, generatedDocs)}\n`;
};
