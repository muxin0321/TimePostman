import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exiftool } from "exiftool-vendored";
import { kindOf, listMedia, readMediaInfo } from "../app/lib/media-dates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8787;
const UDP_PORT = 8786;
const INBOX_DIR = path.join(ROOT, "phone-inbox");
const LAST_UPLOAD_FILE = path.join(INBOX_DIR, ".last-upload");
const LAST_BATCH_FILE = path.join(INBOX_DIR, ".last-batch.json");
const INCOMING_ROOT = path.join(INBOX_DIR, ".incoming");
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const EXPORTS_DIR = path.join(ROOT, "exports");
const PAIRED_FILE = path.join(ROOT, "phone-transfer", "paired-devices.json");

// 配对令牌在长时间不使用后自动失效，避免一个泄露的令牌永久有效。
const PAIR_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// lastSeenAt 只用来判断是否过期，不必每次请求都写盘。
const TOKEN_TOUCH_PERSIST_MS = 60 * 60 * 1000;

function loadPairedDevices() {
  try {
    return JSON.parse(fs.readFileSync(PAIRED_FILE, "utf8"));
  } catch {
    return {};
  }
}

function isValidDeviceEntry(device) {
  return Boolean(device && typeof device.token === "string" && device.token);
}

// 兼容旧版 paired-devices.json：早期条目没有 lastSeenAt，用配对时间兜底。
function normalizePairedDevices(raw) {
  const fallback = new Date().toISOString();
  const result = {};
  for (const [deviceId, device] of Object.entries(raw ?? {})) {
    if (!isValidDeviceEntry(device)) continue;
    result[deviceId] = {
      ...device,
      pairedAt: device.pairedAt || fallback,
      lastSeenAt: device.lastSeenAt || device.pairedAt || fallback,
    };
  }
  return result;
}

const pairedDevices = normalizePairedDevices(loadPairedDevices());
const tokenIndex = new Map();
const pairRequests = new Map();
const pairRequestBuckets = new Map();

function rebuildTokenIndex() {
  tokenIndex.clear();
  for (const [deviceId, device] of Object.entries(pairedDevices)) {
    if (isValidDeviceEntry(device)) tokenIndex.set(device.token, deviceId);
  }
}

function savePairedDevices() {
  fs.mkdirSync(path.dirname(PAIRED_FILE), { recursive: true });
  fs.writeFileSync(PAIRED_FILE, JSON.stringify(pairedDevices, null, 2), "utf8");
}

let lastTouchPersist = 0;

function rememberSeen(deviceId) {
  const device = pairedDevices[deviceId];
  if (!device) return;
  device.lastSeenAt = new Date().toISOString();
  const now = Date.now();
  if (now - lastTouchPersist < TOKEN_TOUCH_PERSIST_MS) return;
  lastTouchPersist = now;
  try {
    savePairedDevices();
  } catch (error) {
    console.error("保存配对设备失败：", error);
  }
}

function revokeDevice(deviceId) {
  const device = pairedDevices[deviceId];
  if (!device) return false;
  if (device.token) tokenIndex.delete(device.token);
  delete pairedDevices[deviceId];
  savePairedDevices();
  return true;
}

function isDeviceExpired(device, now = Date.now()) {
  const seen = Date.parse(device?.lastSeenAt || device?.pairedAt || "");
  // 时间戳缺失或解析不出来时不当成过期，避免误杀正常设备。
  if (!Number.isFinite(seen)) return false;
  return now - seen > PAIR_TOKEN_TTL_MS;
}

rebuildTokenIndex();

function cleanPairRequests() {
  const now = Date.now();
  for (const [requestId, request] of pairRequests) {
    if (request.expiresAt < now) pairRequests.delete(requestId);
  }
}

function isLocalRequest(req) {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function hostWithoutPort(hostHeader) {
  const raw = String(hostHeader || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end === -1 ? raw : raw.slice(1, end);
  }
  const firstColon = raw.indexOf(":");
  const lastColon = raw.lastIndexOf(":");
  if (firstColon > -1 && firstColon === lastColon) return raw.slice(0, lastColon);
  return raw;
}

const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
];

// 只接受 IP 字面量或本机名作为 Host。
// 这样恶意域名解析到局域网地址（DNS rebinding）时，浏览器带来的 Host 仍是那个域名，会被直接拒掉。
function isTrustedHost(hostHeader) {
  const host = hostWithoutPort(hostHeader);
  if (!host) return false;
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return true;
  const machine = os.hostname().toLowerCase();
  if (host === machine || host === `${machine}.local`) return true;
  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host));
}

