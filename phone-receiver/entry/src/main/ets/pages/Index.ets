import { http } from '@kit.NetworkKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo } from '@kit.CoreFileKit';
import { BusinessError } from '@kit.BasicServicesKit';
import {
  DownloadedFile,
  OutboxFile,
  PcDevice,
  PC_PORT,
  UploadResponse
} from '../model/Types';
import { httpErrorMessage, PcLink } from '../service/PcLink';
import { MediaCache } from '../service/MediaCache';
import { GallerySaver } from '../service/GallerySaver';
import { StatusCard } from '../components/StatusCard';
import { UploadCard } from '../components/UploadCard';

@Entry
@Component
struct Index {
  @State paired: boolean = false;
  @State pcHost: string = '';
  @State pcPort: number = PC_PORT;
  @State deviceId: string = '';
  @State status: string = '首次连接：点“发现电脑”，然后在电脑页面读取配对码。';
  @State discovering: boolean = false;
  @State discovered: PcDevice[] = [];
  @State manualHost: string = '';
  @State pendingPair: boolean = false;
  @State pairCode: string = '';
  @State pairBusy: boolean = false;
  @State uploading: boolean = false;
  @State refreshing: boolean = false;
  @State downloading: boolean = false;
  @State saving: boolean = false;
  @State outboxRun: string = '';
  @State outboxFiles: OutboxFile[] = [];
  @State outboxExpanded: boolean = false;
  @State downloadedCount: number = 0;
  @State uploadProgress: number = 0;
  @State uploadStage: string = '';
  @State downloadProgress: number = 0;
  @State downloadStage: string = '';
  @State speedText: string = '';
  private link: PcLink = new PcLink();
  private pairHost: string = '';
  private pairPort: number = PC_PORT;
  private pendingRequestId: string = '';
  private downloaded: DownloadedFile[] = [];
  private uploadBytes: number = 0;
  private downloadDoneBytes: number = 0;
  private downloadTotalBytes: number = 0;
  private speedAt: number = 0;

  aboutToAppear(): void {
    this.initPrefs();
  }

  private async initPrefs(): Promise<void> {
    try {
      const context = this.getUIContext().getHostContext();
      if (!context) return;
      await this.link.init(context);
      this.pcHost = this.link.host;
      this.pcPort = this.link.port;
      this.deviceId = this.link.deviceId;
      this.paired = this.link.isPaired();
      this.status = this.paired
        ? '准备就绪：选择照片或视频开始。'
        : '首次连接：点“发现电脑”，然后在电脑页面读取配对码。';
    } catch (error) {
      const e = error as BusinessError;
      this.status = `本地存储初始化失败：${e.message || '未知错误'}`;
    }
  }


