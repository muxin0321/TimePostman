const $ = (selector) => document.querySelector(selector);

const sourceInput = $("#sourceDir");
const outputInput = $("#outputRoot");
const browseSourceBtn = $("#browseSource");
const browseOutputBtn = $("#browseOutput");
const scanBtn = $("#scanBtn");
const phoneInboxBtn = $("#phoneInboxBtn");
const clearInboxBtn = $("#clearInboxBtn");
const outputSummary = $("#outputSummary");
const cleanupOutputsBtn = $("#cleanupOutputsBtn");
const pairingBanner = $("#pairingBanner");
const pairingDevice = $("#pairingDevice");
const pairingCode = $("#pairingCode");
const denyPairingBtn = $("#denyPairingBtn");
const scanMessage = $("#scanMessage");
const filesSection = $("#filesSection");
const fileSummary = $("#fileSummary");
const fileRows = $("#fileRows");
const emptyState = $("#emptyState");
const bulkDate = $("#bulkDate");
const applyBulkBtn = $("#applyBulk");
const resetDatesBtn = $("#resetDates");
const selectAll = $("#selectAll");
const selectedCount = $("#selectedCount");
const processBtn = $("#processBtn");
const progressWrap = $("#progressWrap");
const progressFill = $("#progressFill");
const progressText = $("#progressText");
const resultSection = $("#resultSection");
const resultSummary = $("#resultSummary");
const resultDetails = $("#resultDetails");
const outputDirLabel = $("#outputDir");
const openFolderBtn = $("#openFolderBtn");
const toast = $("#toast");

const state = {
  token: "",
  platform: "",
  canBrowse: false,
  sourceDir: "",
  outputRoot: "",
  phoneInbox: "",
  pairingRequestId: "",
  files: [],
  selected: new Set(),
  targets: new Map(),
  jobId: "",
  outputDir: "",
  busy: false,
  processBusy: false,
  pollTimer: null,
  toastTimer: null,
};

function storageGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private mode; the app still works.
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function normalizePath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatInputDate(value) {
  return String(value ?? "").replace("T", " ");
}

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, type === "error" ? 6500 : 4200);
}

function showScanMessage(message, type = "info") {
  scanMessage.textContent = message;
  scanMessage.className = `message ${type}`;
  scanMessage.hidden = !message;
}

function showScanError(message) {
  showScanMessage(message, "error");
  showToast(message, "error");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-TimePostman-Token": state.token,
      ...(options.headers || {}),
    },
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // The server returns JSON for API errors; an empty body is still handled below.
  }
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("本地服务会话已失效，请刷新页面。");
    }
    throw new Error(data.error || `请求失败（${response.status}）`);
  }
  return data;
}

function setBusy(busy) {
  state.busy = busy;
  scanBtn.disabled = busy;
  phoneInboxBtn.disabled = busy;
  clearInboxBtn.disabled = busy;
  cleanupOutputsBtn.disabled = busy;
  browseSourceBtn.disabled = busy || !state.canBrowse;
  browseOutputBtn.disabled = busy || !state.canBrowse;
  sourceInput.disabled = busy;
  outputInput.disabled = busy;
  bulkDate.disabled = busy;
  applyBulkBtn.disabled = busy;
  resetDatesBtn.disabled = busy;
  selectAll.disabled = busy;
  for (const input of fileRows.querySelectorAll("input")) {
    input.disabled = busy || Boolean(input.closest("tr")?.classList.contains("is-error"));
  }
  updateProcessButton();
}

async function pollPairing() {
  try {
    const data = await api("/api/phone-pair/pending");
    const request = Array.isArray(data.requests) ? data.requests[0] : null;
    if (!request) {
      state.pairingRequestId = "";
      pairingBanner.hidden = true;
      return;
    }
    state.pairingRequestId = request.requestId || "";
    pairingDevice.textContent = request.deviceName || "手机";
    pairingCode.textContent = String(request.code || "");
    pairingBanner.hidden = false;
  } catch {
    state.pairingRequestId = "";
    pairingBanner.hidden = true;
  }
}

