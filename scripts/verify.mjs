#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { exiftool } from "exiftool-vendored";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUT_DIR = path.join(ROOT, "samples", "input");
const OUTPUT_DIR = path.join(ROOT, "samples", "output");
const TZ_OFFSET = "+08:00";

const TEST_DATES = {
  A: { code: "A", local: "2017:04:09 12:00:00", label: "2017-04-09 12:00:00 (UTC+8)" },
  B: { code: "B", local: "2022:09:18 12:00:00", label: "2022-09-18 12:00:00 (UTC+8)" },
};

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".heic", ".heif", ".png"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v"]);
const IGNORED_NAMES = new Set([".gitkeep", "Thumbs.db", "desktop.ini"]);

function log(...args) {
  console.log(...args);
}

function warn(...args) {
  console.warn(...args);
}

function ensureDirs() {
  fs.mkdirSync(INPUT_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function formatTimestamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function listMedia(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || IGNORED_NAMES.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) files.push(full);
    }
  };
  walk(dir);
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return null;
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpeg.path, args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FFmpeg 退出码 ${result.status}: ${(result.stderr || "").trim()}`);
  }
}

function generateSamples() {
  ensureDirs();
  const samples = [
    {
      name: "sample-photo.jpg",
      args: [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=1600x1200:rate=1",
        "-frames:v", "1", "-q:v", "2",
      ],
    },
    {
      name: "sample-video.mp4",
      args: [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", "-movflags", "+faststart",
      ],
    },
    {
      name: "sample-video.mov",
      args: [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
      ],
    },
  ];

  for (const sample of samples) {
    const output = path.join(INPUT_DIR, sample.name);
    if (fs.existsSync(output)) {
      log(`跳过已存在：${path.relative(ROOT, output)}`);
      continue;
    }
    runFfmpeg([...sample.args, output]);
    log(`已生成：${path.relative(ROOT, output)}`);
  }

  log("提示：FFmpeg 无法稳定生成 HEIC。请从鸿蒙手机复制一张真实 HEIC 到 samples/input/ 再做测试。");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function localToEpoch(local) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(local));
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${TZ_OFFSET}`;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