  private formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B';
    }
    if (value >= 1024 * 1024 * 1024) {
      return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
    }
    if (value >= 1024 * 1024) {
      return `${(value / 1024 / 1024).toFixed(1)} MB`;
    }
    if (value >= 1024) {
      return `${Math.round(value / 1024)} KB`;
    }
    return `${Math.round(value)} B`;
  }

  private formatSpeed(bytesPerSecond: number): string {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
      return '';
    }
    if (bytesPerSecond >= 1024 * 1024) {
      return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
    }
    return `${Math.round(bytesPerSecond / 1024)} KB/s`;
  }

  private resetSpeed(): void {
    this.speedAt = Date.now();
    this.speedText = '';
  }

  private trackSpeed(currentBytes: number): void {
    if (this.speedAt === 0 || currentBytes <= 0) {
      return;
    }
    const elapsed = Date.now() - this.speedAt;
    if (elapsed < 500) {
      return;
    }
    this.speedText = this.formatSpeed(currentBytes * 1000 / elapsed);
  }

  private isBusy(): boolean {
    return this.uploading || this.downloading || this.refreshing || this.saving || this.discovering || this.pairBusy;
  }

  private isUsbHost(): boolean {
    return this.pcHost === '127.0.0.1';
  }

  private visibleOutboxFiles(): OutboxFile[] {
    return this.outboxExpanded ? this.outboxFiles : this.outboxFiles.slice(0, 5);
  }

  private async toggleUsb(): Promise<void> {
    this.status = this.link.isUsbHost() ? '正在切回 Wi-Fi…' : '正在检测 USB 直连…';
    try {
      const usb = await this.link.toggleUsb();
      this.pcHost = this.link.host;
      this.pcPort = this.link.port;
      this.status = usb ? '已切换到 USB 直连，传输会更快。' : '已切回 Wi-Fi。';
    } catch (error) {
      const e = error as BusinessError;
      this.status = e.message || '切换连接方式失败。';
    }
  }

  private async fallbackFromUsb(): Promise<boolean> {
    const switched = await this.link.fallbackFromUsb();
    if (switched) {
      this.pcHost = this.link.host;
      this.pcPort = this.link.port;
    }
    return switched;
  }

  private async discover(): Promise<void> {
    if (this.discovering) return;
    this.discovering = true;
    this.discovered = [];
    this.status = '正在搜索同一局域网内的电脑…';
    try {
      this.discovered = await this.link.discover();
    } catch (error) {
      const e = error as BusinessError;
      this.status = `发现失败：${e.message || '未知错误'}。可以手动输入电脑 IP。`;
    } finally {
      this.discovering = false;
      if (this.discovered.length === 0) {
        this.status = '没有自动发现电脑。请确认同一 Wi-Fi，或手动输入电脑 IP。';
      } else {
        this.status = `发现 ${this.discovered.length} 台电脑，点“配对”继续。`;
      }
    }
  }

  private async requestPairing(host: string, port: number): Promise<void> {
    if (this.pairBusy) return;
    const targetHost = host.trim();
    if (!targetHost) {
      this.status = '请先输入电脑 IP。';
      return;
    }
    this.pairBusy = true;
    this.status = '正在向电脑申请配对…';
    try {
      const data = await this.link.requestPairing(targetHost, port);
      this.pairHost = targetHost;
      this.pairPort = port;
      this.pendingRequestId = data.requestId;
      this.pendingPair = true;
      this.pairCode = '';
      this.status = '请在电脑页面查看 6 位配对码，然后输入。';
    } catch (error) {
      const e = error as BusinessError;
      this.status = `申请配对失败：${e.message || '未知错误'}`;
    } finally {
      this.pairBusy = false;
    }
  }

  private async confirmPairing(): Promise<void> {
    if (this.pairBusy) return;
    if (this.pairCode.length !== 6) {
      this.status = '请输入电脑页面显示的 6 位配对码。';
      return;
    }
    this.pairBusy = true;
    try {
      await this.link.confirmPairing(this.pairHost, this.pairPort, this.pendingRequestId, this.pairCode);
      this.pcHost = this.link.host;
      this.pcPort = this.link.port;
      this.paired = true;
      this.pendingPair = false;
      this.status = '配对成功，可以开始上传了。';
    } catch (error) {
      const e = error as BusinessError;
      this.status = `配对失败：${e.message || '未知错误'}`;
    } finally {
      this.pairBusy = false;
    }
  }

  private async resetPairing(): Promise<void> {
    this.paired = false;
    this.pendingPair = false;
    this.pcHost = '';
    this.pcPort = PC_PORT;
    this.pendingRequestId = '';
    this.pairCode = '';
    this.discovered = [];
    this.outboxFiles = [];
    this.downloaded = [];
    this.downloadedCount = 0;
    this.status = '已断开。重新发现电脑，或手动输入电脑 IP。';
    await this.link.reset();
  }

  private async pickAndUpload(): Promise<void> {
    if (this.uploading) return;
    if (!this.paired || !this.link.token) {
      this.status = '请先完成电脑配对。';
      return;
    }
    const context = this.getUIContext().getHostContext();
    if (!context) {
      this.status = '获取应用缓存目录失败。';
      return;
    }
    this.uploading = true;
    this.uploadProgress = 0;
    this.uploadStage = '正在打开相册…';
    this.uploadBytes = 0;
    this.resetSpeed();
    this.status = '正在打开相册…';
    const staged: string[] = [];
    try {
      const picker = new photoAccessHelper.PhotoViewPicker();
      const options = new photoAccessHelper.PhotoSelectOptions();
      options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_VIDEO_TYPE;
      options.maxSelectNumber = 50;
      const result = await picker.select(options);
      if (!result.photoUris || result.photoUris.length === 0) {
        this.status = '没有选择照片或视频。';
        return;
      }
      this.status = `正在准备 ${result.photoUris.length} 个文件…`;
      this.uploadStage = `正在准备 ${result.photoUris.length} 个文件…`;
      const formData: http.MultiFormData[] = [];
      const stamp = Date.now();
      let skipped = 0;
      let unsupported = 0;
      this.uploadBytes = 0;
      for (let index = 0; index < result.photoUris.length; index++) {
        const file = await MediaCache.stage(result.photoUris[index], context.cacheDir, stamp, index);
        if (MediaCache.isUnsupported(file.ext)) {
          unsupported += 1;
          await MediaCache.remove([file.path]);
          continue;
        }
        if (MediaCache.isTooLarge(file.size)) {
          skipped += 1;
          await MediaCache.remove([file.path]);
          continue;
        }
        staged.push(file.path);
        this.uploadBytes += file.size;
        formData.push({
          name: 'files',
          contentType: file.contentType,
          remoteFileName: file.name,
          filePath: file.path
        });
      }
      if (formData.length === 0 || this.uploadBytes === 0) {
        this.status = unsupported > 0 && skipped === 0
          ? `${unsupported} 个 GIF/WebP 无法修改图库日期，未上传。`
          : skipped > 0 ? `${skipped} 个文件都超过 300MB，未上传。` : '没有可上传的文件。';
        return;
      }

      this.resetSpeed();
      this.uploadStage = `正在上传 ${formData.length} 个文件…`;
      this.status = this.uploadStage;
      const data = await this.link.upload(formData, this.uploadBytes, (sentBytes: number) => {
        const percent = this.uploadBytes > 0
          ? Math.min(99, Math.round(sentBytes * 100 / this.uploadBytes))
          : 0;
        if (percent !== this.uploadProgress) {
          this.uploadProgress = percent;
        }
        this.trackSpeed(sentBytes);
      });
      const skippedNote = skipped > 0 ? `，${skipped} 个超过 300MB 已跳过` : '';
      const unsupportedNote = unsupported > 0 ? `，${unsupported} 个 GIF/WebP 无法修改图库日期已跳过` : '';
      this.uploadProgress = 100;
      this.uploadStage = '上传完成';
      this.status = `已上传 ${data.count} 个文件${skippedNote}${unsupportedNote}。去电脑上点“手机传入”并改日期，然后回来刷新结果。`;
    } catch (error) {
      const e = error as BusinessError;
      const switched = await this.fallbackFromUsb();
      this.status = switched
        ? `USB 直连中断，已切回 Wi-Fi，请重试。原错误：${e.message || '未知错误'}`
        : `上传失败：${e.message || '未知错误'}`;
    } finally {
      await MediaCache.remove(staged);
      this.uploading = false;
    }
  }

  private async refreshOutbox(): Promise<void> {
    if (this.refreshing) return;
    if (!this.paired || !this.link.token) {
      this.status = '请先完成电脑配对。';
      return;
    }
    this.refreshing = true;
    this.status = '正在读取电脑上的处理结果…';
    try {
      const data = await this.link.fetchOutbox();
      this.outboxRun = data.run || '';
      this.outboxFiles = data.files || [];
      this.outboxExpanded = false;
      await this.removeDownloadedCache();
      this.downloaded = [];
      this.downloadedCount = 0;
      this.status = this.outboxFiles.length === 0
        ? '电脑上还没有处理结果。先上传照片，在电脑上处理后再刷新。'
        : `找到 ${this.outboxFiles.length} 个结果，点“下载全部结果”。`;
    } catch (error) {
      const e = error as BusinessError;
      const switched = await this.fallbackFromUsb();
      this.status = switched
        ? `USB 直连中断，已切回 Wi-Fi，请重试。原错误：${e.message || '未知错误'}`
        : `刷新失败：${e.message || '未知错误'}`;
    } finally {
      this.refreshing = false;
    }
  }

  private async removeDownloadedCache(): Promise<void> {
    const paths: string[] = [];
    for (const item of this.downloaded) {
      paths.push(item.filePath);
    }
    await MediaCache.remove(paths);
  }

  private updateDownloadProgress(): void {
    if (this.downloadTotalBytes <= 0) return;
    const percent = Math.min(99, Math.round(this.downloadDoneBytes * 100 / this.downloadTotalBytes));
    if (percent !== this.downloadProgress) {
      this.downloadProgress = percent;
    }
    this.trackSpeed(this.downloadDoneBytes);
  }

  private async downloadOutbox(): Promise<void> {
    if (this.downloading) return;
    if (!this.paired || !this.link.token) {
      this.status = '请先完成电脑配对。';
      return;
    }
    if (this.outboxFiles.length === 0) {
      this.status = '请先刷新电脑结果。';
      return;
    }
    const context = this.getUIContext().getHostContext();
    if (!context) {
      this.status = '获取应用缓存目录失败。';
      return;
    }
    this.downloading = true;
    await this.removeDownloadedCache();
    this.downloaded = [];
    this.downloadedCount = 0;
    this.downloadProgress = 0;
    this.downloadStage = '正在下载处理结果…';
    this.resetSpeed();
    this.status = '正在下载处理结果…';
    this.downloadTotalBytes = 0;
    for (const item of this.outboxFiles) {
      this.downloadTotalBytes += item.size || 0;
    }
    this.downloadDoneBytes = 0;
    let currentCachePath = '';
    try {
      for (let index = 0; index < this.outboxFiles.length; index++) {
        const item = this.outboxFiles[index];
        this.downloadStage = `正在下载 ${index + 1}/${this.outboxFiles.length}：${item.name}`;
        const ext = (item.ext || 'jpg').toLowerCase();
        currentCachePath = `${context.cacheDir}/tp-result-${Date.now()}-${index}.${ext}`;
        const url = `${this.link.baseUrl()}/api/outbox/file?run=${encodeURIComponent(this.outboxRun)}&path=${encodeURIComponent(item.relativePath)}&token=${this.link.token}`;
        const file = await fileIo.open(currentCachePath, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
        let writeFailed = false;
        let writeErrorMessage = '';
        let responseCode = 0;
        try {
          responseCode = await this.link.download(url, (chunk: ArrayBuffer) => {
            if (writeFailed) return;
            try {
              fileIo.writeSync(file.fd, chunk);
              this.downloadDoneBytes += chunk.byteLength;
              this.updateDownloadProgress();
            } catch (error) {
              writeFailed = true;
              writeErrorMessage = (error as Error).message;
            }
          });
        } finally {
          await fileIo.close(file.fd);
        }
        if (responseCode !== 200 || writeFailed) {
          try {
            await fileIo.unlink(currentCachePath);
          } catch {
            // Ignore partial cache cleanup failures.
          }
          if (writeFailed) {
            throw new Error(writeErrorMessage || '写入缓存失败');
          }
          throw new Error(`下载失败：HTTP ${responseCode}`);
        }
        this.downloaded.push(new DownloadedFile(item.name, item.kind, item.ext, item.date, currentCachePath));
      }
      this.downloadDoneBytes = this.downloadTotalBytes;
      this.downloadProgress = 100;
      this.downloadStage = '下载完成';
      this.downloadedCount = this.downloaded.length;
      this.status = `已下载 ${this.downloadedCount} 个结果。点系统“保存”按钮写入图库。`;
    } catch (error) {
      if (currentCachePath) {
        try {
          await fileIo.unlink(currentCachePath);
        } catch {
          // Ignore partial cache cleanup failures.
        }
      }
      const e = error as BusinessError;
      const switched = await this.fallbackFromUsb();
      this.status = switched
        ? `USB 直连中断，已切回 Wi-Fi，请重试。原错误：${e.message || '未知错误'}`
        : `下载失败：${e.message || '未知错误'}`;
    } finally {
      this.downloading = false;
    }
  }

  private handleSave: SaveButtonCallback = async (
    event: ClickEvent,
    result: SaveButtonOnClickResult,
    error?: BusinessError
  ) => {
    if (result !== SaveButtonOnClickResult.SUCCESS) {
      this.status = result === SaveButtonOnClickResult.CANCELED_BY_USER
        ? '已取消保存。'
        : '保存授权失败，请重试。';
      return;
    }
    if (this.saving) return;
    if (this.downloaded.length === 0) {
      this.status = '请先下载电脑处理结果。';
      return;
    }
    this.saving = true;
    const context = this.getUIContext().getHostContext();
    if (!context) {
      this.saving = false;
      this.status = '获取应用上下文失败。';
      return;
    }
    const resultData = await GallerySaver.save(context, this.downloaded);
    this.downloaded = resultData.failed;
    this.downloadedCount = resultData.failed.length;
    this.saving = false;
    this.status = resultData.failed.length === 0
      ? `已全部保存 ${resultData.ok} 个到图库。请到系统图库检查日期。`
      : `已保存 ${resultData.ok} 个，失败 ${resultData.failed.length} 个；请再点一次系统保存重试。`;
  };

  build() {
    Scroll() {
      Column({ space: 14 }) {
        Text('TimePostman 双向互传')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor('#162033')
        Text('手机上传照片 → 电脑改日期 → 手机接收结果并保存到图库。')
          .fontSize(14)
          .fontColor('#667085')

        StatusCard({
          status: this.status,
          busy: this.isBusy(),
          uploading: this.uploading,
          uploadProgress: this.uploadProgress,
          uploadStage: this.uploadStage,
          downloading: this.downloading,
          downloadProgress: this.downloadProgress,
          downloadStage: this.downloadStage,
          speedText: this.speedText
        })

        if (!this.paired) {
          Column({ space: 12 }) {
            Text('连接电脑')
              .fontSize(18)
              .fontWeight(FontWeight.Bold)
              .fontColor('#162033')
            Text('电脑和手机在同一局域网，打开电脑端程序后点“发现电脑”。USB 连接可手动输入 127.0.0.1。')
              .fontSize(12)
              .fontColor('#667085')
          Button(this.discovering ? '搜索中…' : '发现电脑')
            .onClick(() => {
              this.discover();
            })
            .enabled(!this.discovering)
            .width('100%')
          if (this.discovered.length > 0) {
            Column({ space: 8 }) {
              ForEach(this.discovered, (device: PcDevice) => {
                Row({ space: 10 }) {
                  Column({ space: 2 }) {
                    Text(device.name)
                      .fontSize(14)
                      .fontWeight(FontWeight.Medium)
                      .fontColor('#162033')
                    Text(`${device.host}:${device.port}`)
                      .fontSize(11)
                      .fontColor('#98A2B3')
                  }
                  .layoutWeight(1)
                  .alignItems(HorizontalAlign.Start)
                  Button('配对')
                    .onClick(() => {
                      this.requestPairing(device.host, device.port);
                    })
                    .enabled(!this.pairBusy)
                }
                .width('100%')
                .padding(10)
                .backgroundColor('#FFFFFF')
                .borderRadius(10)
              }, (device: PcDevice) => `${device.host}:${device.port}`)
            }
            .width('100%')
          }
          Row({ space: 8 }) {
            TextInput({ text: this.manualHost, placeholder: '手动输入电脑 IP' })
              .onChange((value: string) => {
                this.manualHost = value;
              })
              .layoutWeight(1)
            Button('用 IP 配对')
              .onClick(() => {
                this.requestPairing(this.manualHost, PC_PORT);
              })
              .enabled(!this.pairBusy)
          }
          .width('100%')
          if (this.pendingPair) {
            Column({ space: 8 }) {
              Text('电脑页面显示的 6 位配对码')
                .fontSize(13)
                .fontColor('#344054')
              TextInput({ text: this.pairCode, placeholder: '6 位数字' })
                .type(InputType.Number)
                .maxLength(6)
                .onChange((value: string) => {
                  this.pairCode = value;
                })
                .width('100%')
              Row({ space: 8 }) {
                Button(this.pairBusy ? '确认中…' : '确认配对')
                  .onClick(() => {
                    this.confirmPairing();
                  })
                  .enabled(!this.pairBusy)
                  .layoutWeight(1)
                Button('取消')
                  .onClick(() => {
                    this.pendingPair = false;
                    this.pairCode = '';
                    this.status = '已取消本次配对。';
                  })
                  .enabled(!this.pairBusy)
              }
              .width('100%')
            }
            .width('100%')
            .padding(12)
            .backgroundColor('#F7F9FC')
            .borderRadius(10)
          }
          }
          .width('100%')
          .padding(16)
          .backgroundColor('#FFFFFF')
          .borderRadius(14)
          .alignItems(HorizontalAlign.Start)
        } else {
          Column({ space: 8 }) {
            Row({ space: 8 }) {
              Column({ space: 2 }) {
                Text('已连接电脑')
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor('#0F8A5F')
                Text(`${this.pcHost}:${this.pcPort}`)
                  .fontSize(11)
                  .fontColor('#667085')
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              Text(this.isUsbHost() ? 'USB' : 'Wi-Fi')
                .fontSize(10)
                .fontColor(this.isUsbHost() ? '#0F8A5F' : '#2F6FED')
                .backgroundColor(this.isUsbHost() ? '#D9F2E6' : '#EAF2FF')
                .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                .borderRadius(10)
            }
            .width('100%')
            Row({ space: 8 }) {
              Button(this.isUsbHost() ? '切回 Wi-Fi' : 'USB 直连')
                .fontSize(12)
                .onClick(() => {
                  this.toggleUsb();
                })
                .enabled(!this.isBusy())
                .layoutWeight(1)
              Button('重新配对')
                .fontSize(12)
                .onClick(() => {
                  this.resetPairing();
                })
                .enabled(!this.isBusy())
                .layoutWeight(1)
            }
            .width('100%')
          }
          .width('100%')
          .padding(12)
          .backgroundColor('#E7F7F0')
          .borderRadius(12)

          UploadCard({
            uploading: this.uploading,
            uploadProgress: this.uploadProgress,
            onUpload: () => {
              this.pickAndUpload();
            }
          })

          Column({ space: 10 }) {
            Row({ space: 8 }) {
              Text('2')
                .width(24)
                .height(24)
                .textAlign(TextAlign.Center)
                .fontSize(13)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
                .backgroundColor('#0F8A5F')
                .borderRadius(12)
              Text('接收电脑结果')
                .fontSize(17)
                .fontWeight(FontWeight.Medium)
                .fontColor('#162033')
            }
            .width('100%')
            Text('电脑上处理完成后，先刷新，再下载改好日期的文件，最后用系统按钮保存到图库。')
              .fontSize(12)
              .fontColor('#667085')
            Row({ space: 10 }) {
              Button(this.refreshing ? '刷新中…' : '刷新结果')
                .onClick(() => {
                  this.refreshOutbox();
                })
                .enabled(!this.refreshing)
                .layoutWeight(1)
              Button(this.downloading ? `下载中 ${this.downloadProgress}%` : `下载全部结果 (${this.outboxFiles.length})`)
                .onClick(() => {
                  this.downloadOutbox();
                })
                .enabled(!this.downloading && this.outboxFiles.length > 0)
                .layoutWeight(1)
            }
            .width('100%')
            if (this.downloadedCount > 0) {
              Column({ space: 8 }) {
                Text(`已下载 ${this.downloadedCount} 个，等待保存到图库`)
                  .fontSize(13)
                  .fontColor('#0F8A5F')
                SaveButton({
                  icon: SaveIconStyle.FULL_FILLED,
                  text: SaveDescription.SAVE,
                  buttonType: ButtonType.Capsule
                })
                  .onClick(this.handleSave)
                  .width('100%')
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
            }
            if (this.outboxRun) {
              Text(`批次 ${this.outboxRun}`)
                .fontSize(11)
                .fontColor('#98A2B3')
            }
            if (this.outboxFiles.length > 0) {
              Column({ space: 6 }) {
                Text(`电脑上有 ${this.outboxFiles.length} 个结果`)
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor('#344054')
                ForEach(this.visibleOutboxFiles(), (item: OutboxFile) => {
                  Row({ space: 8 }) {
                    Text(item.kind === 'video' ? '视频' : '图片')
                      .fontSize(10)
                      .fontColor('#2F6FED')
                      .backgroundColor('#EAF2FF')
                      .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                      .borderRadius(4)
                    Column({ space: 2 }) {
                      Text(item.name)
                        .fontSize(12)
                        .fontColor('#344054')
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                      Text(`${this.formatBytes(item.size)} · ${item.date}`)
                        .fontSize(10)
                        .fontColor('#98A2B3')
                    }
                    .layoutWeight(1)
                    .alignItems(HorizontalAlign.Start)
                  }
                  .width('100%')
                }, (item: OutboxFile) => item.relativePath)
                if (this.outboxFiles.length > 5) {
                  Button(this.outboxExpanded ? '收起列表' : `展开全部 ${this.outboxFiles.length} 个`)
                    .fontSize(12)
                    .width('100%')
                    .onClick(() => {
                      this.outboxExpanded = !this.outboxExpanded;
                    })
                }
              }
              .width('100%')
              .padding(10)
              .backgroundColor('#F7F9FC')
              .borderRadius(10)
              .alignItems(HorizontalAlign.Start)
            }
          }
          .width('100%')
          .padding(16)
          .backgroundColor('#FFFFFF')
          .borderRadius(14)
          .alignItems(HorizontalAlign.Start)
        }

        Column({ space: 4 }) {
          Text('提示')
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor('#344054')
          Text('目标日期以电脑端设置为准；保存后到系统图库检查日期和时间线位置。')
            .fontSize(11)
            .fontColor('#98A2B3')
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding(24)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F3F5FB')
  }
}
