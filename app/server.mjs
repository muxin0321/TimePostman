import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { exiftool } from "exiftool-vendored";
import { detectMediaExtension, kindOf, listMedia, readMediaInfo, writeMediaFile } from "./lib/media-dates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "app", "public");
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, "exports");
const PHONE_INBOX = path.join(ROOT, "phone-inbox");
const PHONE_BATCH_FILE = path.join(PHONE_INBOX, ".last-batch.json");
const TRANSFER_PORT = Number(process.env.TRANSFER_PORT) || 8787;
const PORT = Number(process.env.PORT) || 4317;
const TOKEN = crypto.randomBytes(24).toString("hex");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const jobs = new Map();
fs.mkdirSync(PHONE_INBOX, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self';",
  );
  next();
});
// 这个服务只监听 127.0.0.1，正常情况下页面都是从 127.0.0.1 或 localhost 打开的。
// 校验 Host 是为了挡掉 DNS rebinding：恶意页面把域名解析到 127.0.0.1 时，浏览器带来的 Host 仍是那个域名。
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

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

app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(hostWithoutPort(req.get("host")))) {
    res.status(403).type("text/plain").send("Host 未被信任：请用 http://127.0.0.1 或 http://localhost 打开这个页面。");
    return;
  }
  next();
});

app.use(express.static(PUBLIC_DIR));

app.use("/api", (req, res, next) => {
  if (req.path === "/config") return next();
  if (req.get("x-timepostman-token") !== TOKEN) {
    return res.status(403).json({ error: "会话令牌无效，请刷新页面。" });
  }
  next();
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireSourceDir(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("源文件夹不能为空。");
  }
  const resolved = path.resolve(value.trim());
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`源文件夹不存在：${resolved}`);
  }
  if (!stat.isDirectory()) throw new Error(`源路径不是文件夹：${resolved}`);
  return resolved;
}

function requireOutputRoot(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("输出文件夹不能为空。");
  }
  return path.resolve(value.trim());
}

function safeJoin(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("文件路径超出允许范围。");
  }
  return absolute;
}

function normalizeOutputPath(relativePath, sourceFile) {
  const actualExt = detectMediaExtension(sourceFile);
  if (!actualExt) return relativePath;
  const currentExt = path.extname(relativePath).toLowerCase();
  if (!currentExt) return `${relativePath}${actualExt}`;
  if (currentExt === actualExt) return relativePath;
  if ((actualExt === ".jpg" && currentExt === ".jpeg") || (actualExt === ".heic" && currentExt === ".heif")) {
    return relativePath;
  }
  return `${relativePath.slice(0, -currentExt.length)}${actualExt}`;
}

function datedOutputPath(relativePath) {
  const dir = path.dirname(relativePath);
  const ext = path.extname(relativePath);
  const base = path.basename(relativePath, ext);
  const suffix = /_TimePostman$/i.test(base) ? "_TimePostman2" : "_TimePostman";
  const name = `${base}${suffix}${ext}`;
  return dir === "." ? name : `${dir}/${name}`.split(path.sep).join("/");
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(runners);
  return results;
}

function makeRunDir(outputRoot) {
  fs.mkdirSync(outputRoot, { recursive: true });
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  let candidate = path.join(outputRoot, `TimePostman-${stamp}`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputRoot, `TimePostman-${stamp}-${suffix}`);
    suffix += 1;
  }
  fs.mkdirSync(candidate, { recursive: true });
  return candidate;
}

