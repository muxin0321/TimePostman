import { fileIo } from '@kit.CoreFileKit';
import { MAX_UPLOAD_BYTES, StagedFile } from '../model/Types';

export class MediaCache {
  private static extensionOf(uri: string): string {
    const match = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(uri);
    return match && match[1] ? match[1].toLowerCase() : 'jpg';
  }

  static detectExtension(buffer: ArrayBuffer, uri: string): string {
    const length = Math.min(buffer.byteLength, 16);
    const bytes = new Uint8Array(buffer, 0, length);
    if (length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return 'jpg';
    }
    if (length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return 'png';
    }
    if (length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('hevc')
        || brand.startsWith('hevx') || brand.startsWith('mif1') || brand.startsWith('msf1')) {
        return 'heic';
      }
      if (brand === 'qt  ') {
        return 'mov';
      }
      if (brand === 'M4V ') {
        return 'm4v';
      }
      return 'mp4';
    }
    return MediaCache.extensionOf(uri);
  }

  static contentTypeOf(ext: string): string {
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'heic':
      case 'heif':
        return 'image/heic';
      case 'mov':
        return 'video/quicktime';
      case 'm4v':
        return 'video/x-m4v';
      case 'mp4':
        return 'video/mp4';
      default:
        return 'application/octet-stream';
    }
  }

  static sourceFileName(uri: string, index: number, ext: string): string {
    const cleanUri = uri.split('?')[0];
    const raw = cleanUri.substring(cleanUri.lastIndexOf('/') + 1);
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch (error) {
      name = raw;
    }
    name = name.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim();
    const dot = name.lastIndexOf('.');
    let base = dot > 0 ? name.substring(0, dot) : name;
    base = base.replace(/[. ]+$/g, '').slice(0, 80);
    if (!base) {
      base = `photo-${Date.now()}-${index}`;
    }
    return `${base}.${ext}`;
  }

  static isUnsupported(ext: string): boolean {
    return ext === 'gif' || ext === 'webp';
  }

  static isTooLarge(size: number): boolean {
    return size > MAX_UPLOAD_BYTES;
  }

  static async stage(uri: string, cacheDir: string, stamp: number, index: number): Promise<StagedFile> {
    const file = await fileIo.open(uri, fileIo.OpenMode.READ_ONLY);
    let size = 0;
    let ext = 'jpg';
    try {
      const stat = await fileIo.stat(file.fd);
      size = stat.size;
      const head = new ArrayBuffer(16);
      await fileIo.read(file.fd, head);
      ext = MediaCache.detectExtension(head, uri);
    } finally {
      await fileIo.close(file.fd);
    }
    const path = `${cacheDir}/tp-upload-${stamp}-${index}.${ext}`;
    const source = await fileIo.open(uri, fileIo.OpenMode.READ_ONLY);
    try {
      await fileIo.copyFile(source.fd, path);
    } finally {
      await fileIo.close(source.fd);
    }
    return {
      path,
      name: MediaCache.sourceFileName(uri, index, ext),
      ext,
      size,
      contentType: MediaCache.contentTypeOf(ext)
    };
  }

  static async remove(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        await fileIo.unlink(path);
      } catch {
        // Cache file may already be gone.
      }
    }
  }
}