function valueToEpoch(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  const normalized = match
    ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${TZ_OFFSET}`
    : text;
  const valueMs = Date.parse(normalized);
  return Number.isNaN(valueMs) ? null : valueMs;
}

function sameInstant(expectedLocal, actual) {
  const expected = localToEpoch(expectedLocal);
  const actualMs = valueToEpoch(actual);
  if (expected == null || actualMs == null) return false;
  return Math.abs(expected - actualMs) <= 90_000;
}

function readMvhdCreationTime(file) {
  const fd = fs.openSync(file, "r");
  try {
    const fileSize = fs.fstatSync(fd).size;
    const readAt = (offset, length) => {
      const buffer = Buffer.alloc(length);
      const bytes = fs.readSync(fd, buffer, 0, length, offset);
      return buffer.subarray(0, bytes);
    };
    const findBox = (start, end, wanted) => {
      let offset = start;
      while (offset + 8 <= end) {
        const header = readAt(offset, 16);
        if (header.length < 8) return null;
        let size = header.readUInt32BE(0);
        const type = header.toString("ascii", 4, 8);
        let headerSize = 8;
        if (size === 1) {
          if (header.length < 16) return null;
          size = Number(header.readBigUInt64BE(8));
          headerSize = 16;
        } else if (size === 0) {
          size = end - offset;
        }
        if (!Number.isFinite(size) || size < headerSize) return null;
        if (type === wanted) {
          return { dataStart: offset + headerSize, end: Math.min(offset + size, end) };
        }
        offset += size;
      }
      return null;
    };

    const moov = findBox(0, fileSize, "moov");
    if (!moov) return null;
    const mvhd = findBox(moov.dataStart, moov.end, "mvhd");
    if (!mvhd) return null;

    const version = readAt(mvhd.dataStart, 1)[0];
    const timeBytes = version === 0 ? 4 : 8;
    const timeBuffer = readAt(mvhd.dataStart + 4, timeBytes);
    if (timeBuffer.length < timeBytes) return null;
    const seconds = version === 0 ? timeBuffer.readUInt32BE(0) : Number(timeBuffer.readBigUInt64BE(0));
    if (!Number.isFinite(seconds) || seconds === 0) return null;

    const epochMs = Date.UTC(1904, 0, 1) + seconds * 1000;
    const utc = new Date(epochMs).toISOString();
    const local = new Date(epochMs + 8 * 3600 * 1000).toISOString().replace("Z", TZ_OFFSET);
    return { version, seconds, epochMs, utc, local };
  } finally {
    fs.closeSync(fd);
  }
}

function variantsFor(kind) {
  const common = [
    {
      id: "bothA",
      meta: "A",
      file: "A",
      note: "基础对照：元数据和文件时间都为 A。若仍不是 A，图库可能用了导入时间或别的规则。",
    },
    {
      id: "metaA-mtimeB",
      meta: "A",
      file: "B",
      note: "关键组：元数据 A，文件时间 B。显示 A=认元数据；显示 B=认文件时间；显示当天=认导入时间。",
    },
    {
      id: "metaB-mtimeA",
      meta: "B",
      file: "A",
      note: "反向关键组：元数据 B，文件时间 A。用于交叉验证，避免偶然结果。",
    },
  ];
  if (kind === "image") {
    common.push({
      id: "nodate-mtimeA",
      meta: null,
      file: "A",
      note: "图片专用：删除所有时间元数据，文件时间 A。显示 A=回退到文件时间；显示当天=回退到导入时间。",
    });
  }
  return common;
}

async function applyImageMetadata(file, metaTarget, fileTarget) {
  const tags = {
    FileModifyDate: fileTarget.local,
    FileCreateDate: fileTarget.local,
  };
  if (metaTarget) {
    tags.AllDates = metaTarget.local;
    tags["EXIF:OffsetTimeOriginal"] = TZ_OFFSET;
    tags["EXIF:OffsetTimeDigitized"] = TZ_OFFSET;
    tags["EXIF:OffsetTime"] = TZ_OFFSET;
    tags["XMP-photoshop:DateCreated"] = metaTarget.local;
    return exiftool.write(file, tags, ["-overwrite_original"]);
  }
  return exiftool.write(file, tags, ["-time:all=", "-overwrite_original"]);
}

async function applyVideoMetadata(file, metaTarget, fileTarget) {
  const tags = {
    FileModifyDate: fileTarget.local,
    FileCreateDate: fileTarget.local,
  };
  if (metaTarget) {
    tags["QuickTime:CreateDate"] = metaTarget.local;
    tags["QuickTime:ModifyDate"] = metaTarget.local;
    tags["QuickTime:TrackCreateDate"] = metaTarget.local;
    tags["QuickTime:TrackModifyDate"] = metaTarget.local;
    tags["QuickTime:MediaCreateDate"] = metaTarget.local;
    tags["QuickTime:MediaModifyDate"] = metaTarget.local;
    tags["Keys:CreationDate"] = `${metaTarget.local}${TZ_OFFSET}`;
    return exiftool.write(file, tags, ["-api", "QuickTimeUTC=1", "-overwrite_original"]);
  }
  return exiftool.write(file, tags, ["-time:all=", "-overwrite_original"]);
}

async function applyMetadata(file, kind, metaTarget, fileTarget) {
  if (kind === "image") {
    return applyImageMetadata(file, metaTarget, fileTarget);
  }
  return applyVideoMetadata(file, metaTarget, fileTarget);
}

async function readActual(file, kind) {
  const tags = await exiftool.read(file);
  const pick = (key) => {
    const value = tags[key];
    return value == null ? "" : String(value);
  };
  return {
    meta: kind === "image" ? pick("DateTimeOriginal") : pick("CreateDate"),
    keys: kind === "video" ? pick("CreationDate") : "",
    container: kind === "video" ? readMvhdCreationTime(file) : null,
    trackCreate: kind === "video" ? pick("TrackCreateDate") : "",
    trackModify: kind === "video" ? pick("TrackModifyDate") : "",
    mediaCreate: kind === "video" ? pick("MediaCreateDate") : "",
    mediaModify: kind === "video" ? pick("MediaModifyDate") : "",
    fileModify: pick("FileModifyDate"),
    fileCreate: pick("FileCreateDate"),
  };
}

function checkActual(kind, metaTarget, fileTarget, actual) {
  const checks = [];
  if (metaTarget) {
    checks.push(sameInstant(metaTarget.local, actual.meta));
  } else {
    checks.push(actual.meta === "");
  }
  if (kind === "video" && metaTarget) {
    checks.push(sameInstant(metaTarget.local, actual.keys));
    checks.push(sameInstant(metaTarget.local, actual.trackCreate));
    checks.push(sameInstant(metaTarget.local, actual.trackModify));
    checks.push(sameInstant(metaTarget.local, actual.mediaCreate));
    checks.push(sameInstant(metaTarget.local, actual.mediaModify));
    const expected = localToEpoch(metaTarget.local);
    checks.push(
      actual.container != null
      && expected != null
      && Math.abs(actual.container.epochMs - expected) <= 90_000,
    );
  }
  checks.push(sameInstant(fileTarget.local, actual.fileModify));
  checks.push(sameInstant(fileTarget.local, actual.fileCreate));
  return checks.every(Boolean);
}

function latestRunDir() {
  ensureDirs();
  const runs = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
    .map((entry) => path.join(OUTPUT_DIR, entry.name))
    .sort();
  return runs.at(-1) ?? null;
}

function makeRunDir() {
  ensureDirs();
  const stamp = formatTimestamp(new Date());
  let candidate = path.join(OUTPUT_DIR, `run-${stamp}`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(OUTPUT_DIR, `run-${stamp}-${suffix}`);
    suffix += 1;
  }
  fs.mkdirSync(candidate, { recursive: true });
  return candidate;
}

function writeManifest(runDir, rows, inputs) {
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const importHint = new Date().toLocaleDateString("zh-CN");
  const headers = [
    "code",
    "kind",
    "original_file",
    "test_file",
    "variant",
    "metadata_target",
    "file_time_target",
    "if_gallery_reads_metadata",
    "if_gallery_reads_file_time",
    "if_gallery_reads_import_time",
    "pc_metadata_readback",
    "pc_keys_readback",
    "pc_container_mvhd_utc",
    "pc_container_mvhd_local",
    "pc_track_create_readback",
    "pc_track_modify_readback",
    "pc_media_create_readback",
    "pc_media_modify_readback",
    "pc_file_modify_readback",
    "pc_file_create_readback",
    "pc_check",
    "observed_gallery_date",
    "observed_timeline_position",
    "notes",
  ];
  const csvRows = rows.map((row) => [
    row.code,
    row.kind,
    row.original,
    row.testFile,
    row.variant,
    row.metaTarget,
    row.fileTarget,
    row.metaTarget === "none" ? "无（已删除）" : row.metaTarget,
    row.fileTarget,
    "当天",
    row.metadataPc,
    row.keysPc,
    row.containerUtc,
    row.containerLocal,
    row.trackCreatePc,
    row.trackModifyPc,
    row.mediaCreatePc,
    row.mediaModifyPc,
    row.fileModifyPc,
    row.fileCreatePc,
    row.status,
    row.observedDate,
    row.observedPosition,
    row.notes,
  ]);
  const csv = "\ufeff" + [headers, ...csvRows].map((line) => line.map(csvEscape).join(",")).join("\r\n") + "\r\n";
  fs.writeFileSync(path.join(runDir, "manifest.csv"), csv, "utf8");

  const table = [
    "| 文件 | 原始文件 | 变体 | 元数据 | 文件时间 | 容器 mvhd (UTC) | 轨道/媒体日期 | PC 自检 | 真机显示日期 | 时间线位置 | 备注 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => {
      const meta = row.metaTarget === "none" ? "无（删除）" : row.metaTarget;
      const trackInfo = row.kind === "video"
        ? `${row.trackCreatePc || "—"} / ${row.mediaCreatePc || "—"}`
        : "—";
      return `| ${row.testFile.replace("media/", "")} | ${row.original} | ${row.variant} | ${meta} | ${row.fileTarget} | ${row.containerUtc || "—"} | ${trackInfo} | ${row.status} |  |  | ${row.notes} |`;
    }),
  ].join("\n");

  const md = [
    `# TimePostman 验证运行 ${path.basename(runDir)}`,
    "",
    `生成时间：${generatedAt}`,
    "",
    "## 测试日期",
    "",
    "- A = 2017-04-09 12:00:00（UTC+8）",
    "- B = 2022-09-18 12:00:00（UTC+8）",
    `- “当天” = 导入时的实际日期（本次约 ${importHint}）`,
    "",
    "## 真机记录（请填写）",
    "",
    "- 设备型号：",
    "- HarmonyOS 版本：",
    "- 传输方式：华为分享 / USB / 其他：",
    "- 导入时间：",
    "- 是否重启后复测：",
    "- 结论：",
    "",
    "## 文件清单",
    "",
    table,
    "",
    "## 判读规则",
    "",
    "1. 重点看 `metaA-mtimeB` 与 `metaB-mtimeA` 两组。",
    "2. 如果两组分别显示 A 和 B，说明图库优先读文件内嵌元数据，PC 端预处理路线成立。",
    "3. 如果两组分别显示 B 和 A，说明图库优先读文件时间，手机接收端需要在保存前设置 mtime。",
    "4. 如果两组都显示导入日期，说明图库优先用导入时间，需要再验证手机端 SaveButton/createAsset 的入库路径。",
    "5. 同时记录“图库显示的日期”和“文件在时间线中的位置”，两者可能不一致。",
    "",
    "详细说明见项目根目录 README.md。",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(runDir, "manifest.md"), md, "utf8");

  fs.writeFileSync(
    path.join(runDir, "manifest.json"),
    JSON.stringify({ run: path.basename(runDir), generatedAt, inputs, dates: TEST_DATES, rows }, null, 2),
    "utf8",
  );

  const quickReadme = [
    `TimePostman 验证运行 ${path.basename(runDir)}`,
    "",
    "1. 只把 media 文件夹里的媒体文件传到鸿蒙 NEXT 手机。",
    "2. 保存进系统图库。",
    "3. 在每张图/视频的详情里确认文件名（p01-... / v01-...）。",
    "4. 记录图库显示的日期、时间线位置，以及是否重启后仍然一致。",
    "5. 把观察结果填到 manifest.csv 或 manifest.md。",
    "",
    "测试日期：A = 2017-04-09 12:00:00，B = 2022-09-18 12:00:00（UTC+8）。",
    "不要重命名 media 里的文件，否则无法和清单对应。",
    "详细说明见项目根目录 README.md。",
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(runDir, "README.txt"), quickReadme, "utf8");

  return { table, generatedAt };
}