function allowPairRequest(ip) {
  const now = Date.now();
  const bucket = pairRequestBuckets.get(ip);
  if (!bucket || now - bucket.start > 60_000) {
    pairRequestBuckets.set(ip, { start: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 10;
}

const app = express();
app.use(express.json());

// 在所有路由之前拦一道：Host 不可信就直接拒绝，避免恶意网页通过 DNS rebinding 读到令牌或触发操作。
app.use((req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!isTrustedHost(req.get("host"))) {
    res.status(403).json({
      error: "Host 未被信任：这个服务只接受局域网 IP 或 localhost 访问，请用电脑的 IP 地址直接连接。",
    });
    return;
  }
  next();
});

function sanitizeBaseName(source) {
  const base = String(source || "photo")
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  return base || "photo";
}

function decodeUploadFileName(name) {
  const source = String(name || "");
  if (!/[\u0080-\u00FF]/.test(source)) return source;
  const decoded = Buffer.from(source, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? source : decoded;
}

function uniqueStagedName(dir, originalName, reserved) {
  const source = decodeUploadFileName(originalName) || "phone";
  const originalExt = path.extname(source);
  const ext = (originalExt || ".jpg").toLowerCase();
  let base = sanitizeBaseName(path.basename(source, originalExt));
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) {
    base = `photo-${base}`;
  }
  let candidate = `${base}${ext}`;
  let suffix = 2;
  while (fs.existsSync(path.join(dir, candidate)) || reserved.has(candidate)) {
    candidate = `${base}-${suffix}${ext}`;
    suffix += 1;
  }
  reserved.add(candidate);
  return candidate;
}

function incomingDir(req) {
  if (!req.uploadTempDir) {
    req.uploadTempDir = path.join(INCOMING_ROOT, crypto.randomBytes(8).toString("hex"));
    fs.mkdirSync(req.uploadTempDir, { recursive: true });
  }
  if (!req.stagedNames) {
    req.stagedNames = new Set();
  }
  return req.uploadTempDir;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      cb(null, incomingDir(req));
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    try {
      const dir = incomingDir(req);
      cb(null, uniqueStagedName(dir, file.originalname, req.stagedNames));
    } catch (error) {
      cb(error);
    }
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 50 },
});

app.post("/pair/request", (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allowPairRequest(ip)) {
    res.status(429).json({ error: "配对请求太频繁，请稍后再试" });
    return;
  }
  const deviceId = String(req.body?.deviceId || "").slice(0, 120);
  const deviceName = String(req.body?.deviceName || "HarmonyOS 手机").slice(0, 80);
  if (!deviceId) {
    res.status(400).json({ error: "缺少设备 ID" });
    return;
  }
  cleanPairRequests();
  for (const [requestId, request] of pairRequests) {
    if (request.deviceId === deviceId) pairRequests.delete(requestId);
  }
  const requestId = crypto.randomBytes(8).toString("hex");
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = Date.now() + 2 * 60 * 1000;
  pairRequests.set(requestId, {
    requestId,
    deviceId,
    deviceName,
    code,
    expiresAt,
    attempts: 0,
  });
  console.log(`配对请求：${deviceName}（配对码 ${code}）`);
  res.json({ requestId, expiresAt });
});

app.get("/pair/pending", (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "只允许本机访问" });
    return;
  }
  cleanPairRequests();
  res.json({
    requests: [...pairRequests.values()].map((request) => ({
      requestId: request.requestId,
      deviceName: request.deviceName,
      code: request.code,
      expiresAt: request.expiresAt,
    })),
  });
});

app.post("/pair/deny", (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "只允许本机访问" });
    return;
  }
  const requestId = String(req.body?.requestId || "");
  pairRequests.delete(requestId);
  res.json({ ok: true });
});

app.post("/pair/confirm", (req, res) => {
  cleanPairRequests();
  const requestId = String(req.body?.requestId || "");
  const code = String(req.body?.code || "");
  const request = pairRequests.get(requestId);
  if (!request) {
    res.status(400).json({ error: "配对请求不存在或已过期" });
    return;
  }
  request.attempts += 1;
  if (request.attempts > 6) {
    pairRequests.delete(requestId);
    res.status(429).json({ error: "配对码尝试次数过多，请重新申请" });
    return;
  }
  if (code !== request.code) {
    res.status(400).json({ error: "配对码不正确" });
    return;
  }
  const token = crypto.randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  // 同一台设备重新配对时，旧令牌必须一起作废，否则旧手机仍然能继续上传。
  const previous = pairedDevices[request.deviceId];
  if (previous?.token) tokenIndex.delete(previous.token);
  pairedDevices[request.deviceId] = {
    name: request.deviceName,
    token,
    pairedAt: now,
    lastSeenAt: now,
  };
  tokenIndex.set(token, request.deviceId);
  savePairedDevices();
  pairRequests.delete(requestId);
  console.log(`配对成功：${request.deviceName}`);
  res.json({ token, port: PORT, name: os.hostname() });
});