function listOutputRuns(outputRoot) {
  if (!fs.existsSync(outputRoot)) return [];
  return fs.readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("TimePostman-"))
    .map((entry) => {
      const dir = path.join(outputRoot, entry.name);
      return { name: entry.name, dir, mtime: fs.statSync(dir).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function readPhoneBatch() {
  try {
    const data = JSON.parse(fs.readFileSync(PHONE_BATCH_FILE, "utf8"));
    if (!Array.isArray(data?.files) || data.files.length === 0) return null;
    return { uploadedAt: Number(data.uploadedAt) || 0, files: data.files.map(String) };
  } catch {
    return null;
  }
}

app.get("/api/config", (req, res) => {
  res.json({
    token: TOKEN,
    version: PACKAGE.version,
    platform: process.platform,
    defaultOutputRoot: DEFAULT_OUTPUT_ROOT,
    phoneInbox: PHONE_INBOX,
    timezone: "UTC+8",
  });
});

app.post("/api/phone-inbox/clear", asyncRoute(async (req, res) => {
  fs.rmSync(PHONE_INBOX, { recursive: true, force: true });
  fs.mkdirSync(PHONE_INBOX, { recursive: true });
  res.json({ ok: true });
}));

app.get("/api/phone-pair/pending", asyncRoute(async (req, res) => {
  const response = await fetch(`http://127.0.0.1:${TRANSFER_PORT}/pair/pending`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `互传服务返回 ${response.status}`);
  res.json(data);
}));

app.post("/api/phone-pair/deny", asyncRoute(async (req, res) => {
  const response = await fetch(`http://127.0.0.1:${TRANSFER_PORT}/pair/deny`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `互传服务返回 ${response.status}`);
  res.json(data);
}));

app.post("/api/outputs/summary", asyncRoute(async (req, res) => {
  const outputRoot = requireOutputRoot(req.body?.outputRoot);
  const runs = listOutputRuns(outputRoot);
  const totalBytes = runs.reduce((sum, run) => sum + directorySize(run.dir), 0);
  res.json({
    outputRoot,
    runs: runs.length,
    totalBytes,
    latest: runs[0]?.name ?? "",
  });
}));

app.post("/api/outputs/cleanup", asyncRoute(async (req, res) => {
  const outputRoot = requireOutputRoot(req.body?.outputRoot);
  const keepLatest = Math.max(1, Math.min(50, Number(req.body?.keepLatest) || 3));
  const runs = listOutputRuns(outputRoot);
  const active = new Set(
    [...jobs.values()]
      .map((job) => job.outputDir)
      .filter(Boolean)
      .map((dir) => path.resolve(dir)),
  );
  let removed = 0;
  let freedBytes = 0;
  for (const run of runs.slice(keepLatest)) {
    if (active.has(path.resolve(run.dir))) continue;
    freedBytes += directorySize(run.dir);
    fs.rmSync(run.dir, { recursive: true, force: true });
    removed += 1;
  }
  res.json({ removed, freedBytes, runs: runs.length - removed, keepLatest });
}));

app.post("/api/scan", asyncRoute(async (req, res) => {
  const sourceDir = requireSourceDir(req.body?.sourceDir);
  const outputRoot = requireOutputRoot(req.body?.outputRoot);
  let files = listMedia(sourceDir, { excludeDirs: [outputRoot] });
  let phoneBatch = null;
  let phoneBatchMissing = false;
  let unsupportedFiles = [];
  if (path.resolve(sourceDir) === PHONE_INBOX) {
    phoneBatch = readPhoneBatch();
    if (phoneBatch) {
      const latest = new Set(phoneBatch.files);
      files = files.filter((file) => latest.has(path.basename(file)));
      unsupportedFiles = phoneBatch.files
        .filter((name) => !kindOf(name))
        .map((name) => ({ name, ext: path.extname(name).slice(1).toLowerCase() }));
    } else {
      files = [];
      phoneBatchMissing = true;
    }
  }
  const infos = await mapLimit(files, 4, async (file) => {
    const relativePath = path.relative(sourceDir, file).split(path.sep).join("/");
    const info = await readMediaInfo(file).catch((error) => ({
      kind: kindOf(file),
      size: 0,
      currentLocal: "",
      currentDisplay: "读取失败",
      currentSource: "error",
      currentSourceKey: "",
      error: error.message || String(error),
    }));
    return {
      id: relativePath,
      name: path.basename(file),
      relativePath,
      ...info,
    };
  });
  infos.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"));
  res.json({
    sourceDir,
    outputRoot,
    files: infos,
    count: infos.length,
    phoneBatch: phoneBatch ? { uploadedAt: phoneBatch.uploadedAt, count: phoneBatch.files.length } : null,
    phoneBatchMissing,
    unsupportedFiles,
  });
}));

async function processJob(job, sourceDir, outputRoot, items) {
  const outputDir = makeRunDir(outputRoot);
  job.outputDir = outputDir;
  const realSourceRoot = fs.realpathSync(sourceDir);

  for (const item of items) {
    job.current = typeof item?.relativePath === "string" ? item.relativePath : "";
    try {
      if (typeof item?.relativePath !== "string" || item.relativePath.trim() === "" || item.relativePath.includes("\0")) {
        throw new Error("文件路径不合法。");
      }
      const sourceFile = safeJoin(sourceDir, item.relativePath);
      if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
        throw new Error("源文件不存在。");
      }
      const realSource = fs.realpathSync(sourceFile);
      const relativeToRoot = path.relative(realSourceRoot, realSource);
      if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        throw new Error("源文件路径超出源文件夹范围。");
      }
      if (!kindOf(sourceFile)) throw new Error("不支持的文件格式。");

      const outputRelative = normalizeOutputPath(datedOutputPath(item.relativePath), sourceFile);
      const outputFile = safeJoin(outputDir, outputRelative);
      const result = await writeMediaFile(sourceFile, outputFile, item.targetLocal);
      const warnings = (result.warnings || []).filter((warning) => !/Duplicate MakerNoteUnknown tag/i.test(String(warning)));
      job.results.push({
        relativePath: item.relativePath,
        output: path.relative(outputDir, outputFile).split(path.sep).join("/"),
        status: result.verified ? "ok" : "error",
        changed: result.changed,
        verified: result.verified,
        targetLocal: item.targetLocal || "",
        actualLocal: result.actualLocal || "",
        warnings,
        error: result.verified ? undefined : `写入后回读日期不一致（实际：${result.actualLocal || "未知"}）`,
      });
    } catch (error) {
      job.results.push({
        relativePath: job.current || "(未知文件)",
        status: "error",
        error: error.message || String(error),
      });
    } finally {
      job.done += 1;
    }
  }

  job.status = "done";
  job.current = "";
  job.finishedAt = Date.now();
}

app.post("/api/process", asyncRoute(async (req, res) => {
  const sourceDir = requireSourceDir(req.body?.sourceDir);
  const outputRoot = requireOutputRoot(req.body?.outputRoot);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) throw new Error("没有要处理的文件。");
  if (items.length > 5000) throw new Error("单次处理文件过多，请分批处理。");

  const job = {
    id: crypto.randomBytes(8).toString("hex"),
    status: "running",
    total: items.length,
    done: 0,
    current: "",
    outputDir: "",
    results: [],
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  res.json({ jobId: job.id });

  processJob(job, sourceDir, outputRoot, items).catch((error) => {
    job.status = "error";
    job.error = error.message || String(error);
    job.current = "";
    job.finishedAt = Date.now();
  });
}));

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "任务不存在或已过期。" });
  res.json(job);
});

