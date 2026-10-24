import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { DownloadedFile } from '../model/Types';

export interface SaveResult {
  ok: number;
  failed: DownloadedFile[];
}

export class GallerySaver {
  static async save(context: common.Context, items: DownloadedFile[]): Promise<SaveResult> {
    const helper = photoAccessHelper.getPhotoAccessHelper(context);
    let ok = 0;
    const failed: DownloadedFile[] = [];
    for (const item of items) {
      try {
        const photoType = item.kind === 'video'
          ? photoAccessHelper.PhotoType.VIDEO
          : photoAccessHelper.PhotoType.IMAGE;
        const uri = await helper.createAsset(photoType, item.ext, { title: item.title });
        const src = await fileIo.open(item.filePath, fileIo.OpenMode.READ_ONLY);
        const dst = await fileIo.open(uri, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
        try {
          const buffer = new ArrayBuffer(1024 * 1024);
          while (true) {
            const bytesRead = await fileIo.read(src.fd, buffer);
            if (bytesRead <= 0) {
              break;
            }
            await fileIo.write(dst.fd, buffer.slice(0, bytesRead));
          }
        } finally {
          await fileIo.close(src.fd);
          await fileIo.close(dst.fd);
        }
        try {
          await fileIo.unlink(item.filePath);
        } catch (error) {
          // Cache cleanup failure does not affect the saved asset.
        }
        ok += 1;
      } catch (error) {
        failed.push(item);
      }
    }
    return { ok, failed };
  }
}
