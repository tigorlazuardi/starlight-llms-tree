import type { MiddlewareHandler } from 'astro';

const metadataKey = Symbol.for('starlight-llms-tree.frontmatter');
type Owner = object;
interface MetadataState {
  owner: Owner;
  records: Map<string, Record<string, unknown>>;
}

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

const routePath = (pathname: string) => {
  const normalized = `/${pathname.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '/' : `${normalized}/`;
};

export const onRequest: MiddlewareHandler = (context, next) => {
  const route = (context.locals as { starlightRoute?: { entry?: { data?: Record<string, unknown> } } })
    .starlightRoute;
  const current = state();
  if (route?.entry?.data && current) {
    current.records.set(routePath(context.url.pathname), route.entry.data);
  }
  return next();
};
