/**
 * Native stand-in for the web photo store.
 *
 * On iOS and Android `persistImage` copies the file into the document
 * directory and the resulting `file://` URI renders directly, so there is
 * nothing to store or resolve. Metro picks `imageStore.web.ts` for web
 * builds and this file everywhere else, which keeps the IndexedDB code out
 * of the native bundle entirely rather than guarding it with a Platform
 * check at every call site.
 */

export const IDB_SCHEME = 'idb://';

/** Never true on native: nothing writes this scheme here. */
export const isStoredImage = (_uri: string | null | undefined): boolean => false;

export const idFromUri = (uri: string): string => uri;

export async function storeImage(_uri: string, _id: string): Promise<string | null> {
  return null;
}

export async function resolveImage(_uri: string): Promise<string | null> {
  return null;
}

export async function removeImage(_uri: string): Promise<void> {
  return undefined;
}

export async function clearImages(): Promise<void> {
  return undefined;
}
