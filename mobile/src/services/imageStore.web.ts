/**
 * Photo storage for the web build.
 *
 * `persistImage` keeps inventory photos with `expo-file-system`, which has no
 * web implementation -- so on web it returned null and every saved item showed
 * a placeholder instead of the food.
 *
 * Photos cannot go in localStorage: it holds ~5 MB for the whole origin, the
 * inventory JSON already lives there, and a quota error while saving a scan
 * would lose the scan, not just its thumbnail. IndexedDB has no such ceiling
 * and stores Blobs directly, with no base64 inflation.
 *
 * Items store `idb://<id>` rather than a `blob:` URL, because an object URL is
 * only valid for the page that created it: stored in the inventory it would be
 * a dead link on the next reload. `FoodImage` turns the reference back into a
 * usable URL at render time.
 */

const DB_NAME = 'fresora-images';
const STORE = 'images';

/** Marks a value as a key into this store rather than a real URL. */
export const IDB_SCHEME = 'idb://';

/** Longest edge kept. The largest on-screen use is a 96px detail thumbnail,
 *  so storing the full capture would spend megabytes to show a fraction. */
const MAX_EDGE = 640;
const QUALITY = 0.78;

export const isStoredImage = (uri: string | null | undefined): boolean =>
  typeof uri === 'string' && uri.startsWith(IDB_SCHEME);

export const idFromUri = (uri: string): string => uri.slice(IDB_SCHEME.length);

function open(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  // Opened with no version: whatever exists. Naming a fixed version here
  // throws VersionError as soon as the database is ahead of it, which the
  // repair below can cause -- so a hardcoded version would break every read
  // after the first repair.
  let db = await open();

  // A database can exist and still have no object store: anything that opens
  // it without an upgrade handler creates it empty, and `onupgradeneeded`
  // never fires again at that version, so every transaction throws
  // NotFoundError forever. Reopening one version higher runs the upgrade path
  // and creates the store, making this self-healing rather than permanently
  // broken.
  if (!db.objectStoreNames.contains(STORE)) {
    const next = db.version + 1;
    db.close();
    db = await open(next);
  }

  return db;
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/**
 * Downscales to a thumbnail before storing.
 *
 * A phone photo is several megabytes; the largest place it is shown is 96px.
 * Canvas is used rather than expo-image-manipulator because this path only
 * runs on web, where canvas is always present.
 */
async function toThumbnailBlob(uri: string): Promise<Blob> {
  const source = await fetch(uri).then((response) => response.blob());
  const bitmap = await createImageBitmap(source);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (!context) return source; // no canvas: better the full image than none
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  return blob ?? source;
}

/** Stores a photo and returns the reference to keep on the item. */
export async function storeImage(uri: string, id: string): Promise<string | null> {
  try {
    const blob = await toThumbnailBlob(uri);
    await transact('readwrite', (store) => store.put(blob, id));
    return `${IDB_SCHEME}${id}`;
  } catch (error) {
    // Still swallowed -- losing a thumbnail must never lose the scan, which is
    // the native path's rule too. But it is logged: a silent catch here turned
    // "photos do not save" into a bug with no trace at all to follow.
    console.warn('[imageStore] could not store photo', error);
    return null;
  }
}

//: Resolved object URLs, keyed by id.
//:
//: The inventory list re-renders constantly, and calling createObjectURL on
//: every render would leak a URL each time. Created once, reused, and revoked
//: only when the underlying image is deleted.
const resolved = new Map<string, string>();

//: Lookups still running, keyed by id.
//:
//: A multi-item scan writes one photo shared by every item it saved, so the
//: list mounts a dozen rows asking for the same id in the same tick. Caching
//: only the result lets all of them miss, each creating its own object URL;
//: eleven then leak, because only the last is in the map to revoke. Caching
//: the promise collapses them into one lookup and one URL.
const inFlight = new Map<string, Promise<string | null>>();

/** Turns `idb://<id>` into a URL an <img> can load, or null if absent. */
export function resolveImage(uri: string): Promise<string | null> {
  const id = idFromUri(uri);

  const cached = resolved.get(id);
  if (cached) return Promise.resolve(cached);

  const running = inFlight.get(id);
  if (running) return running;

  const lookup = transact<Blob | undefined>('readonly', (store) => store.get(id))
    .then((blob) => {
      if (!blob) return null;
      const objectUrl = URL.createObjectURL(blob);
      resolved.set(id, objectUrl);
      return objectUrl;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(id));

  inFlight.set(id, lookup);
  return lookup;
}

export async function removeImage(uri: string): Promise<void> {
  const id = idFromUri(uri);
  const objectUrl = resolved.get(id);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    resolved.delete(id);
  }
  try {
    await transact('readwrite', (store) => store.delete(id));
  } catch {
    // A leftover blob is harmless; the row is going away regardless.
  }
}

export async function clearImages(): Promise<void> {
  for (const objectUrl of resolved.values()) URL.revokeObjectURL(objectUrl);
  resolved.clear();
  try {
    await transact('readwrite', (store) => store.clear());
  } catch {
    // Non-fatal: the rows are gone, orphaned blobs are not a leak of data.
  }
}
