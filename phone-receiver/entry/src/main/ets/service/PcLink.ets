import { http, socket } from '@kit.NetworkKit';
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import {
  DISCOVERY_PORT,
  DiscoveryReply,
  OutboxResponse,
  PairConfirmResponse,
  PairRequestResponse,
  PcDevice,
  PC_PORT,
  UploadResponse
} from '../model/Types';

interface UdpMessage {
  message: ArrayBuffer;
  remoteInfo: socket.SocketRemoteInfo;
}

export function httpErrorMessage(response: http.HttpResponse): string {
  try {
    const body = JSON.parse(response.result as string) as ErrorResponseLike;
    if (body.error) {
      return body.error;
    }
  } catch (error) {
    // Response body is not JSON.
  }
  return `HTTP ${response.responseCode}`;
}

interface ErrorResponseLike {
  error?: string;
}

export class PcLink {
  host: string = '';
  port: number = PC_PORT;
  token: string = '';
  deviceId: string = '';
  wifiHost: string = '';
  private deviceName: string = 'HarmonyOS 手机';
  private prefs: preferences.Preferences | null = null;

  async init(context: common.Context): Promise<void> {
    this.prefs = await preferences.getPreferences(context, 'timepostman');
    this.host = String(this.prefs.getSync('pcHost', '') ?? '');
    this.port = Number(this.prefs.getSync('pcPort', PC_PORT) ?? PC_PORT);
    this.wifiHost = String(this.prefs.getSync('wifiHost', '') ?? '');
    if (!this.wifiHost && this.host && this.host !== '127.0.0.1') {
      this.wifiHost = this.host;
    }
    this.token = String(this.prefs.getSync('token', '') ?? '');
    this.deviceId = String(this.prefs.getSync('deviceId', '') ?? '');
    if (!this.deviceId) {
      this.deviceId = `tp-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      this.prefs.putSync('deviceId', this.deviceId);
      await this.prefs.flush();
    }
  }

  isPaired(): boolean {
    return Boolean(this.host && this.token);
  }

  isUsbHost(): boolean {
    return this.host === '127.0.0.1';
  }

  baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  async savePrefs(): Promise<void> {
    if (!this.prefs) return;
    this.prefs.putSync('pcHost', this.host);
    this.prefs.putSync('pcPort', this.port);
    this.prefs.putSync('wifiHost', this.wifiHost);
    this.prefs.putSync('token', this.token);
    await this.prefs.flush();
  }

  async reset(): Promise<void> {
    this.host = '';
    this.port = PC_PORT;
    this.token = '';
    this.wifiHost = '';
    if (this.prefs) {
      this.prefs.putSync('pcHost', '');
      this.prefs.putSync('wifiHost', '');
      this.prefs.putSync('token', '');
      await this.prefs.flush();
    }
  }

  async checkHost(host: string): Promise<boolean> {
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

  async toggleUsb(): Promise<boolean> {
    if (this.isUsbHost()) {
      if (!this.wifiHost) {
        throw new Error('没有保存 Wi-Fi 地址，请重新配对并输入电脑 IP。');
      }
      this.host = this.wifiHost;
      this.port = PC_PORT;
      await this.savePrefs();
      return false;
    }
    if (!(await this.checkHost('127.0.0.1'))) {
      throw new Error('USB 直连不可用：先在电脑运行 hdc rport tcp:8787 tcp:8787。');
    }
    this.wifiHost = this.host;
    this.host = '127.0.0.1';
    this.port = PC_PORT;
    await this.savePrefs();
    return true;
  }

  async fallbackFromUsb(): Promise<boolean> {
    if (!this.isUsbHost() || !this.wifiHost) {
      return false;
    }
    this.host = this.wifiHost;
    this.port = PC_PORT;
    await this.savePrefs();
    return true;
  }

  async discover(): Promise<PcDevice[]> {
    const discovered: PcDevice[] = [];
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
          const exists = discovered.some((item: PcDevice) => item.host === host && item.port === reply.port);
          if (!exists) {
            discovered.push({
              name: reply.name || 'TimePostman 电脑',
              host,
              port: reply.port
            });
          }
        } catch (error) {
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
    } finally {
      if (udp) {
        try {
          udp.off('message');
          await udp.close();
        } catch (error) {
          // Socket may already be closed.
        }
      }
    }
    return discovered;
  }

  async requestPairing(host: string, port: number): Promise<PairRequestResponse> {
    const request = http.createHttp();
    try {
      const response = await request.request(`http://${host}:${port}/pair/request`, {
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
        throw new Error(httpErrorMessage(response));
      }
      const data = JSON.parse(response.result as string) as PairRequestResponse;
      if (!data.requestId) {
        throw new Error('电脑没有返回配对请求');
      }
      return data;
    } finally {
      request.destroy();
    }
  }

  async confirmPairing(host: string, port: number, requestId: string, code: string): Promise<PairConfirmResponse> {
    const request = http.createHttp();
    try {
      const response = await request.request(`http://${host}:${port}/pair/confirm`, {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json' },
        extraData: JSON.stringify({ requestId, code }),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 15000
      });
      if (response.responseCode !== 200) {
        throw new Error(httpErrorMessage(response));
      }
      const data = JSON.parse(response.result as string) as PairConfirmResponse;
      if (!data.token) {
        throw new Error('配对失败，没有拿到令牌');
      }
      this.token = data.token;
      this.host = host;
      this.port = data.port || port;
      if (this.host !== '127.0.0.1') {
        this.wifiHost = this.host;
      }
      await this.savePrefs();
      return data;
    } finally {
      request.destroy();
    }
  }

  async upload(
    formData: http.MultiFormData[],
    totalBytes: number,
    onProgress: (sentBytes: number) => void
  ): Promise<UploadResponse> {
    const request = http.createHttp();
    request.on('dataSendProgress', (info: http.DataSendProgressInfo) => {
      onProgress(Math.min(totalBytes, info.sendSize));
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
        throw new Error(httpErrorMessage(response));
      }
      const data = JSON.parse(response.result as string) as UploadResponse;
      if (data.count === 0) {
        throw new Error('电脑没有收到文件（0 个）');
      }
      return data;
    } finally {
      request.destroy();
    }
  }

  async fetchOutbox(): Promise<OutboxResponse> {
    const request = http.createHttp();
    try {
      const response = await request.request(`${this.baseUrl()}/api/outbox?token=${this.token}`, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 30000
      });
      if (response.responseCode !== 200) {
        throw new Error(httpErrorMessage(response));
      }
      return JSON.parse(response.result as string) as OutboxResponse;
    } finally {
      request.destroy();
    }
  }

  async download(url: string, onChunk: (chunk: ArrayBuffer) => void): Promise<number> {
    const request = http.createHttp();
    request.on('dataReceive', (chunk: ArrayBuffer) => {
      onChunk(chunk);
    });
    try {
      return await request.requestInStream(url, {
        method: http.RequestMethod.GET,
        connectTimeout: 10000,
        readTimeout: 600000
      });
    } finally {
      request.destroy();
    }
  }
}