// 已配对设备列表与撤销：只允许本机调用，能列出所有持有令牌的设备。
app.get("/pair/devices", (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "只允许本机访问" });
    return;
  }
  res.json({
    ttlDays: Math.round(PAIR_TOKEN_TTL_MS / 86_400_000),
    devices: Object.entries(pairedDevices).map(([deviceId, device]) => ({
      deviceId,
      name: device.name || deviceId,
      pairedAt: device.pairedAt || "",
      lastSeenAt: device.lastSeenAt || "",
      expired: isDeviceExpired(device),
    })),
  });
});

app.post("/pair/revoke", (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "只允许本机访问" });
    return;
  }
  const requestedId = String(req.body?.deviceId || "");
  const requestedToken = String(req.body?.token || "");
  const target = requestedId || (requestedToken ? tokenIndex.get(requestedToken) : "") || "";
  if (!target || !pairedDevices[target]) {
    res.status(404).json({ error: "设备不存在" });
    return;
  }
  const name = pairedDevices[target].name || target;
  revokeDevice(target);
  console.log(`已解除配对：${name}`);
  res.json({ ok: true });
});

app.use("/api", (req, res, next) => {
  // 优先读请求头；查询参数保留兼容性，手机端暂时还在用。
  const token = req.get("x-timepostman-token") || req.query.token;
  const deviceId = token ? tokenIndex.get(String(token)) : undefined;
  if (!deviceId) {
    res.status(403).json({ error: "令牌无效，请重新配对" });
    return;
  }
  const device = pairedDevices[deviceId];
  if (!device || isDeviceExpired(device)) {
    revokeDevice(deviceId);
    console.log(`配对已过期并移除：${deviceId}`);
    res.status(403).json({ error: "配对已过期，请重新配对" });
    return;
  }
  rememberSeen(deviceId);
  req.pairedDeviceId = deviceId;
  res.setHeader("Cache-Control", "no-store");
  next();
});

// 手机端可以在“重新配对”时主动通知电脑作废自己的令牌，不用等它过期。
app.post("/api/unpair", (req, res) => {
  const deviceId = req.pairedDeviceId;
  revokeDevice(deviceId);
  console.log(`手机已主动解除配对：${deviceId}`);
  res.json({ ok: true });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "timepostman-transfer" });
});

