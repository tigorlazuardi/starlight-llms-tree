import { pageTags } from './metadata.js';

export const onRequest = async (
  context: {
    locals: { starlightRoute?: { id?: string; entry?: { data?: { tags?: unknown } } } };
  },
  next: () => Promise<void>,
) => {
  const route = context.locals.starlightRoute;
  const data = route?.entry?.data;
  if (!data || route.id === undefined) return next();

  const tags = data.tags ?? [];
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
    throw new Error('Starlight page tags must be an array of strings');
  }
  pageTags.set(route.id.normalize('NFC').replace(/(?:^|\/)index$/, ''), tags);
  await next();
};
