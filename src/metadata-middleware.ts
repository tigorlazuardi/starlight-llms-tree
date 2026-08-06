import type { MiddlewareHandler } from 'astro';
import { routePath } from './route.js';

const metadataKey = Symbol.for('starlight-llms-tree.frontmatter');
type Owner = object;
interface MetadataRecord {
  frontmatter: Record<string, unknown>;
  locale?: string;
  navigation: string[];
}
interface MetadataState {
  owner: Owner;
  records: Map<string, MetadataRecord>;
}

const navigationHrefs = (entries: unknown): string[] =>
  Array.isArray(entries)
    ? entries.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const sidebarEntry = entry as { entries?: unknown; href?: unknown; type?: unknown };
        if (sidebarEntry.type === 'link' && typeof sidebarEntry.href === 'string') {
          return [sidebarEntry.href];
        }
        return navigationHrefs(sidebarEntry.entries);
      })
    : [];

const state = () =>
  (globalThis as typeof globalThis & { [metadataKey]?: MetadataState })[metadataKey];

export const acquireMetadataOwner = (): Owner => {
  const globalState = globalThis as typeof globalThis & { [metadataKey]?: MetadataState };
  if (globalState[metadataKey]) {
    throw new Error('starlight-llms-tree does not support concurrent builds in one process');
  }
  const owner = {};
  globalState[metadataKey] = { owner, records: new Map() };
  return owner;
};

export const readMetadata = (owner: Owner) => {
  const current = state();
  if (!current || current.owner !== owner) {
    throw new Error('starlight-llms-tree metadata owner does not match active build');
  }
  return current.records;
};

export const releaseMetadataOwner = (owner: Owner) => {
  const globalState = globalThis as typeof globalThis & { [metadataKey]?: MetadataState };
  const current = globalState[metadataKey];
  if (!current || current.owner !== owner) {
    throw new Error('starlight-llms-tree cannot release metadata owned by another build');
  }
  current.records.clear();
  delete globalState[metadataKey];
};

export const onRequest: MiddlewareHandler = (context, next) => {
  const route = (
    context.locals as {
      starlightRoute?: {
        entry?: { collection?: unknown; data?: Record<string, unknown> };
        isFallback?: boolean;
        locale?: string;
        sidebar?: unknown;
      };
    }
  ).starlightRoute;
  const current = state();
  if (
    route?.entry?.collection === 'docs' &&
    route.entry.data &&
    !route.isFallback &&
    current
  ) {
    current.records.set(routePath(decodeURI(context.url.pathname).normalize('NFC')), {
      frontmatter: route.entry.data,
      locale: route.locale,
      navigation: navigationHrefs(route.sidebar),
    });
  }
  return next();
};
