import { link, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

interface Artifact {
  url: URL;
  content: string;
}

/** @internal */
export const publishGeneratedArtifacts = async (
  artifacts: Artifact[],
  linkFile: typeof link = link,
) => {
  const staged: Array<{ target: URL; temporary: URL }> = [];
  const published: URL[] = [];

  try {
    for (const { url: target, content } of artifacts) {
      const temporary = new URL(target);
      temporary.pathname += `.starlight-llms-tree-${randomUUID()}.tmp`;
      await writeFile(temporary, content, { flag: 'wx' });
      staged.push({ target, temporary });
    }

    for (const { target, temporary } of staged) {
      try {
        await linkFile(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(`Refusing to overwrite generated output target ${target.pathname}`, {
            cause: error,
          });
        }
        throw error;
      }
      published.push(target);
    }

    await Promise.all(staged.map(({ temporary }) => unlink(temporary)));
  } catch (error) {
    const cleanup = await Promise.allSettled([
      ...published.map((target) => unlink(target)),
      ...staged.map(({ temporary }) => unlink(temporary)),
    ]);
    const cleanupErrors = cleanup.flatMap((result) =>
      result.status === 'rejected' && (result.reason as NodeJS.ErrnoException).code !== 'ENOENT'
        ? [result.reason]
        : [],
    );
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], 'Failed to publish and roll back generated outputs');
    }
    throw error;
  }
};
