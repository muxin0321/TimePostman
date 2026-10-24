import { http, socket } from '@kit.NetworkKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo } from '@kit.CoreFileKit';
import { preferences } from '@kit.ArkData';
import { BusinessError } from '@kit.BasicServicesKit';

const PC_PORT: number = 8787;
const DISCOVERY_PORT: number = 8786;

interface UploadedFile {
  name: string;
  size: number;
}

interface UploadResponse {
  count: number;
  files: UploadedFile[];
}

interface OutboxFile {
  name: string;
  relativePath: string;
  kind: string;
  ext: string;
  date: string;
  size: number;
}

interface OutboxResponse {
  run: string;
  files: OutboxFile[];
}

interface ErrorResponse {
  error?: string;
}

interface PcDevice {
  name: string;
  host: string;
  port: number;
}

interface DiscoveryReply {
  service: string;
  name: string;
  port: number;
}

interface PairRequestResponse {
  requestId: string;
  expiresAt: number;
}

interface PairConfirmResponse {
  token: string;
  port: number;
  name: string;
}

interface UdpMessage {
  message: ArrayBuffer;
  remoteInfo: socket.SocketRemoteInfo;
}

class DownloadedFile {
  name: string;
  title: string;
  kind: string;
  ext: string;
  date: string;
  filePath: string;

