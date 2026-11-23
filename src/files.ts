import { Capacitor } from '@capacitor/core';

// Handing a file to the person. Kept apart from the app state so the log module can use it too.

/** Attach a short machine-readable tag to an error, for the log. */
export function tagged<T extends string>(err: unknown, key: 'reason' | 'stage', value: T): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  const rec = e as unknown as Record<string, unknown>;
  if (rec[key] === undefined) rec[key] = value;
  return e;
}

/** Why an import failed (json, not_object, version) or where a file hand-over failed (zip, base64, write, share). */
export const errorTag = (err: unknown, key: 'reason' | 'stage'): string | undefined => {
  const v = (err as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : undefined;
};

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Hand a file to the person: the Android share sheet in the installed app,
 * a normal download in a browser. Closing the share sheet without picking anything returns 'cancelled'.
 * Errors carry a `stage` tag: base64, write or share.
 */
export async function saveFile(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const data = await toBase64(blob).catch((err) => { throw tagged(err, 'stage', 'base64'); });
    const written = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache }).catch((err) => { throw tagged(err, 'stage', 'write'); });
    try {
      await Share.share({ title: name, files: [written.uri] });
    } catch (err) {
      if (/cancel/i.test(err instanceof Error ? err.message : String(err))) return 'cancelled';
      throw tagged(err, 'stage', 'share');
    }
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