function updateTargetHint(input) {
  const hint = input.parentElement.querySelector(".target-hint");
  if (!hint) return;
  const current = input.dataset.current || "";
  const value = input.value;
  const changed = Boolean(value) && (!current || value !== current);
  hint.textContent = !value ? "未设置" : changed ? "将修改" : "未修改";
  hint.classList.toggle("changed", changed);
}

function updateSelectionUi() {
  const selectable = state.files.filter((file) => !file.error);
  const count = selectable.filter((file) => state.selected.has(file.id)).length;
  selectedCount.textContent = `已选 ${count} 个`;
  selectAll.checked = selectable.length > 0 && count === selectable.length;
  selectAll.indeterminate = count > 0 && count < selectable.length;
  updateProcessButton();
}

function updateProcessButton() {
  const count = state.files.filter((file) => !file.error && state.selected.has(file.id)).length;
  processBtn.disabled = state.busy || count === 0;
  if (!state.processBusy) {
    processBtn.textContent = count > 0 ? `开始处理 (${count})` : "开始处理";
  }
}

function resetScanResults() {
  state.files = [];
  state.selected = new Set();
  state.targets = new Map();
  state.jobId = "";
  state.outputDir = "";
  state.processBusy = false;
  state.pollTimer = null;
  filesSection.hidden = true;
  resultSection.hidden = true;
  progressWrap.hidden = true;
  progressFill.style.width = "0%";
  progressText.textContent = "";
  fileRows.innerHTML = "";
  emptyState.hidden = true;
  updateSelectionUi();
}

function renderFiles() {
  const images = state.files.filter((file) => file.kind === "image").length;
  const videos = state.files.length - images;
  const totalBytes = state.files.reduce((sum, file) => sum + (file.size || 0), 0);
  fileSummary.textContent = `共 ${state.files.length} 个文件 · 图片 ${images} · 视频 ${videos} · 合计 ${formatBytes(totalBytes)}`;

  fileRows.innerHTML = state.files.map((file) => {
    const checked = state.selected.has(file.id);
    const disabled = Boolean(file.error);
    const target = state.targets.get(file.id) ?? file.currentLocal ?? "";
    const directory = file.relativePath.includes("/")
      ? file.relativePath.slice(0, file.relativePath.lastIndexOf("/"))
      : "";
    const extension = file.name.includes(".") ? file.name.split(".").pop() : "";
    const sourceClass = file.error
      ? "error"
      : file.currentSource === "metadata" ? "metadata" : file.currentSource === "file" ? "file" : "unknown";
    const sourceText = file.error
      ? "读取失败"
      : file.currentSource === "metadata" ? "元数据" : file.currentSource === "file" ? "文件时间" : "未知";
    const status = disabled
      ? `<span class="status error">读取失败</span><span class="status-note">${escapeHtml(file.error || "无法读取")}</span>`
      : '<span class="status pending">待处理</span>';
    const targetChanged = Boolean(target) && (!file.currentLocal || target !== file.currentLocal);
    const targetHint = !target ? "未设置" : targetChanged ? "将修改" : "未修改";

    return `
      <tr data-id="${escapeHtml(file.id)}" class="${disabled ? "is-error" : ""}">
        <td class="col-check">
          <input class="row-check" type="checkbox" aria-label="选择 ${escapeHtml(file.name)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
        </td>
        <td>
          <div class="file-name" title="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)}</div>
          ${directory ? `<div class="file-path" title="${escapeHtml(directory)}">${escapeHtml(directory)}</div>` : ""}
        </td>
        <td>
          <span class="type-badge ${file.kind}">${file.kind === "image" ? "图片" : "视频"}</span>
          <span class="ext">${escapeHtml(extension)}</span>
        </td>
        <td>${formatBytes(file.size)}</td>
        <td>
          <div class="date-now">${escapeHtml(file.currentDisplay)}</div>
          <span class="source-badge ${sourceClass}">${sourceText}</span>
        </td>
        <td>
          <input class="target-input" type="datetime-local" value="${escapeHtml(target)}" data-current="${escapeHtml(file.currentLocal || "")}" aria-label="${escapeHtml(file.name)} 的目标日期" ${disabled ? "disabled" : ""}>
          <span class="target-hint ${targetChanged ? "changed" : ""}">${targetHint}</span>
        </td>
        <td class="status-cell">${status}</td>
      </tr>
    `;
  }).join("");

  emptyState.hidden = state.files.length > 0;
  updateSelectionUi();
}