  constructor(name: string, kind: string, ext: string, date: string, filePath: string) {
    this.name = name;
    this.title = name.includes('.') ? name.substring(0, name.lastIndexOf('.')) : name;
    this.kind = kind;
    this.ext = ext;
    this.date = date;
    this.filePath = filePath;
  }
}

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
  private token: string = '';
  private prefs: preferences.Preferences | null = null;
  private pairHost: string = '';
  private pairPort: number = PC_PORT;
  private wifiHost: string = '';
  private pendingRequestId: string = '';
  private deviceName: string = 'HarmonyOS 手机';
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
      this.prefs = await preferences.getPreferences(context, 'timepostman');
      this.pcHost = String(this.prefs.getSync('pcHost', '') ?? '');
      this.pcPort = Number(this.prefs.getSync('pcPort', PC_PORT) ?? PC_PORT);
      this.wifiHost = String(this.prefs.getSync('wifiHost', '') ?? '');
      if (!this.wifiHost && this.pcHost && this.pcHost !== '127.0.0.1') {
        this.wifiHost = this.pcHost;
      }
      this.token = String(this.prefs.getSync('token', '') ?? '');
      this.deviceId = String(this.prefs.getSync('deviceId', '') ?? '');
      if (!this.deviceId) {
        this.deviceId = `tp-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        this.prefs.putSync('deviceId', this.deviceId);
        await this.prefs.flush();
      }
      this.paired = Boolean(this.pcHost && this.token);
      this.status = this.paired
        ? '准备就绪：选择照片或视频开始。'
        : '首次连接：点“发现电脑”，然后在电脑页面读取配对码。';
    } catch (error) {
      const e = error as BusinessError;
      this.status = `本地存储初始化失败：${e.message || '未知错误'}`;
    }
  }

  private baseUrl(): string {
    return `http://${this.pcHost}:${this.pcPort}`;
  }

  private errorMessage(response: http.HttpResponse): string {
    try {
      const body = JSON.parse(response.result as string) as ErrorResponse;
      if (body.error) {
        return body.error;
      }
    } catch (err) {
      // Response body is not JSON.
    }
    return `HTTP ${response.responseCode}`;
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

  private async saveHostPrefs(): Promise<void> {
    if (!this.prefs) return;
    this.prefs.putSync('pcHost', this.pcHost);
    this.prefs.putSync('pcPort', this.pcPort);
    this.prefs.putSync('wifiHost', this.wifiHost);
    await this.prefs.flush();
  }

  private async checkHost(host: string): Promise<boolean> {
    const request = http.createHttp();
    try {
      const response = await request.request(`http://${host}:${PC_PORT}/health`, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 1200,
        readTimeout: 1200
      });
      return response.responseCode === 200;
    } catch (error) {
      return false;
    } finally {
      request.destroy();
    }
  }

  private async toggleUsb(): Promise<void> {
    if (this.isUsbHost()) {
      if (!this.wifiHost) {
        this.status = '没有保存 Wi-Fi 地址，请重新配对并输入电脑 IP。';
        return;
      }
      this.pcHost = this.wifiHost;
      this.pcPort = PC_PORT;
      await this.saveHostPrefs();
      this.status = '已切回 Wi-Fi。';
      return;
    }
    this.status = '正在检测 USB 直连…';
    if (!(await this.checkHost('127.0.0.1'))) {
      this.status = 'USB 直连不可用：先在电脑运行 hdc rport tcp:8787 tcp:8787。';
      return;
    }
    this.wifiHost = this.pcHost;
    this.pcHost = '127.0.0.1';
    this.pcPort = PC_PORT;
    await this.saveHostPrefs();
    this.status = '已切换到 USB 直连，传输会更快。';
  }

  private async fallbackFromUsb(): Promise<boolean> {
    if (!this.isUsbHost() || !this.wifiHost) {
      return false;
    }
    this.pcHost = this.wifiHost;
    this.pcPort = PC_PORT;
    await this.saveHostPrefs();
    return true;
  }

  private async discover(): Promise<void> {
    if (this.discovering) return;
    this.discovering = true;
    this.discovered = [];
    this.status = '正在搜索同一局域网内的电脑…';
    let udp: socket.UDPSocket | null = null;
    try {
      udp = socket.constructUDPSocketInstance();
      await udp.bind({ address: '0.0.0.0', port: 0 });
      await udp.setExtraOptions({ broadcast: true });
      udp.on('message', (value: UdpMessage) => {
        try {
          const bytes = new Uint8Array(value.message);
          let text = '';
          for (let index = 0; index < bytes.length; index++) {
            text += String.fromCharCode(bytes[index]);
          }
          const reply = JSON.parse(text) as DiscoveryReply;
          if (reply.service !== 'timepostman' || !reply.port) return;
          const host = value.remoteInfo.address;
          const exists = this.discovered.some((item: PcDevice) => item.host === host && item.port === reply.port);
          if (!exists) {
            this.discovered = [...this.discovered, {
              name: reply.name || 'TimePostman 电脑',
              host,
              port: reply.port
            }];
          }
        } catch (err) {
          // Ignore malformed discovery replies.
        }
      });
      await udp.send({
        data: 'TIMEPOSTMAN_DISCOVER',
        address: {
          address: '255.255.255.255',
          port: DISCOVERY_PORT
        }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      const e = error as BusinessError;
      this.status = `发现失败：${e.message || '未知错误'}。可以手动输入电脑 IP。`;
    } finally {
      if (udp) {
        try {
          udp.off('message');
          await udp.close();
        } catch (err) {
          // Socket may already be closed.
        }
      }
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
    const request = http.createHttp();
    try {
      const response = await request.request(`http://${targetHost}:${port}/pair/request`, {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json' },
        extraData: JSON.stringify({
          deviceId: this.deviceId,
          deviceName: this.deviceName
        }),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 15000
      });
      if (response.responseCode !== 200) {
        throw new Error(this.errorMessage(response));
      }
      const data = JSON.parse(response.result as string) as PairRequestResponse;
      if (!data.requestId) {
        throw new Error('电脑没有返回配对请求');
      }
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
      request.destroy();
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
    const request = http.createHttp();
    try {
      const response = await request.request(`http://${this.pairHost}:${this.pairPort}/pair/confirm`, {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json' },
        extraData: JSON.stringify({
          requestId: this.pendingRequestId,
          code: this.pairCode
        }),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 15000
      });
      if (response.responseCode !== 200) {
        throw new Error(this.errorMessage(response));
      }
      const data = JSON.parse(response.result as string) as PairConfirmResponse;
      if (!data.token) {
        throw new Error('配对失败，没有拿到令牌');
      }
      this.token = data.token;
      this.pcHost = this.pairHost;
      this.pcPort = data.port || this.pairPort;
      if (this.pcHost !== '127.0.0.1') {
        this.wifiHost = this.pcHost;
      }
      this.paired = true;
      this.pendingPair = false;
      if (this.prefs) {
        this.prefs.putSync('pcHost', this.pcHost);
        this.prefs.putSync('pcPort', this.pcPort);
        this.prefs.putSync('wifiHost', this.wifiHost);
        this.prefs.putSync('token', this.token);
        await this.prefs.flush();
      }
      this.status = '配对成功，可以开始上传了。';
    } catch (error) {
      const e = error as BusinessError;
      this.status = `配对失败：${e.message || '未知错误'}`;
    } finally {
      request.destroy();
      this.pairBusy = false;
    }
  }

  private resetPairing(): void {
    this.paired = false;
    this.pendingPair = false;
    this.token = '';
    this.pcHost = '';
    this.pcPort = PC_PORT;
    this.wifiHost = '';
    this.pendingRequestId = '';
    this.pairCode = '';
    this.discovered = [];
    this.outboxFiles = [];
    this.downloaded = [];
    this.downloadedCount = 0;
    this.status = '已断开。重新发现电脑，或手动输入电脑 IP。';
    if (this.prefs) {
      this.prefs.putSync('pcHost', '');
      this.prefs.putSync('wifiHost', '');
      this.prefs.putSync('token', '');
      this.prefs.flush();
    }
  }

  private extensionOf(uri: string): string {
    const match = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(uri);
    return match && match[1] ? match[1].toLowerCase() : 'jpg';
  }

  private detectExtension(buffer: ArrayBuffer, uri: string): string {
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
    return this.extensionOf(uri);
  }

  private contentTypeOf(ext: string): string {
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

  private async copyToCache(uri: string, dest: string): Promise<void> {
    const src = await fileIo.open(uri, fileIo.OpenMode.READ_ONLY);
    try {
      await fileIo.copyFile(src.fd, dest);
    } finally {
      await fileIo.close(src.fd);
    }
  }

  private sourceFileName(uri: string, index: number, ext: string): string {
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

  private async pickAndUpload(): Promise<void> {
    if (this.uploading) return;
    if (!this.paired || !this.token) {
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
        const uri = result.photoUris[index];
        const file = await fileIo.open(uri, fileIo.OpenMode.READ_ONLY);
        const stat = await fileIo.stat(file.fd);
        const head = new ArrayBuffer(16);
        await fileIo.read(file.fd, head);
        await fileIo.close(file.fd);
        const ext = this.detectExtension(head, uri);
        if (ext === 'gif' || ext === 'webp') {
          unsupported += 1;
          continue;
        }
        if (stat.size > 300 * 1024 * 1024) {
          skipped += 1;
          continue;
        }
        const cachePath = `${context.cacheDir}/tp-upload-${stamp}-${index}.${ext}`;
        await this.copyToCache(uri, cachePath);
        this.uploadBytes += stat.size;
        staged.push(cachePath);
        formData.push({
          name: 'files',
          contentType: this.contentTypeOf(ext),
          remoteFileName: this.sourceFileName(uri, index, ext),
          filePath: cachePath
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
      const request = http.createHttp();
      request.on('dataSendProgress', (info: http.DataSendProgressInfo) => {
        const current = Math.min(this.uploadBytes, info.sendSize);
        const percent = this.uploadBytes > 0 ? Math.min(99, Math.round(current * 100 / this.uploadBytes)) : 0;
        if (percent !== this.uploadProgress) {
          this.uploadProgress = percent;
        }
        this.trackSpeed(current);
      });
      try {
        const response = await request.request(`${this.baseUrl()}/api/upload?token=${this.token}`, {
          method: http.RequestMethod.POST,
          header: { 'Content-Type': 'multipart/form-data' },
          multiFormDataList: formData,
          connectTimeout: 10000,
          readTimeout: 300000
        });
        if (response.responseCode !== 200) {
          throw new Error(this.errorMessage(response));
        }
        const data = JSON.parse(response.result as string) as UploadResponse;
        if (data.count === 0) {
          throw new Error('电脑没有收到文件（0 个）');
        }
        const skippedNote = skipped > 0 ? `，${skipped} 个超过 300MB 已跳过` : '';
        const unsupportedNote = unsupported > 0 ? `，${unsupported} 个 GIF/WebP 无法修改图库日期已跳过` : '';
        this.uploadProgress = 100;
        this.uploadStage = '上传完成';
        this.status = `已上传 ${data.count} 个文件${skippedNote}${unsupportedNote}。去电脑上点“手机传入”并改日期，然后回来刷新结果。`;
      } finally {
        request.destroy();
      }
    } catch (error) {
      const e = error as BusinessError;
      const switched = await this.fallbackFromUsb();
      this.status = switched
        ? `USB 直连中断，已切回 Wi-Fi，请重试。原错误：${e.message || '未知错误'}`
        : `上传失败：${e.message || '未知错误'}`;
    } finally {
      for (const filePath of staged) {
        try {
          await fileIo.unlink(filePath);
        } catch {
          // Cache cleanup failure does not affect the upload result.
        }
      }
      this.uploading = false;
    }
  }

  private async refreshOutbox(): Promise<void> {
    if (this.refreshing) return;
    if (!this.paired || !this.token) {
      this.status = '请先完成电脑配对。';
      return;
    }
    this.refreshing = true;
    this.status = '正在读取电脑上的处理结果…';
    const request = http.createHttp();
    try {
      const response = await request.request(`${this.baseUrl()}/api/outbox?token=${this.token}`, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 30000
      });
      if (response.responseCode !== 200) {
        throw new Error(this.errorMessage(response));
      }
      const data = JSON.parse(response.result as string) as OutboxResponse;
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
      request.destroy();
      this.refreshing = false;
    }
  }

  private async removeDownloadedCache(): Promise<void> {
    for (const item of this.downloaded) {
      try {
        await fileIo.unlink(item.filePath);
      } catch {
        // Cache file may already be gone.
      }
    }
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
    if (!this.paired || !this.token) {
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
        const url = `${this.baseUrl()}/api/outbox/file?run=${encodeURIComponent(this.outboxRun)}&path=${encodeURIComponent(item.relativePath)}&token=${this.token}`;
        const request = http.createHttp();
        const file = await fileIo.open(currentCachePath, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
        let writeFailed = false;
        let writeErrorMessage = '';
        request.on('dataReceive', (chunk: ArrayBuffer) => {
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
        let responseCode = 0;
        try {
          responseCode = await request.requestInStream(url, {
            method: http.RequestMethod.GET,
            connectTimeout: 10000,
            readTimeout: 600000
          });
        } finally {
          request.destroy();
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
    const helper = photoAccessHelper.getPhotoAccessHelper(context);
    let ok = 0;
    const failed: DownloadedFile[] = [];
    for (const item of this.downloaded) {
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
        } catch {
          // Cache cleanup failure does not affect the saved asset.
        }
        ok += 1;
      } catch (err) {
        failed.push(item);
      }
    }
    this.downloaded = failed;
    this.downloadedCount = failed.length;
    this.saving = false;
    this.status = failed.length === 0
      ? `已全部保存 ${ok} 个到图库。请到系统图库检查日期。`
      : `已保存 ${ok} 个，失败 ${failed.length} 个；请再点一次系统保存重试。`;
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

        Column({ space: 8 }) {
          Row({ space: 8 }) {
            if (this.isBusy()) {
              LoadingProgress()
                .width(18)
                .height(18)
                .color('#2F6FED')
            }
            Text(this.status)
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor('#162033')
              .layoutWeight(1)
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)

          if (this.uploading) {
            Column({ space: 4 }) {
              Progress({ value: this.uploadProgress, total: 100, type: ProgressType.Linear })
                .width('100%')
                .color('#2F6FED')
              Row() {
                Text(this.uploadStage)
                  .fontSize(11)
                  .fontColor('#667085')
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(`${this.uploadProgress}%${this.speedText ? ' · ' + this.speedText : ''}`)
                  .fontSize(11)
                  .fontColor('#667085')
              }
              .width('100%')
            }
            .width('100%')
          }

          if (this.downloading) {
            Column({ space: 4 }) {
              Progress({ value: this.downloadProgress, total: 100, type: ProgressType.Linear })
                .width('100%')
                .color('#0F8A5F')
              Row() {
                Text(this.downloadStage)
                  .fontSize(11)
                  .fontColor('#667085')
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(`${this.downloadProgress}%${this.speedText ? ' · ' + this.speedText : ''}`)
                  .fontSize(11)
                  .fontColor('#667085')
              }
              .width('100%')
            }
            .width('100%')
          }
        }
        .width('100%')
        .padding(14)
        .backgroundColor('#FFFFFF')
        .borderRadius(14)
        .border({ width: 1, color: '#E4E9F2' })
        .alignItems(HorizontalAlign.Start)

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

          Column({ space: 10 }) {
            Row({ space: 8 }) {
              Text('1')
                .width(24)
                .height(24)
                .textAlign(TextAlign.Center)
                .fontSize(13)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
                .backgroundColor('#2F6FED')
                .borderRadius(12)
              Text('上传照片或视频')
                .fontSize(17)
                .fontWeight(FontWeight.Medium)
                .fontColor('#162033')
            }
            .width('100%')
            Text('选择 1-50 个文件上传到电脑，然后到电脑网页点“手机传入”并设置目标日期。单个文件上限 300MB。')
              .fontSize(12)
              .fontColor('#667085')
            Button(this.uploading ? `上传中 ${this.uploadProgress}%` : '选择照片/视频并上传')
              .onClick(() => {
                this.pickAndUpload();
              })
              .enabled(!this.uploading)
              .width('100%')
          }
          .width('100%')
          .padding(16)
          .backgroundColor('#FFFFFF')
          .borderRadius(14)
          .alignItems(HorizontalAlign.Start)

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
