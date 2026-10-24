export const PC_PORT: number = 8787;
export const DISCOVERY_PORT: number = 8786;
export const MAX_UPLOAD_BYTES: number = 300 * 1024 * 1024;

export interface UploadedFile {
  name: string;
  size: number;
}

export interface UploadResponse {
  count: number;
  files: UploadedFile[];
}

export interface OutboxFile {
  name: string;
  relativePath: string;
  kind: string;
  ext: string;
  date: string;
  size: number;
}

export interface OutboxResponse {
  run: string;
  files: OutboxFile[];
}

export interface ErrorResponse {
  error?: string;
}

export interface PcDevice {
  name: string;
  host: string;
  port: number;
}

export interface DiscoveryReply {
  service: string;
  name: string;
  port: number;
}

export interface PairRequestResponse {
  requestId: string;
  expiresAt: number;
}

export interface PairConfirmResponse {
  token: string;
  port: number;
  name: string;
}

export interface StagedFile {
  path: string;
  name: string;
  ext: string;
  size: number;
  contentType: string;
}

export class DownloadedFile {
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