async function scan() {
  if (state.busy) return;
  const sourceDir = sourceInput.value.trim();
  const outputRoot = outputInput.value.trim() || outputInput.placeholder;
  if (!sourceDir) {
    showScanError("请先选择源文件夹。");
    return;
  }
  if (!outputRoot) {
    showScanError("请先选择输出文件夹。");
    return;
  }

  const changingSource = normalizePath(sourceDir) !== normalizePath(state.sourceDir);
  if (changingSource) resetScanResults();

  setBusy(true);
  scanBtn.textContent = "扫描中…";
  showScanMessage("正在读取文件日期，请稍候…", "info");

  try {
    const data = await api("/api/scan", {
      method: "POST",
      body: JSON.stringify({ sourceDir, outputRoot }),
    });
    state.sourceDir = data.sourceDir;
    state.outputRoot = data.outputRoot;
    state.files = data.files;
    state.selected = new Set(data.files.filter((file) => !file.error).map((file) => file.id));
    state.targets = new Map(data.files.filter((file) => !file.error).map((file) => [file.id, file.currentLocal || ""]));
    sourceInput.value = data.sourceDir;
    outputInput.value = data.outputRoot;
    storageSet("timepostman.sourceDir", data.sourceDir);
    storageSet("timepostman.outputRoot", data.outputRoot);
    renderFiles();
    filesSection.hidden = false;
    resultSection.hidden = true;
    progressWrap.hidden = true;
    const batch = data.phoneBatch;
    if (data.phoneBatchMissing) {
      showScanMessage("手机传入文件夹里没有新的上传批次，旧文件已忽略。请在手机上重新上传。", "info");
    } else if (batch) {
      const time = batch.uploadedAt
        ? new Date(batch.uploadedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        : "";
      const unsupported = Array.isArray(data.unsupportedFiles) ? data.unsupportedFiles : [];
      const types = [...new Set(unsupported.map((file) => file.ext.toUpperCase()))].filter(Boolean).join("/");
      const note = unsupported.length > 0
        ? ` 另有 ${unsupported.length} 个 ${types} 文件无法修改图库日期，已忽略。`
        : "";
      showScanMessage(
        `扫描完成：本次手机上传${time ? `（${time}）` : ""}共 ${batch.count} 个文件，找到 ${data.count} 个。${note}`,
        note ? "info" : "success",
      );
      showToast(`本次手机上传共 ${batch.count} 个文件，已扫描 ${data.count} 个。`, "success");
    } else {
      showScanMessage(`扫描完成：找到 ${data.count} 个文件。`, "success");
      showToast(`扫描完成，共 ${data.count} 个文件。`, "success");
    }
    filesSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showScanError(error.message);
  } finally {
    scanBtn.textContent = "扫描文件";
    setBusy(false);
  }
}

async function browseFolder(input, button) {
  if (!state.canBrowse) {
    showToast("当前系统不支持原生文件夹选择，请手动输入路径。", "error");
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "选择中…";
  try {
    const data = await api("/api/browse-folder", { method: "POST", body: "{}" });
    if (data.path) {
      input.value = data.path;
      input.dispatchEvent(new Event("change"));
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.textContent = original;
    button.disabled = state.busy || !state.canBrowse;
  }
}

function setAllSelected(checked) {
  const selectable = state.files.filter((file) => !file.error);
  state.selected = new Set(checked ? selectable.map((file) => file.id) : []);
  for (const checkbox of fileRows.querySelectorAll(".row-check")) {
    if (!checkbox.disabled) checkbox.checked = checked;
  }
  updateSelectionUi();
}

function applyBulkDate() {
  const value = bulkDate.value;
  if (!value) {
    showToast("请先选择一个批量日期。", "error");
    return;
  }
  let count = 0;
  for (const row of fileRows.querySelectorAll("tr[data-id]")) {
    const id = row.dataset.id;
    if (!state.selected.has(id)) continue;
    const input = row.querySelector(".target-input");
    if (!input || input.disabled) continue;
    state.targets.set(id, value);
    input.value = value;
    updateTargetHint(input);
    count += 1;
  }
  if (count === 0) {
    showToast("请先勾选要修改的文件。", "error");
    return;
  }
  showToast(`已把 ${count} 个文件的目标日期设为 ${formatInputDate(value)}。`, "success");
}

function resetDates() {
  for (const row of fileRows.querySelectorAll("tr[data-id]")) {
    const file = state.files.find((item) => item.id === row.dataset.id);
    const input = row.querySelector(".target-input");
    if (!file || !input || input.disabled) continue;
    const value = file.currentLocal || "";
    state.targets.set(file.id, value);
    input.value = value;
    updateTargetHint(input);
  }
  showToast("已恢复为每个文件的当前日期。", "success");
}

function markRowProcessing(relativePath) {
  const row = fileRows.querySelector(`tr[data-id="${CSS.escape(relativePath)}"]`);
  if (!row) return;
  const cell = row.querySelector(".status-cell");
  if (cell) cell.innerHTML = '<span class="status processing">处理中</span>';
}

function markRowStatus(result) {
  const row = fileRows.querySelector(`tr[data-id="${CSS.escape(result.relativePath)}"]`);
  if (!row) return;
  const cell = row.querySelector(".status-cell");
  if (!cell) return;
  if (result.status === "ok") {
    const file = state.files.find((item) => item.relativePath === result.relativePath);
    const unchanged = result.changed && file?.currentLocal && result.targetLocal === file.currentLocal;
    const note = !result.changed ? "只复制，未改日期" : unchanged ? "日期未变" : "日期已写入";
    cell.innerHTML = `<span class="status ok">已完成</span><span class="status-note">${note}</span>`;
  } else {
    cell.innerHTML = `<span class="status error">失败</span><span class="status-note">${escapeHtml(result.error || "未知错误")}</span>`;
  }
}

function updateJobRows(job) {
  const resultMap = new Map(job.results.map((result) => [result.relativePath, result]));
  for (const file of state.files) {
    const result = resultMap.get(file.relativePath);
    if (result) {
      markRowStatus(result);
    } else if (job.status === "running" && job.current === file.relativePath) {
      markRowProcessing(file.relativePath);
    }
  }
}

async function pollJob() {
  if (!state.jobId) return;
  try {
    const job = await api(`/api/jobs/${state.jobId}`);
    const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
    progressFill.style.width = `${percent}%`;
    const currentName = job.current ? job.current.split("/").pop() : "";
    if (job.status === "running") {
      progressText.textContent = `正在处理 ${Math.min(job.done + 1, job.total)} / ${job.total}${currentName ? `：${currentName}` : ""}`;
      updateJobRows(job);
      state.pollTimer = setTimeout(pollJob, 650);
      return;
    }
    if (job.status === "error") {
      progressText.textContent = "处理失败";
      showToast(job.error || "处理失败。", "error");
      finishProcessing();
      return;
    }
    progressFill.style.width = "100%";
    progressText.textContent = `已完成 ${job.done} / ${job.total}`;
    updateJobRows(job);
    finishJob(job);
  } catch (error) {
    showToast(error.message, "error");
    finishProcessing();
  }
}

async function startProcess() {
  if (state.busy) return;
  if (normalizePath(sourceInput.value) !== normalizePath(state.sourceDir)) {
    showToast("源文件夹已改变，请重新扫描。", "error");
    return;
  }
  const outputRoot = outputInput.value.trim();
  if (!outputRoot) {
    showToast("请先选择输出文件夹。", "error");
    return;
  }
  const items = state.files
    .filter((file) => !file.error && state.selected.has(file.id))
    .map((file) => ({
      relativePath: file.relativePath,
      targetLocal: state.targets.get(file.id) || "",
    }));
  if (items.length === 0) {
    showToast("请先勾选要处理的文件。", "error");
    return;
  }

  const unchangedCount = items.filter((item) => {
    const sourceFile = state.files.find((file) => file.relativePath === item.relativePath);
    return Boolean(sourceFile?.currentLocal) && item.targetLocal === sourceFile.currentLocal;
  }).length;
  if (unchangedCount === items.length) {
    const proceed = window.confirm("所有已选文件的目标日期都与当前日期相同，处理不会改变图库日期。仍要继续吗？");
    if (!proceed) return;
  } else if (unchangedCount > 0) {
    const proceed = window.confirm(`有 ${unchangedCount} 个文件的目标日期没有变化，其余会修改。继续？`);
    if (!proceed) return;
  }

  state.processBusy = true;
  state.outputDir = "";
  resultSection.hidden = true;
  progressWrap.hidden = false;
  progressFill.style.width = "0%";
  progressText.textContent = "准备处理…";
  processBtn.textContent = "处理中…";
  setBusy(true);

  for (const row of fileRows.querySelectorAll("tr[data-id]")) {
    if (!state.selected.has(row.dataset.id)) continue;
    const cell = row.querySelector(".status-cell");
    if (cell) cell.innerHTML = '<span class="status pending">待处理</span>';
  }

  try {
    const data = await api("/api/process", {
      method: "POST",
      body: JSON.stringify({
        sourceDir: state.sourceDir,
        outputRoot,
        items,
      }),
    });
    state.jobId = data.jobId;
    pollJob();
  } catch (error) {
    showToast(error.message, "error");
    finishProcessing();
  }
}

function finishProcessing() {
  state.busy = false;
  state.processBusy = false;
  state.jobId = "";
  setBusy(false);
  processBtn.textContent = "开始处理";
  updateProcessButton();
}

function finishJob(job) {
  state.outputDir = job.outputDir;
  state.processBusy = false;
  state.jobId = "";
  state.busy = false;
  setBusy(false);
  updateProcessButton();

  const succeeded = job.results.filter((result) => result.status === "ok").length;
  const failed = job.results.length - succeeded;
  const unchangedCount = job.results.filter((result) => {
    if (result.status !== "ok" || !result.changed) return false;
    const file = state.files.find((item) => item.relativePath === result.relativePath);
    return Boolean(file?.currentLocal) && result.targetLocal === file.currentLocal;
  }).length;
  resultSummary.textContent = `成功 ${succeeded} 个，失败 ${failed} 个。副本已生成，原文件没有改动。${unchangedCount > 0 ? `其中 ${unchangedCount} 个目标日期与原日期相同，图库日期不会变化。` : ""}`;
  outputDirLabel.textContent = job.outputDir;
  outputDirLabel.title = job.outputDir;
  refreshOutputSummary();

  resultDetails.innerHTML = job.results.map((result) => {
    if (result.status === "ok") {
      const file = state.files.find((item) => item.relativePath === result.relativePath);
      const unchanged = result.changed && file?.currentLocal && result.targetLocal === file.currentLocal;
      const actual = result.actualLocal ? result.actualLocal.replace("T", " ") : formatInputDate(result.targetLocal);
      const note = !result.changed
        ? "已复制，未改日期"
        : unchanged
          ? `目标日期与当前日期相同（${actual}），没有发生变化`
          : `已写入 ${actual}`;
      const outputName = result.output ? result.output.split("/").pop() : "";
      return `
        <div class="result-item">
          <span class="result-icon" aria-hidden="true"></span>
          <div class="result-body">
            <div class="result-path">${escapeHtml(result.relativePath)}</div>
            <div class="result-note">${escapeHtml(note)}${outputName ? ` · 输出：${escapeHtml(outputName)}` : ""}</div>
          </div>
        </div>
      `;
    }
    return `
      <div class="result-item error">
        <span class="result-icon" aria-hidden="true"></span>
        <div class="result-body">
          <div class="result-path">${escapeHtml(result.relativePath)}</div>
          <div class="result-note">${escapeHtml(result.error || "处理失败")}</div>
        </div>
      </div>
    `;
  }).join("");

  resultSection.hidden = false;
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(
    failed > 0 ? `处理完成：成功 ${succeeded} 个，失败 ${failed} 个。` : `处理完成：${succeeded} 个文件已生成。`,
    failed > 0 ? "error" : "success",
  );
}

async function openOutputFolder() {
  if (!state.outputDir) return;
  try {
    await api("/api/open-folder", {
      method: "POST",
      body: JSON.stringify({ path: state.outputDir }),
    });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function refreshOutputSummary() {
  const outputRoot = outputInput.value.trim() || outputInput.placeholder;
  if (!outputRoot) {
    outputSummary.textContent = "未设置输出目录。";
    return;
  }
  try {
    const data = await api("/api/outputs/summary", {
      method: "POST",
      body: JSON.stringify({ outputRoot }),
    });
    outputSummary.textContent = data.runs > 0
      ? `输出目录：${data.runs} 批 · ${formatBytes(data.totalBytes)}（清理时保留最近 3 批）`
      : "输出目录还没有处理结果。";
  } catch (error) {
    outputSummary.textContent = `输出统计失败：${error.message}`;
  }
}

async function cleanupOutputs() {
  const outputRoot = outputInput.value.trim() || outputInput.placeholder;
  if (!outputRoot) {
    showToast("请先设置输出目录。", "error");
    return;
  }
  try {
    const summary = await api("/api/outputs/summary", {
      method: "POST",
      body: JSON.stringify({ outputRoot }),
    });
    if (summary.runs <= 3) {
      showToast(`只有 ${summary.runs} 批输出，不需要清理。`, "success");
      return;
    }
    const toRemove = summary.runs - 3;
    const confirmed = window.confirm(
      `将保留最近 3 批输出，删除其余 ${toRemove} 批（共 ${formatBytes(summary.totalBytes)}，只删输出副本，不影响原文件）。继续？`,
    );
    if (!confirmed) return;
    const result = await api("/api/outputs/cleanup", {
      method: "POST",
      body: JSON.stringify({ outputRoot, keepLatest: 3 }),
    });
    showToast(`已清理 ${result.removed} 批，释放 ${formatBytes(result.freedBytes)}。`, "success");
    await refreshOutputSummary();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function applyDatePreset(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value) => String(value).padStart(2, "0");
  const value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T12:00`;
  bulkDate.value = value;
  showToast(`已填入 ${value.replace("T", " ")}，点“应用到已选”生效。`, "success");
}

function bindEvents() {
  browseSourceBtn.addEventListener("click", () => browseFolder(sourceInput, browseSourceBtn));
  browseOutputBtn.addEventListener("click", () => browseFolder(outputInput, browseOutputBtn));
  scanBtn.addEventListener("click", scan);
  phoneInboxBtn.addEventListener("click", () => {
    if (!state.phoneInbox) {
      showToast("没有配置手机传入文件夹。", "error");
      return;
    }
    sourceInput.value = state.phoneInbox;
    sourceInput.dispatchEvent(new Event("change"));
    scan();
  });
  denyPairingBtn.addEventListener("click", async () => {
    if (!state.pairingRequestId) return;
    try {
      await api("/api/phone-pair/deny", {
        method: "POST",
        body: JSON.stringify({ requestId: state.pairingRequestId }),
      });
    } catch {
      // The transfer service may be offline; just hide the banner.
    }
    state.pairingRequestId = "";
    pairingBanner.hidden = true;
  });
  clearInboxBtn.addEventListener("click", async () => {
    if (!state.phoneInbox) return;
    if (!window.confirm("确定清空 phone-inbox 里的手机上传文件？已处理的输出不受影响。")) return;
    try {
      await api("/api/phone-inbox/clear", { method: "POST", body: "{}" });
      resetScanResults();
      showScanMessage("已清空手机传入文件夹。", "success");
      showToast("已清空手机传入文件夹。", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  sourceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") scan();
  });
  sourceInput.addEventListener("change", () => {
    storageSet("timepostman.sourceDir", sourceInput.value.trim());
    if (state.files.length > 0 && normalizePath(sourceInput.value) !== normalizePath(state.sourceDir)) {
      resetScanResults();
      showScanMessage("源文件夹已改变，请重新扫描。", "info");
    }
  });
  outputInput.addEventListener("change", () => {
    storageSet("timepostman.outputRoot", outputInput.value.trim());
  });
  bulkDate.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyBulkDate();
  });
  applyBulkBtn.addEventListener("click", applyBulkDate);
  for (const button of document.querySelectorAll(".date-preset")) {
    button.addEventListener("click", () => {
      applyDatePreset(Number(button.dataset.offset) || 0);
    });
  }
  resetDatesBtn.addEventListener("click", resetDates);
  selectAll.addEventListener("change", () => setAllSelected(selectAll.checked));
  processBtn.addEventListener("click", startProcess);
  openFolderBtn.addEventListener("click", openOutputFolder);
  cleanupOutputsBtn.addEventListener("click", cleanupOutputs);
  outputInput.addEventListener("change", () => {
    refreshOutputSummary();
  });

  fileRows.addEventListener("change", (event) => {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (event.target.classList.contains("row-check")) {
      if (event.target.checked) state.selected.add(id);
      else state.selected.delete(id);
      updateSelectionUi();
    }
  });
  fileRows.addEventListener("input", (event) => {
    if (!event.target.classList.contains("target-input")) return;
    const row = event.target.closest("tr[data-id]");
    if (row) state.targets.set(row.dataset.id, event.target.value);
    updateTargetHint(event.target);
  });
}

async function init() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`配置读取失败（${response.status}）`);
    const config = await response.json();
    state.token = config.token;
    state.platform = config.platform;
    state.canBrowse = config.platform === "win32";
    state.phoneInbox = config.phoneInbox || "";
    if (!state.phoneInbox) {
      phoneInboxBtn.hidden = true;
      clearInboxBtn.hidden = true;
    }
    state.outputRoot = storageGet("timepostman.outputRoot") || config.defaultOutputRoot;
    outputInput.value = state.outputRoot;
    const versionLabel = document.querySelector("#appVersion");
    if (versionLabel) versionLabel.textContent = `v${config.version || "?"}`;
    sourceInput.value = storageGet("timepostman.sourceDir");
    if (!state.canBrowse) {
      browseSourceBtn.disabled = true;
      browseOutputBtn.disabled = true;
      browseSourceBtn.title = "当前系统请手动输入路径";
      browseOutputBtn.title = "当前系统请手动输入路径";
    }
    bindEvents();
    refreshOutputSummary();
    updateProcessButton();
    pollPairing();
    setInterval(() => {
      if (state.token) pollPairing();
    }, 3000);
  } catch (error) {
    showToast(error.message || "无法连接本地服务，请确认 npm run app 仍在运行。", "error");
  }
}

init();
