import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDITOR_PORT = 4317;
const TRANSFER_PORT = 8787;
const EDITOR_URL = `http://127.0.0.1:${EDITOR_PORT}`;
const NO_OPEN = process.argv.includes("--no-open");
const children = [];
let shuttingDown = false;

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(800, () => done(false));
  });
}

async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isListening(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function startServer(script, label) {
  const child = spawn(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: false,
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.log(`${label}已退出（code=${code ?? "null"}, signal=${signal ?? "null"}）。`);
    }
  });
  children.push(child);
  return child;
}

function setupUsbReverse() {
  const candidates = [
    process.env.HDC,
    "C:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe",
    "C:/Program Files/Huawei/DevEco Studio/sdk/default/hms/toolchains/hdc.exe",
  ].filter(Boolean);
  for (const hdc of candidates) {
    if (!fs.existsSync(hdc)) continue;
    try {
      const targets = execFileSync(hdc, ["list", "targets"], { encoding: "utf8", timeout: 5000 }).trim();
      if (!targets || targets.includes("[Empty]")) {
        console.log("USB 反向端口：没有检测到已连接手机，使用 Wi-Fi。");
        return;
      }
      execFileSync(hdc, ["rport", "tcp:8787", "tcp:8787"], { encoding: "utf8", timeout: 5000 });
      console.log("USB 反向端口已设置：手机端可点“USB 直连”获得更快速度。");
      return;
    } catch {
      // Try the next hdc location.
    }
  }
}

function openBrowser(url) {  const command = process.platform === "win32"
    ? { file: "cmd.exe", args: ["/c", "start", "", url] }
    : process.platform === "darwin"
      ? { file: "open", args: [url] }
      : { file: "xdg-open", args: [url] };
  try {
    const child = spawn(command.file, command.args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch (error) {
    console.log(`请手动打开：${url}（自动打开失败：${error.message}）`);
  }
}

async function main() {
  const editorRunning = await isListening(EDITOR_PORT);
  const transferRunning = await isListening(TRANSFER_PORT);

  if (editorRunning && transferRunning) {
    console.log("TimePostman 两个服务都已在运行。");
    setupUsbReverse();
    if (!NO_OPEN) openBrowser(EDITOR_URL);
    return;
  }

  if (!editorRunning) {
    console.log("启动电脑日期编辑器…");
    startServer("app/server.mjs", "电脑日期编辑器");
  }
  if (!transferRunning) {
    console.log("启动手机互传服务…");
    startServer("phone-transfer/server.mjs", "手机互传服务");
  }

  if (!editorRunning && !(await waitForPort(EDITOR_PORT))) {
    console.error(`电脑日期编辑器启动失败：${EDITOR_PORT} 端口没有响应。`);
    shutdown(1);
    return;
  }

  if (!(await waitForPort(TRANSFER_PORT, 5000))) {
    console.error(`手机互传服务启动失败：${TRANSFER_PORT} 端口没有响应。`);
    shutdown(1);
    return;
  }

  setupUsbReverse();
  console.log("");
  console.log(`TimePostman 已就绪：${EDITOR_URL}`);
  console.log("保持这个窗口打开；关闭窗口或按 Ctrl+C 会同时停止两个服务。");
  if (!NO_OPEN) openBrowser(EDITOR_URL);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // Child may already be gone.
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