async function prepare(options = {}) {
  ensureDirs();
  const inputDir = options.input ? path.resolve(options.input) : INPUT_DIR;
  const inputs = listMedia(inputDir);
  if (inputs.length === 0) {
    throw new Error(`没有在 ${inputDir} 找到可测试的媒体文件。请放入 JPG/HEIC/PNG/MP4/MOV，或先运行 npm run verify:generate。`);
  }

  const runDir = makeRunDir();
  const mediaDir = path.join(runDir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });

  const rows = [];
  const failures = [];
  const warningsByFile = new Map();
  let imageIndex = 0;
  let videoIndex = 0;

  for (const input of inputs) {
    const kind = kindOf(input);
    if (!kind) continue;
    const ext = path.extname(input).toLowerCase();
    const index = kind === "image" ? ++imageIndex : ++videoIndex;
    const code = `${kind === "image" ? "p" : "v"}${String(index).padStart(2, "0")}`;

    for (const variant of variantsFor(kind)) {
      const outputName = `${code}-${variant.id}${ext}`;
      const outputPath = path.join(mediaDir, outputName);
      fs.copyFileSync(input, outputPath);
      const metaTarget = variant.meta ? TEST_DATES[variant.meta] : null;
      const fileTarget = TEST_DATES[variant.file];

      try {
        const writeResult = await applyMetadata(outputPath, kind, metaTarget, fileTarget);
        const warnings = Array.isArray(writeResult?.warnings) ? writeResult.warnings : [];
        if (warnings.length > 0) warningsByFile.set(outputName, warnings);
        const actual = await readActual(outputPath, kind);
        const ok = checkActual(kind, metaTarget, fileTarget, actual);
        rows.push({
          code,
          kind,
          original: path.relative(ROOT, input).split(path.sep).join("/"),
          testFile: `media/${outputName}`,
          variant: variant.id,
          metaTarget: metaTarget ? metaTarget.code : "none",
          fileTarget: fileTarget.code,
          metadataPc: actual.meta,
          keysPc: actual.keys,
          containerUtc: actual.container?.utc ?? "",
          containerLocal: actual.container?.local ?? "",
          trackCreatePc: actual.trackCreate,
          trackModifyPc: actual.trackModify,
          mediaCreatePc: actual.mediaCreate,
          mediaModifyPc: actual.mediaModify,
          fileModifyPc: actual.fileModify,
          fileCreatePc: actual.fileCreate,
          status: ok ? "OK" : "CHECK",
          observedDate: "",
          observedPosition: "",
          notes: warnings.length ? `${variant.note} ExifTool 警告：${warnings.join(" | ")}` : variant.note,
        });
        if (!ok) failures.push(outputName);
      } catch (error) {
        failures.push(outputName);
        rows.push({
          code,
          kind,
          original: path.relative(ROOT, input).split(path.sep).join("/"),
          testFile: `media/${outputName}`,
          variant: variant.id,
          metaTarget: metaTarget ? metaTarget.code : "none",
          fileTarget: fileTarget.code,
          metadataPc: "",
          keysPc: "",
          containerUtc: "",
          containerLocal: "",
          trackCreatePc: "",
          trackModifyPc: "",
          mediaCreatePc: "",
          mediaModifyPc: "",
          fileModifyPc: "",
          fileCreatePc: "",
          status: "ERROR",
          observedDate: "",
          observedPosition: "",
          notes: `${variant.note} 写入失败：${error.message || error}`,
        });
        warn(`写入失败：${outputName} -> ${error.message || error}`);
      }
    }
  }

  writeManifest(runDir, rows, inputs);

  const okCount = rows.filter((row) => row.status === "OK").length;
  const checkCount = rows.filter((row) => row.status === "CHECK").length;
  const errorCount = rows.filter((row) => row.status === "ERROR").length;
  log("");
  log(`运行目录：${runDir}`);
  log(`媒体文件：${rows.length} 个（${imageIndex} 张图片 / ${videoIndex} 段视频输入）`);
  log(`PC 端自检：OK ${okCount} / CHECK ${checkCount} / ERROR ${errorCount}`);
  if (failures.length > 0) {
    warn("");
    warn("以下文件写入或回读异常，请先处理后再做真机测试：");
    for (const failure of failures) warn(`  - ${failure}`);
  }
  if (warningsByFile.size > 0) {
    warn("");
    warn("ExifTool 警告（PC 端回读仍可能正常，但真机测试时留意）：");
    for (const [file, warnings] of warningsByFile) warn(`  - ${file}: ${warnings.join(" | ")}`);
  }
  log("");
  log("下一步：只把 run 目录下 media/ 里的文件传到鸿蒙 NEXT 手机，保存进图库测试。");
  log(`清单：${path.join(runDir, "manifest.md")}`);
  log(`CSV：${path.join(runDir, "manifest.csv")}`);

  return { runDir, rows };
}

