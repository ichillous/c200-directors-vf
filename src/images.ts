import { useEffect, useState } from 'react';
import { del, get, set } from 'idb-keyval';

// Captured frames are JPEG blobs in IndexedDB, keyed by frame id. They never leave the device.

const urls = new Map<string, string>();

export async function saveImage(id: string, blob: Blob): Promise<void> {
  await set(`img:${id}`, blob);
  urls.set(id, URL.createObjectURL(blob));
}

export async function loadImage(id: string): Promise<Blob | undefined> {
  return get<Blob>(`img:${id}`);
}

export async function deleteImage(id: string): Promise<void> {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  await del(`img:${id}`);
}

/** Object URL for a frame's image, or '' while it loads or when there is none. */
export function useImageUrl(id: string, hasImage: boolean): string {
  const [url, setUrl] = useState(() => (hasImage ? (urls.get(id) ?? '') : ''));
  useEffect(() => {
    if (!hasImage) {
      setUrl('');
      return;
    }
    const cached = urls.get(id);
    if (cached) {
      setUrl(cached);
      return;
    }
    let alive = true;
    loadImage(id).then((blob) => {
      if (!blob || !alive) return;
      const made = urls.get(id) ?? URL.createObjectURL(blob);
      urls.set(id, made);
      setUrl(made);
    });
    return () => {
      alive = false;
    };
  }, [id, hasImage]);
  return url;
}
