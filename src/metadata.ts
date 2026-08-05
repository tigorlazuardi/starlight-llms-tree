const metadataKey = Symbol.for('starlight-llms-tree.page-tags');
const globals = globalThis as typeof globalThis & { [key: symbol]: Map<string, string[]> };

// ponytail: Build-local global bridges route middleware to build hook; replace when Astro exposes page metadata in build:done.
export const pageTags = (globals[metadataKey] ??= new Map());