async function inspect(options = {}) {
  const runDir = options.run ? path.resolve(options.run) : latestRunDir();
  if (!runDir) {
    throw new Error("还没有可检查的运行目录。请先运行 npm run verify:prepare。");
  }
  const manifestPath = path.join(runDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`找不到 ${manifestPath}，请确认这是一个 TimePostman 运行目录。`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const table = [];

  for (const row of manifest.rows) {
    const file = path.join(runDir, row.testFile);
    if (!fs.existsSync(file)) {
      table.push({
        文件: row.testFile.replace("media/", ""),
        元数据预期: row.metaTarget,
        元数据回读: "(缺失)",
        文件时间预期: row.fileTarget,
        文件时间回读: "(缺失)",
        "容器 mvhd (UTC)": "—",
        "轨道/媒体日期": "—",
        状态: "MISSING",
      });
      continue;
    }
    const actual = await readActual(file, row.kind);
    const metaTarget = row.metaTarget === "none" ? null : TEST_DATES[row.metaTarget];
    const fileTarget = TEST_DATES[row.fileTarget];
    const ok = checkActual(row.kind, metaTarget, fileTarget, actual);
    table.push({
      文件: row.testFile.replace("media/", ""),
      元数据预期: row.metaTarget,
      元数据回读: actual.meta || "(无)",
      文件时间预期: row.fileTarget,
      文件时间回读: actual.fileModify || "(无)",
      "容器 mvhd (UTC)": actual.container?.utc ?? (row.kind === "video" ? "(无)" : "—"),
      "轨道/媒体日期": row.kind === "video"
        ? `${actual.trackCreate || "—"} / ${actual.mediaCreate || "—"}`
        : "—",
      状态: ok ? "OK" : "CHECK",
    });
  }

  log("");
  log(`检查运行：${runDir}`);
  console.table(table);
  const bad = table.filter((row) => row.状态 !== "OK").length;
  if (bad > 0) {
    warn(`有 ${bad} 个文件回读不符合预期，请先修复再传到手机。`);
  } else {
    log("所有文件的 PC 端元数据与文件时间都符合预期，可以开始真机测试。");
  }
  return { runDir, table };
}

async function doctor() {
  ensureDirs();
  const ffmpegVersion = spawnSync(ffmpeg.path, ["-version"], { encoding: "utf8", windowsHide: true });
  const firstLine = (ffmpegVersion.stdout || "").split(/\r?\n/)[0] || "unknown";
  log(`Node：${process.version}（${process.platform}/${process.arch}）`);
  log(`ExifTool：${await exiftool.version()}`);
  log(`FFmpeg：${firstLine}`);
  log(`输入目录：${INPUT_DIR}`);
  log(`输出目录：${OUTPUT_DIR}`);
  const inputs = listMedia(INPUT_DIR);
  log(`输入文件：${inputs.length} 个`);
  if (inputs.length > 0) {
    for (const file of inputs) log(`  - ${path.relative(ROOT, file)}`);
  } else {
    log("输入目录为空。可以运行 npm run verify:generate 生成测试样本，或放入你自己的媒体文件。");
  }
}

function help() {
  log("TimePostman 鸿蒙 NEXT 日期验证工具");
  log("");
  log("用法：");
  log("  npm run verify:doctor              检查 Node / ExifTool / FFmpeg 和输入目录");
  log("  npm run verify:generate            生成 JPG / MP4 / MOV 测试样本");
  log("  npm run verify:prepare             按测试矩阵处理 samples/input 里的文件");
  log("  npm run verify:inspect             回读最近一次运行，确认写入结果");
  log("  npm run verify:all                 没有输入时先生成样本，然后 prepare + inspect");
  log("");
  log("可选参数：");
  log("  node scripts/verify.mjs prepare --input <目录>");
  log("  node scripts/verify.mjs inspect --run <运行目录>");
  log("");
  log("测试矩阵：A/B 两组日期分别写入元数据和文件时间，观察鸿蒙 NEXT 图库优先采用哪一层。");
  log("详细说明见 README.md。");
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") {
      options.input = args[++index];
      continue;
    }
    if (arg === "--run") {
      options.run = args[++index];
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function main() {
  const command = process.argv[2] || "help";
  const options = parseOptions(process.argv.slice(3));
  if (options.help) {
    help();
    return;
  }
  switch (command) {
    case "doctor":
      await doctor();
      break;
    case "generate":
      generateSamples();
      break;
    case "prepare": {
      const { runDir } = await prepare(options);
      log(`运行目录：${runDir}`);
      break;
    }
    case "inspect":
      await inspect(options);
      break;
    case "all": {
      await doctor();
      if (listMedia(INPUT_DIR).length === 0) {
        log("");
        log("输入目录为空，先生成合成样本。");
        generateSamples();
      }
      const { runDir } = await prepare(options);
      await inspect({ run: runDir });
      log("");
      log("接下来：把 media 里的文件传到鸿蒙 NEXT 手机，按 README.md 的步骤记录观察结果。");
      break;
    }
    case "help":
      help();
      break;
    default:
      help();
      process.exitCode = 1;
      break;
  }
}

try {
  await main();
} catch (error) {
  console.error("");
  console.error(`错误：${error.message || error}`);
  process.exitCode = 1;
} finally {
  try {
    await exiftool.end();
  } catch {
    // ExifTool may never have started.
  }
}
