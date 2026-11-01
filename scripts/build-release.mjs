import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;
const NAME = `TimePostman-${VERSION}-win64`;
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, NAME);
const ZIP = path.join(DIST, `${NAME}.zip`);
const SKIP_HAP = process.argv.includes("--skip-hap");
const HAP_SOURCE = path.join(
  ROOT,
  "phone-receiver",
  "entry",
  "build",
  "default",
  "outputs",
  "default",
  "entry-default-signed.hap"
);
const HAP_NAME = `TimePostman-${VERSION}.hap`;

function log(message) {
  console.log(`[release] ${message}`);
}

function fail(message) {
  console.error(`[release] ERROR: ${message}`);
  process.exit(1);
}

function exists(target) {
  return fs.existsSync(target);
}

function writeText(file, content, options = {}) {
  let text = content;
  if (options.crlf) text = text.replace(/\r?\n/g, "\r\n");
  if (options.bom) text = `\uFEFF${text}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function findFirst(candidates) {
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return "";
}

function findHvigor() {
  return findFirst([
    process.env.HVIGORW,
    "C:/Program Files/Huawei/DevEco Studio/tools/hvigor/bin/hvigorw.bat",
    "C:/Program Files/Huawei/DevEco Studio/tools/hvigor/bin/hvigorw"
  ]);
}

function findSdk() {
  return findFirst([
    process.env.DEVECO_SDK_HOME,
    "C:/Program Files/Huawei/DevEco Studio/sdk"
  ]);
}

function buildPhoneHap() {
  if (SKIP_HAP) {
    log("skip HAP build; reuse the existing signed HAP");
    return;
  }
  const hvigor = findHvigor();
  const sdk = findSdk();
  if (!hvigor || !sdk) {
    log("hvigor or DevEco SDK not found; reuse the existing signed HAP");
    return;
  }
  log("build phone HAP");
  const command = `"${hvigor}" --mode module -p product=default assembleHap --no-daemon`;
  const result = spawnSync(command, {
    cwd: path.join(ROOT, "phone-receiver"),
    env: { ...process.env, DEVECO_SDK_HOME: sdk },
    stdio: "inherit",
    shell: true
  });
  if (result.status !== 0) fail("phone HAP build failed");
}

function installProductionDependencies() {
  log("install production dependencies");
  const result = spawnSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: OUT,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) fail("npm ci failed");
  const exiftool = path.join(OUT, "node_modules", "exiftool-vendored.exe", "bin", "exiftool.exe");
  if (!exists(exiftool)) fail("ExifTool binary is missing from production dependencies");
  if (exists(path.join(OUT, "node_modules", "@ffmpeg-installer"))) {
    fail("dev dependency @ffmpeg-installer leaked into the release");
  }
}

function writeLaunchers() {
  writeText(
    path.join(OUT, "启动 TimePostman.bat"),
    `@echo off
setlocal
cd /d "%~dp0"
title TimePostman ${VERSION}
if not exist "node\\node.exe" (
  echo Bundled Node runtime not found.
  pause
  exit /b 1
)
"node\\node.exe" "scripts\\start-all.mjs"
echo.
echo TimePostman has stopped. Press any key to close this window.
pause >nul
`,
    { crlf: true }
  );

  writeText(
    path.join(OUT, "安装手机端.bat"),
    `@echo off
setlocal
cd /d "%~dp0"
set "HDC=%HDC%"
if not defined HDC set "HDC=C:\\Program Files\\Huawei\\DevEco Studio\\sdk\\default\\openharmony\\toolchains\\hdc.exe"
if not exist "%HDC%" (
  for /f "delims=" %%I in ('where hdc 2^>nul') do (
    if not defined HDC set "HDC=%%I"
  )
)
if not exist "%HDC%" (
  echo hdc not found. Install DevEco Studio or set HDC to hdc.exe.
  pause
  exit /b 1
)
echo Installing TimePostman on the connected phone...
"%HDC%" install -r "phone\\${HAP_NAME}"
if errorlevel 1 (
  echo Install failed. Unlock the phone and enable USB debugging, then retry.
  pause
  exit /b 1
)
"%HDC%" rport tcp:8787 tcp:8787
"%HDC%" shell aa start -a EntryAbility -b com.timepostman.receiver
echo.
echo Done. If the phone screen is locked, unlock it and open TimePostman manually.
pause
`,
    { crlf: true }
  );
}

function writeGuide() {
  writeText(
    path.join(OUT, "使用说明.txt"),
    `TimePostman 时光邮差 ${VERSION}

一、这是什么
在电脑上修改照片/视频的拍摄日期，再传回鸿蒙手机图库，修正时间线。
支持 JPG / PNG / MP4 / MOV / HEIC；单文件不超过 300MB，一次最多 50 个。
GIF / WebP 的日期不会被鸿蒙图库采用，程序会跳过并提示。

二、电脑端启动
适用于 Windows 10/11 x64，不需要另外安装 Node.js。
1. 把整个文件夹解压到有写入权限的位置，例如 D:\\TimePostman。
2. 双击“启动 TimePostman.bat”。
3. 浏览器会自动打开 http://127.0.0.1:4317；如果没有自动打开，请手动访问。
4. 保持黑色命令行窗口开启；关闭窗口即停止服务。

三、手机端安装
1. 手机开启开发者模式和 USB 调试，用数据线连接电脑并解锁。
2. 双击“安装手机端.bat”，脚本会通过 hdc 安装并设置 USB 反向端口。
3. 手机端安装依赖 hdc（通常随 DevEco Studio 安装）；如果电脑没有 hdc，
   需要先用其他支持 hdc 的工具安装 phone\\TimePostman-${VERSION}.hap。
   安装完成后，连接方式可选 Wi-Fi 或 USB：在 App 里点“发现电脑”，
   输入电脑页面显示的 6 位配对码即可。
注意：本包内的 HAP 使用打包电脑上的 DevEco 调试签名；换电脑或换设备可能需要重新签名。

四、使用流程
1. 手机 App 点“上传”，选择照片/视频，上传到电脑。
2. 电脑网页点“手机传入”，设置目标日期（可批量），点处理。
3. 手机 App 点“接收结果” → “刷新结果” → “下载全部结果”。
4. 点系统“保存”按钮写入图库，到系统图库确认日期和时间线位置。
输出文件名带 _TimePostman 后缀，不会覆盖原文件。

五、连接方式
- Wi-Fi：手机和电脑在同一局域网。首次运行时 Windows 可能弹出防火墙提示，
  请允许“专用网络”访问 8787 端口。
- USB 直连：电脑装有 DevEco Studio / hdc 时，启动脚本会自动设置端口转发；
  在 App 的“设置”里点“USB 直连”。
- 电脑网页只监听 127.0.0.1；手机互传服务监听 8787。

六、数据位置
- exports\\                          处理后的文件和多批次记录（可定期清理）
- phone-inbox\\                      手机上传的原文件
- phone-transfer\\paired-devices.json  配对令牌，不要发给别人
网页里可以查看输出占用并清理旧输出（保留最近 3 批）。

七、常见问题
- 打不开网页：确认黑色窗口没有报错；端口 4317 被占用时先关闭旧实例。
- 手机连不上：确认同一 Wi-Fi / USB 连接、手机已解锁、防火墙允许 8787；
  重新点“发现电脑”或切回 Wi-Fi。
- 保存失败：系统保存按钮的授权窗口有时限，失败项会保留，再点一次保存即可重试。
- 日期没变：确认目标日期与原来不同；视频会同时修改影片、轨道和媒体日期。

八、卸载
关闭命令行窗口，删除整个文件夹即可；手机端在系统设置里卸载“时光邮差”。

第三方组件：Node.js（MIT）、ExifTool（Perl Artistic License / GPL）、Express 与 Multer（MIT）。
`,
    { crlf: true, bom: true }
  );
}

function createZip() {
  log("create zip");
  fs.rmSync(ZIP, { force: true });
  const command = `Compress-Archive -LiteralPath '${OUT}' -DestinationPath '${ZIP}' -CompressionLevel Optimal -Force`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: "inherit"
  });
  if (result.status !== 0 || !exists(ZIP)) fail("zip creation failed");
  const hash = crypto.createHash("sha256").update(fs.readFileSync(ZIP)).digest("hex");
  writeText(`${ZIP}.sha256`, `${hash}  ${path.basename(ZIP)}\n`);
  return hash;
}

function main() {
  if (path.basename(process.execPath).toLowerCase() !== "node.exe") {
    fail("run the release script with the official node.exe runtime");
  }
  fs.mkdirSync(DIST, { recursive: true });
  log(`prepare ${NAME}`);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.rmSync(ZIP, { force: true });
  fs.rmSync(`${ZIP}.sha256`, { force: true });
  fs.mkdirSync(OUT, { recursive: true });

  buildPhoneHap();
  if (!exists(HAP_SOURCE)) fail(`signed HAP not found: ${HAP_SOURCE}`);

  log("copy PC runtime and sources");
  fs.mkdirSync(path.join(OUT, "node"), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(OUT, "node", "node.exe"));
  for (const name of ["LICENSE", "LICENSE.txt"]) {
    const license = path.join(path.dirname(process.execPath), name);
    if (exists(license)) {
      fs.copyFileSync(license, path.join(OUT, "node", name));
      break;
    }
  }
  fs.cpSync(path.join(ROOT, "app"), path.join(OUT, "app"), { recursive: true });
  fs.cpSync(path.join(ROOT, "phone-transfer"), path.join(OUT, "phone-transfer"), {
    recursive: true,
    filter: (source) => path.basename(source) !== "paired-devices.json"
  });
  fs.mkdirSync(path.join(OUT, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "start-all.mjs"), path.join(OUT, "scripts", "start-all.mjs"));
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(OUT, "package.json"));
  fs.copyFileSync(path.join(ROOT, "package-lock.json"), path.join(OUT, "package-lock.json"));

  installProductionDependencies();
  writeLaunchers();
  writeGuide();

  fs.mkdirSync(path.join(OUT, "phone"), { recursive: true });
  fs.copyFileSync(HAP_SOURCE, path.join(OUT, "phone", HAP_NAME));

  const forbidden = [
    path.join(OUT, "phone-transfer", "paired-devices.json"),
    path.join(OUT, "phone-inbox"),
    path.join(OUT, "exports"),
    path.join(OUT, "phone-receiver")
  ];
  for (const item of forbidden) {
    if (exists(item)) fail(`unexpected release content: ${item}`);
  }

  const hash = createZip();
  const zipSize = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1);
  log(`release folder: ${OUT}`);
  log(`zip: ${ZIP} (${zipSize} MB)`);
  log(`sha256: ${hash}`);
}

main();