app.post("/api/upload", upload.array("files", 50), (req, res) => {
  const staged = req.files || [];
  const tempDir = req.uploadTempDir || "";
  const files = staged.map((file) => ({
    name: file.filename,
    size: file.size,
  }));
  if (files.length === 0) {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    res.status(400).json({ error: "没有收到文件" });
    return;
  }
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  const trashDir = path.join(INCOMING_ROOT, `trash-${crypto.randomBytes(6).toString("hex")}`);
  const movedOld = [];
  const movedNew = [];
  let removed = 0;
  try {
    fs.mkdirSync(trashDir, { recursive: true });
    for (const entry of fs.readdirSync(INBOX_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      fs.renameSync(path.join(INBOX_DIR, entry.name), path.join(trashDir, entry.name));
      movedOld.push(entry.name);
    }
    for (const file of staged) {
      fs.renameSync(path.join(tempDir, file.filename), path.join(INBOX_DIR, file.filename));
      movedNew.push(file.filename);
    }
    const uploadedAt = Date.now();
    fs.writeFileSync(LAST_UPLOAD_FILE, String(uploadedAt), "utf8");
    fs.writeFileSync(
      LAST_BATCH_FILE,
      JSON.stringify({ uploadedAt, files: files.map((file) => file.name) }),
      "utf8",
    );
    fs.rmSync(trashDir, { recursive: true, force: true });
    removed = movedOld.length;
    console.log(`收到手机上传：${files.length} 个文件，替换旧文件 ${removed} 个`);
    res.json({ count: files.length, cleared: removed, files });
  } catch (error) {
    for (const name of movedNew) {
      try {
        fs.rmSync(path.join(INBOX_DIR, name), { force: true });
      } catch {
        // Rollback best-effort.
      }
    }
    for (const name of movedOld) {
      try {
        fs.renameSync(path.join(trashDir, name), path.join(INBOX_DIR, name));
      } catch {
        // Rollback best-effort.
      }
    }
    fs.rmSync(trashDir, { recursive: true, force: true });
    console.error("上传落盘失败：", error);
    res.status(400).json({ error: error.message || "上传保存失败" });
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function readLastUploadAt() {
  try {
    const value = Number(fs.readFileSync(LAST_UPLOAD_FILE, "utf8"));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function latestOutputRun() {
  if (!fs.existsSync(EXPORTS_DIR)) return null;
  const runs = fs.readdirSync(EXPORTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("TimePostman-"))
    .map((entry) => path.join(EXPORTS_DIR, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return runs[0] ?? null;
}

app.get("/api/outbox", async (req, res, next) => {
  try {
    const runDir = latestOutputRun();
    const lastUploadAt = readLastUploadAt();
    if (!runDir || (lastUploadAt > 0 && fs.statSync(runDir).mtimeMs < lastUploadAt)) {
      res.json({ run: "", files: [] });
      return;
    }
    const files = listMedia(runDir).slice(0, 50);
    const items = [];
    for (const file of files) {
      const info = await readMediaInfo(file);
      items.push({
        name: path.basename(file),
        relativePath: path.relative(runDir, file).split(path.sep).join("/"),
        kind: kindOf(file),
        ext: path.extname(file).slice(1).toLowerCase(),
        date: info.currentDisplay,
        size: fs.statSync(file).size,
      });
    }
    res.json({ run: path.basename(runDir), files: items });
  } catch (error) {
    next(error);
  }
});

app.get("/api/outbox/file", (req, res) => {
  const run = typeof req.query.run === "string" ? req.query.run : "";
  const relative = typeof req.query.path === "string" ? req.query.path : "";
  if (!run || path.basename(run) !== run || !run.startsWith("TimePostman-")) {
    res.status(400).end("Invalid run");
    return;
  }
  const runDir = path.join(EXPORTS_DIR, run);
  const filePath = path.resolve(runDir, relative);
  const relativeToRun = path.relative(runDir, filePath);
  if (relativeToRun.startsWith("..") || path.isAbsolute(relativeToRun)) {
    res.status(400).end("Invalid path");
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || !kindOf(filePath)) {
    res.status(404).end("Not found");
    return;
  }
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
  };
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
});

app.use((error, req, res, next) => {
  if (req.uploadTempDir) {
    try {
      fs.rmSync(req.uploadTempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup failures.
    }
  }
  if (res.headersSent) {
    next(error);
    return;
  }
  console.error(error);
  res.status(400).json({ error: error.message || String(error) });
});

function printAddresses() {
  console.log("");
  console.log("手机和电脑需要在同一局域网，或使用 USB 反向端口：");
  console.log("  hdc rport tcp:8787 tcp:8787");
  console.log("  此时手机 App 里填 127.0.0.1。");
  console.log("");
  console.log("Wi-Fi 方式：手机 App 填下面 Wi-Fi / 以太网那一项的 IPv4：");
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        console.log(`  ${name}: ${info.address}`);
      }
    }
  }
  console.log("");
  console.log("如果 Windows 弹出防火墙提示，请允许“专用网络”访问。");
}

async function main() {
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  fs.rmSync(INCOMING_ROOT, { recursive: true, force: true });
  fs.mkdirSync(INCOMING_ROOT, { recursive: true });

  const discoverySocket = dgram.createSocket("udp4");
  discoverySocket.on("message", (message, rinfo) => {
    if (message.toString("utf8") !== "TIMEPOSTMAN_DISCOVER") return;
    const reply = JSON.stringify({
      service: "timepostman",
      name: os.hostname(),
      port: PORT,
    });
    discoverySocket.send(reply, rinfo.port, rinfo.address);
  });
  discoverySocket.on("error", (error) => {
    console.error("发现服务错误：", error);
  });
  discoverySocket.bind(UDP_PORT, "0.0.0.0", () => {
    console.log(`手机自动发现服务已启动：UDP ${UDP_PORT}`);
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`TimePostman 手机互传服务已启动：http://0.0.0.0:${PORT}`);
    console.log(`上传目录：${INBOX_DIR}`);
    console.log(`结果目录：${EXPORTS_DIR}`);
    printAddresses();
    console.log("手机 App 操作：上传照片 → 电脑上点“手机传入”并处理 → 手机刷新结果并保存。");
    console.log("按 Ctrl+C 停止服务。");
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`端口 ${PORT} 已被占用，请先关掉占用它的程序。`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });

  const shutdown = async () => {
    server.close();
    try {
      discoverySocket.close();
    } catch {
      // Discovery socket may already be closed.
    }
    try {
      await exiftool.end();
    } catch {
      // ExifTool may already be closed.
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await exiftool.end();
  } catch {
    // Ignore shutdown errors.
  }
  process.exitCode = 1;
});
