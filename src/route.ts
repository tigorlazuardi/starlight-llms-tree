export const assertSafeRoute = (pathname: string) => {
  if (pathname.includes('\\') || pathname.includes('\0') || /%(?:2f|5c|00)/i.test(pathname)) {
    throw new Error(`Unsafe generated route ${pathname}`);
  }
  let segments: string[];
  try {
    segments = pathname.split('/').map(decodeURIComponent);
  } catch (error) {
    throw new Error(`Unsafe generated route ${pathname}`, { cause: error });
  }
  if (
    segments.some(
      (segment) =>
        segment === '.' ||
        segment === '..' ||
        segment.includes('/') ||
        segment.includes('\\') ||
        segment.includes('\0'),
    )
  ) {
    throw new Error(`Unsafe generated route ${pathname}`);
  }
};

export const routePath = (pathname: string) => {
  const normalized = `/${pathname.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '/' : `${normalized}/`;
};
