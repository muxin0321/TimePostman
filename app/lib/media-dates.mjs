import fs from "node:fs";
import path from "node:path";
import { exiftool } from "exiftool-vendored";

export const TZ_OFFSET = "+08:00";
export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".heic", ".heif", ".png"]);
export const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v"]);
const IGNORED_NAMES = new Set([".gitkeep", "Thumbs.db", "desktop.ini"]);

export function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return null;
}

export function detectMediaExtension(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(16);
    const bytes = fs.readSync(fd, buffer, 0, 16, 0);
    if (bytes >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
    if (bytes >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return ".png";
    if (bytes >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
      const brand = buffer.toString("ascii", 8, 12);
      if (brand === "heic" || brand === "heix" || brand === "hevc" || brand === "hevx" || brand === "mif1" || brand === "msf1") {
        return ".heic";
      }
      if (brand === "qt  ") return ".mov";
      if (brand === "M4V " || brand === "M4VH" || brand === "M4VP") return ".m4v";
      return ".mp4";
    }
    if (bytes >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
      return ".webp";
    }
    if (bytes >= 3 && buffer.toString("ascii", 0, 3) === "GIF") return ".gif";
  } finally {
    fs.closeSync(fd);
  }
  return "";
}

export function listMedia(dir, { excludeDirs = [] } = {}) {
  const excluded = new Set(excludeDirs.map((item) => path.resolve(item)));
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || IGNORED_NAMES.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(path.resolve(full))) walk(full);
        continue;
      }
      if (entry.isFile() && kindOf(full)) files.push(full);
    }
  };
  walk(path.resolve(dir));
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function toExifLocal(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}:${p(value.getMonth() + 1)}:${p(value.getDate())} ${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}`;
  }
  const match = /^(\d{4})[-:](\d{2})[-:](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim());
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3]} ${match[4]}:${match[5]}:${match[6] ?? "00"}`;
}

export function toDatetimeLocal(value) {
  if (!value) return "";
  const match = /^(\d{4})[-:](\d{2})[-:](\d{2})[T ](\d{2}):(\d{2})/.exec(String(value).trim());
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
}

function yearOf(value) {
  const match = /^(\d{4})/.exec(String(value ?? ""));
  return match ? Number(match[1]) : null;
}

function hasUsableVideoDate(value) {
  if (value == null || String(value).trim() === "") return false;
  const year = yearOf(value);
  return year != null && year >= 1970;
}

function firstDate(tags, keys, { skipEarly = false } = {}) {
  for (const key of keys) {
    const value = tags[key];
    if (value == null || String(value).trim() === "") continue;
    if (skipEarly && !hasUsableVideoDate(value)) continue;
    return { value: String(value), key };
  }
  return null;
}

export async function readMediaInfo(file) {
  const kind = kindOf(file);
  const stat = fs.statSync(file);
  let tags;
  try {
    tags = await exiftool.read(file);
  } catch (error) {
    return {
      kind,
      size: stat.size,
      currentLocal: "",
      currentDisplay: "读取失败",
      currentSource: "error",
      currentSourceKey: "",
      error: error.message || String(error),
    };
  }

  let primary = null;
  if (kind === "image") {
    primary = firstDate(tags, ["DateTimeOriginal", "CreateDate", "ModifyDate", "FileModifyDate"]);
  } else {
    primary = firstDate(
      tags,
      ["CreateDate", "CreationDate", "TrackCreateDate", "MediaCreateDate", "FileModifyDate"],
      { skipEarly: true },
    );
  }

  const currentLocal = primary ? toDatetimeLocal(primary.value) : "";
  return {
    kind,
    size: stat.size,
    currentLocal,
    currentDisplay: currentLocal ? currentLocal.replace("T", " ") : "未知",
    currentSource: primary
      ? primary.key === "FileModifyDate" ? "file" : "metadata"
      : "unknown",
    currentSourceKey: primary?.key ?? "",
    error: null,
  };
}

export async function writeMediaFile(sourceFile, outputFile, targetLocal) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.copyFileSync(sourceFile, outputFile);
  const exifLocal = toExifLocal(targetLocal);
  if (targetLocal && !exifLocal) {
    fs.rmSync(outputFile, { force: true });
    throw new Error("目标日期格式不正确。");
  }
  if (!exifLocal) {
    return { changed: false, warnings: [], verified: true, actualLocal: "" };
  }

  const kind = kindOf(sourceFile);
  try {
    let result;
    if (kind === "image") {
      result = await exiftool.write(outputFile, {
        AllDates: exifLocal,
        "EXIF:OffsetTimeOriginal": TZ_OFFSET,
        "EXIF:OffsetTimeDigitized": TZ_OFFSET,
        "EXIF:OffsetTime": TZ_OFFSET,
        "XMP-photoshop:DateCreated": exifLocal,
        FileModifyDate: exifLocal,
        FileCreateDate: exifLocal,
      }, ["-overwrite_original"]);
    } else {
      result = await exiftool.write(outputFile, {
        "QuickTime:CreateDate": exifLocal,
        "QuickTime:ModifyDate": exifLocal,
        "QuickTime:TrackCreateDate": exifLocal,
        "QuickTime:TrackModifyDate": exifLocal,
        "QuickTime:MediaCreateDate": exifLocal,
        "QuickTime:MediaModifyDate": exifLocal,
        "Keys:CreationDate": `${exifLocal}${TZ_OFFSET}`,
        FileModifyDate: exifLocal,
        FileCreateDate: exifLocal,
      }, ["-api", "QuickTimeUTC=1", "-overwrite_original"]);
    }
    const info = await readMediaInfo(outputFile);
    const expectedLocal = toDatetimeLocal(exifLocal);
    // Huawei camera JPEGs often emit this benign MakerNote warning; standard date tags are still written.
    const warnings = (Array.isArray(result.warnings) ? result.warnings : [])
      .filter((warning) => !/Duplicate MakerNoteUnknown tag/i.test(String(warning)));
    return {
      changed: true,
      warnings,
      verified: info.currentSource === "metadata" && info.currentLocal === expectedLocal,
      actualLocal: info.currentLocal,
    };
  } catch (error) {
    try {
      fs.rmSync(outputFile, { force: true });
    } catch {
      // Keep the original write error.
    }
    throw error;
  }
}
