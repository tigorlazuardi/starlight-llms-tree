import { randomUUID } from 'node:crypto';
import { link, open, readdir, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Artifact {
  url: URL;
  content: string;
  sourceRoute?: string;
}

const portablePath = (value: string) => value.normalize('NFC').toUpperCase().normalize('NFC');
const source = (artifact: Artifact) => artifact.sourceRoute ?? '<unknown route>';

/** @internal */
export const validateOutputManifest = async (artifacts: Artifact[], outputDirectory: URL) => {
  const root = path.resolve(fileURLToPath(outputDirectory));
  const targets = new Map<string, Artifact>();
  const directories = new Map<string, { artifact: Artifact; path: string }>();
  const entries: Array<{ artifact: Artifact; relative: string; key: string }> = [];

  for (const artifact of artifacts) {
    if (artifact.url.protocol !== 'file:') {
      throw new Error(`Unsafe generated output target ${artifact.url.href} for route ${source(artifact)}`);
    }
    if (/%(?:2f|5c|00)/i.test(artifact.url.pathname)) {
      throw new Error(`Unsafe generated output target ${artifact.url.pathname} for route ${source(artifact)}`);
    }
    const target = path.resolve(fileURLToPath(artifact.url));
    const relative = path.relative(root, target);
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Unsafe generated output target ${artifact.url.pathname} for route ${source(artifact)}`);
    }
    const pathSegments = relative.split(path.sep);
    const key = pathSegments.map(portablePath).join('/');
    for (let index = 1; index < pathSegments.length; index++) {
      const directoryPath = pathSegments.slice(0, index).join('/');
      const directoryKey = pathSegments.slice(0, index).map(portablePath).join('/');
      const previousDirectory = directories.get(directoryKey);
      if (previousDirectory && previousDirectory.path !== directoryPath) {
        throw new Error(
          `Generated output collision between routes ${source(previousDirectory.artifact)} and ${source(artifact)} targeting ${artifact.url.pathname}`,
        );
      }
      directories.set(directoryKey, { artifact, path: directoryPath });
    }
    const previous = targets.get(key);
    if (previous) {
      throw new Error(
        `Generated output collision between routes ${source(previous)} and ${source(artifact)} targeting ${artifact.url.pathname}`,
      );
    }
    targets.set(key, artifact);
    entries.push({ artifact, relative, key });
  }

  for (const child of entries) {
    const segments = child.key.split('/');
    for (let index = 1; index < segments.length; index++) {
      const parent = targets.get(segments.slice(0, index).join('/'));
      if (parent) {
        throw new Error(
          `Generated output collision between routes ${source(parent)} and ${source(child.artifact)} targeting ${child.artifact.url.pathname}`,
        );
      }
    }
  }

  for (const { artifact, relative } of entries) {
    const segments = relative.split(path.sep);
    let directory = root;
    for (let index = 0; index < segments.length; index++) {
      let names;
      try {
        names = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw new Error(
          `Failed to validate generated output target ${artifact.url.pathname} for route ${source(artifact)}`,
          { cause: error },
        );
      }
      const segment = segments[index];
      const matches = names.filter(({ name }) => portablePath(name) === portablePath(segment));
      if (matches.length > 1) {
        throw new Error(
          `Ambiguous existing output collision for route ${source(artifact)} targeting ${artifact.url.pathname}`,
        );
      }
      const match = matches[0];
      if (!match) break;
      if (index < segments.length - 1 && match.name !== segment) {
        throw new Error(
          `Refusing existing directory collision for route ${source(artifact)} targeting ${artifact.url.pathname}`,
        );
      }
      if (index === segments.length - 1 || !match.isDirectory()) {
        throw new Error(
          `Refusing to overwrite generated output target ${artifact.url.pathname}: existing output collision for route ${source(artifact)} targeting ${artifact.url.pathname}`,
        );
      }
      directory = path.join(directory, match.name);
    }
  }
};

/** @internal */
export const publishGeneratedArtifacts = async (
  artifacts: Artifact[],
  linkFile: typeof link = link,
  writeTemporary: (file: FileHandle, content: string) => Promise<void> = (file, content) =>
    file.writeFile(content),
  outputDirectory?: URL,
) => {
  if (artifacts.length === 0) return;
  await validateOutputManifest(artifacts, outputDirectory ?? new URL('.', artifacts[0].url));

  const staged: Array<{ target: URL; temporary: URL }> = [];
  const published: URL[] = [];

  try {
    for (const { url: target, content } of artifacts) {
      const temporary = new URL(target);
      temporary.pathname += `.starlight-llms-tree-${randomUUID()}.tmp`;
      const file = await open(temporary, 'wx');
      staged.push({ target, temporary });
      try {
        await writeTemporary(file, content);
      } finally {
        await file.close();
      }
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
