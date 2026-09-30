/**
 * An absolute http(s) URL Discord can fetch, or null. Instance paths such as
 * `/uploads/avatars/…` resolve against `APP_URL`.
 */
export function embeddableUrl(url: string | null | undefined, appUrl: string): string | null {
  if (!url) return null;
  try {
    const absolute = new URL(url, appUrl);
    return absolute.protocol === 'https:' || absolute.protocol === 'http:'
      ? absolute.toString()
      : null;
  } catch {
    return null;
  }
}

export function instanceUrl(path: string, appUrl: string): string {
  return new URL(path, appUrl).toString();
}
