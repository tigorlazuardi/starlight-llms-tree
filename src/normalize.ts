import { posix } from 'node:path';

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

const decodeEntities = (value: string) =>
  value.replace(/&(#(?:x[\da-f]+|\d+)|amp|apos|gt|lt|quot|nbsp);/gi, (_, entity: string) => {
    const named: Record<string, string> = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: ' ',
      quot: '"',
    };
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? `&${entity};`;
    const hex = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : `&${entity};`;
  });

const parseAttributes = (source: string) => {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
};

// ponytail: rendered Astro HTML needs quote-aware tags and valid raw text, not HTML5 error recovery; use a parser if malformed input becomes supported.
const tokenizeHtml = (html: string) => {
  const tokens: string[] = [];
  let start = 0;
  while (start < html.length) {
    const opening = html.indexOf('<', start);
    if (opening < 0) {
      tokens.push(html.slice(start));
      break;
    }
    if (opening > start) tokens.push(html.slice(start, opening));
    if (html.startsWith('<!--', opening)) {
      const end = html.indexOf('-->', opening + 4);
      tokens.push(html.slice(opening, end < 0 ? html.length : end + 3));
      start = end < 0 ? html.length : end + 3;
      continue;
    }
    let quote = '';
    let end = opening + 1;
    for (; end < html.length; end += 1) {
      const character = html[end];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === html.length) {
      tokens.push(html.slice(opening));
      break;
    }
    const tagToken = html.slice(opening, end + 1);
    tokens.push(tagToken);
    start = end + 1;

    const rawTextTag = tagToken.match(/^<(script|style)(?:\s|>)/i)?.[1];
    if (rawTextTag) {
      const closingTag = new RegExp(`</${rawTextTag}\\s*>`, 'gi');
      closingTag.lastIndex = start;
      const match = closingTag.exec(html);
      if (!match) {
        tokens.push(html.slice(start));
        break;
      }
      tokens.push(html.slice(start, match.index), match[0]);
      start = closingTag.lastIndex;
    }
  }
  return tokens;
};

const parseHtml = (html: string): ElementNode => {
  const root: ElementNode = { type: 'element', tag: 'root', attributes: {}, children: [] };
  const stack = [root];
  for (const token of tokenizeHtml(html)) {
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    if (!token.startsWith('<') || !/^<\/?[a-zA-Z]/.test(token)) {
      stack.at(-1)?.children.push({ type: 'text', value: token });
      continue;
    }
    if (token.startsWith('</')) {
      const tag = token.slice(2).match(/^\s*([^\s>]+)/)?.[1]?.toLowerCase();
      let index = stack.length - 1;
      while (index > 0 && stack[index]?.tag !== tag) index -= 1;
      if (index > 0) stack.length = index;
      continue;
    }
    const tag = token.slice(1).match(/^\s*([^\s/>]+)/)?.[1]?.toLowerCase();
    if (!tag) continue;
    const node: ElementNode = {
      type: 'element',
      tag,
      attributes: parseAttributes(token.slice(token.indexOf(tag) + tag.length, -1)),
      children: [],
    };
    stack.at(-1)?.children.push(node);
    if (!voidElements.has(tag) && !/\/\s*>$/.test(token)) stack.push(node);
  }
  return root;
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
  node.type === 'text' ? decodeEntities(node.value) : node.children.map(plainText).join('');

const cleanText = (node: HtmlNode) => plainText(node).replace(/\s+/g, ' ').trim();

const routePath = (pathname: string) => {
  const normalized = `/${pathname.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '/' : `${normalized}/`;
};

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
  decodeEntities(value)
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
  const renderRaw = (node: ElementNode): string => {
    if (['script', 'style', 'svg', 'template'].includes(node.tag)) return '';
    const attributes = Object.entries(node.attributes)
      .map(([name, value]) => ` ${name}="${escapeHtmlAttribute(value)}"`)
      .join('');
    const children = node.children
      .map((child) =>
        child.type === 'text'
          ? decodeEntities(child.value)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
          : renderRaw(child),
      )
      .join('');
    return voidElements.has(node.tag)
      ? `<${node.tag}${attributes}>`
      : `<${node.tag}${attributes}>${children}</${node.tag}>`;
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
      return `${'#'.repeat(Number(node.tag[1]))} ${escapeGfmText(cleanText(node))}\n\n`;
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
    if (['kbd', 'mark', 'sub', 'sup', 'abbr'].includes(node.tag)) return renderRaw(node);
    if (node.tag === 'table') return `${renderRaw(node)}\n\n`;
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
