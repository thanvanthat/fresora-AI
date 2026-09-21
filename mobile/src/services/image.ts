import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { IMAGE_COMPRESSION, IMAGE_MAX_DIMENSION } from '../constants/config';
import type { UploadField } from './api/client';

/**
 * Image capture, compression and persistence.
 *
 * A modern phone camera produces 3-8 MB files at 4000px wide. Uploading that
 * raw would be slow on mobile data and the backend downscales to 1024px
 * anyway, so everything is resized and re-encoded before it leaves the device.
 *
 * APIs used here are the SDK 57 ones, verified against the installed packages:
 * `ImageManipulator.manipulate()` (not the deprecated `manipulateAsync`), and
 * the `File`/`Directory`/`Paths` filesystem API (not the legacy
 * `FileSystem.copyAsync`).
 */

export interface PreparedImage {
  /** Local file URI of the compressed copy. */
  uri: string;
  width: number;
  height: number;
  /** Ready to hand to `apiUpload`. */
  upload: UploadField;
}

/** Subdirectory of the document directory where inventory photos are kept. */
const IMAGE_DIR = 'food-images';

/**
 * Resize to at most IMAGE_MAX_DIMENSION on the long edge and re-encode as JPEG.
 *
 * Only `width` is given, so the height is derived and the aspect ratio is
 * preserved. JPEG rather than PNG deliberately: these are photographs, so JPEG
 * is an order of magnitude smaller at no visible cost, and it normalises iOS
 * HEIC into something the backend can decode.
 */
export async function prepareForUpload(uri: string): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(uri).resize({ width: IMAGE_MAX_DIMENSION });

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    compress: IMAGE_COMPRESSION,
    format: SaveFormat.JPEG,
  });

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    upload: { uri: result.uri, name: 'food.jpg', type: 'image/jpeg' },
  };
}

/**
 * Copies an image into the app's document directory.
 *
 * Camera, picker and manipulator results all live in the OS **cache**, which is
 * cleared without warning when storage runs low -- an inventory photo kept only
 * there would silently become a broken thumbnail. The document directory is not
 * cleared by the system.
 *
 * Returns null on failure rather than throwing: losing a thumbnail must never
 * lose the scan itself.
 */
export async function persistImage(uri: string, id: string): Promise<string | null> {
  try {
    const directory = new Directory(Paths.document, IMAGE_DIR);
    if (!directory.exists) {
      directory.create({ intermediates: true });
    }

    const destination = new File(directory, `${id}.jpg`);
    // copy() throws if the destination already exists.
    if (destination.exists) destination.delete();

    await new File(uri).copy(destination);
    return destination.uri;
  } catch {
    return null;
  }
}

/** Deletes a stored image. Silent on failure -- a leftover file is harmless. */
export async function deleteStoredImage(uri: string | null): Promise<void> {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing to do: the row is going away regardless.
  }
}

/** Removes every stored food image. Used by "delete account and data". */
export async function deleteAllStoredImages(): Promise<void> {
  try {
    const directory = new Directory(Paths.document, IMAGE_DIR);
    if (directory.exists) directory.delete();
  } catch {
    // Non-fatal: the rows are gone, the orphaned files are not a leak.
  }
}

export interface PickResult {
  uri: string;
  cancelled: boolean;
  /** Set when permission was refused, so the UI can explain rather than fail. */
  permissionDenied?: boolean;
}

/** Opens the photo library. */
export async function pickFromGallery(): Promise<PickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { uri: '', cancelled: true, permissionDenied: true };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: false,
    // Multiple selection would complicate the single-item analysis flow.
    allowsMultipleSelection: false,
  });

  if (result.canceled || !result.assets?.length) {
    return { uri: '', cancelled: true };
  }
  return { uri: result.assets[0].uri, cancelled: false };
}