app.post("/api/open-folder", asyncRoute(async (req, res) => {
  const folder = typeof req.body?.path === "string" ? path.resolve(req.body.path) : "";
  if (!folder) throw new Error("文件夹路径为空。");
  let stat;
  try {
    stat = fs.statSync(folder);
  } catch {
    throw new Error("文件夹不存在。");
  }
  if (!stat.isDirectory()) throw new Error("目标不是文件夹。");

  if (process.platform === "win32") {
    spawn("explorer.exe", [folder], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [folder], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [folder], { detached: true, stdio: "ignore" }).unref();
  }
  res.json({ ok: true });
}));

app.post("/api/browse-folder", asyncRoute(async (req, res) => {
  if (process.platform !== "win32") {
    return res.status(501).json({ error: "当前系统不支持原生文件夹选择，请手动输入路径。" });
  }
  const tempFile = path.join(os.tmpdir(), `timepostman-folder-${crypto.randomBytes(6).toString("hex")}.txt`);
  const escaped = tempFile.replaceAll("'", "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择照片或视频所在的文件夹'",
    "$dialog.ShowNewFolderButton = $false",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    `  [System.IO.File]::WriteAllText('${escaped}', $dialog.SelectedPath, (New-Object System.Text.UTF8Encoding($false)))`,
    "}",
  ].join("; ");

  await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", resolve);
  });

  let selected = "";
  try {
    selected = fs.readFileSync(tempFile, "utf8").trim();
  } catch {
    // User canceled or the dialog could not write the file.
  }
  try {
    fs.rmSync(tempFile, { force: true });
  } catch {
    // Ignore temp-file cleanup errors.
  }
  res.json({ path: selected });
}));

app.use("/api", (req, res) => {
  res.status(404).json({ error: "接口不存在。" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(error);
  res.status(400).json({ error: error.message || String(error) });
});

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}, 30 * 60 * 1000).unref();

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

let activeServer = null;

function startServer(port, attempts = 10) {
  const server = app.listen(port, "127.0.0.1");
  server.requestTimeout = 0;
  server.on("listening", () => {
    activeServer = server;
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    console.log(`TimePostman 已启动：${url}`);
    console.log("只监听本机 127.0.0.1，不会上传文件。");
    if (process.env.TIMEPOSTMAN_NO_OPEN !== "1") openBrowser(url);
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts > 0) {
      startServer(port + 1, attempts - 1);
      return;
    }
    console.error("启动失败：", error);
    process.exitCode = 1;
  });
  return server;
}

startServer(PORT);

async function shutdown() {
  try {
    activeServer?.close();
  } catch {
    // Ignore close errors.
  }
  try {
    await exiftool.end();
  } catch {
    // Ignore ExifTool shutdown errors.
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
