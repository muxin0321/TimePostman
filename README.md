# TimePostman

在鸿蒙 NEXT 系统图库里修正照片/视频日期的本地工具。

项目已经走过可行性验证阶段，现在包含：

- **PC 本地网页版 MVP**：扫描文件夹、预览当前日期、批量设置目标日期、导出改好日期的副本。
- **验证脚本**：用于确认鸿蒙 NEXT 图库到底认哪一层时间，保留作回归测试和格式验证。

核心假设已经被真机验证：

> **在文件进入图库之前，把内嵌元数据和文件时间设好，鸿蒙 NEXT 图库会按这个时间显示和排序。**

验证覆盖了合成样本和真实文件（华为相机 JPG、微信 JPG、华为相机 MP4、微信 MP4），测试设备为 Mate 70 Pro+ / HarmonyOS 7.0.0.109 SP6。详见后面的“真机验证结果”。

## PC MVP（本地网页版）

已经可以直接使用。它在本机启动一个只监听 `127.0.0.1` 的网页，扫描文件夹、读取当前日期、批量设置目标日期、生成改好日期的副本。

### 启动

日常使用直接双击项目根目录的 `start.bat`；它会同时启动网页端和手机互传服务，并自动打开 `http://127.0.0.1:4317`。首次运行会自动安装依赖。

也可以在终端运行：

```bash
npm install
npm run start:all
```

保持窗口打开；关闭窗口或按 Ctrl+C 会同时停止两个服务。调试时可以分开运行 `npm run app` 和 `npm run phone:transfer`。

桌面快捷方式已创建：桌面上的 `TimePostman` 正常启动并打开网页；登录 Windows 时会通过启动文件夹里的 “TimePostman Service” 静默启动两个服务、不弹浏览器。不需要开机自启时，删除 `shell:startup` 里的这个快捷方式即可。

### 输出目录维护

第一个步骤卡片底部会显示输出目录的批次数和占用空间；点“清理旧输出”会保留最近 3 批，删除更早的副本（只删 `TimePostman-*` 输出，不影响原文件）。

### 使用流程

1. 选择源文件夹（原始照片/视频，不会被改动）和输出文件夹（默认项目下的 `exports/`）。
2. 点“扫描文件”。表格会显示每个文件的当前日期和来源（元数据/文件时间）。
3. 目标日期默认等于当前日期。要改日期，可以用“快捷日期”（今天/昨天/一周前/一月前/一年前）快速填入，再点“应用到已选”；也可以直接改单行目标日期。目标列会显示“将修改/未修改”。
4. 点“开始处理”。每个文件会复制到 `输出文件夹/TimePostman-时间/`，文件名保留原名并追加 `_TimePostman`（例如 `IMG_001_TimePostman.jpg`），写入目标日期并回读确认。如果目标日期没变，结果会提示“日期未变”。
5. 处理完成后点“打开输出文件夹”，把文件传到鸿蒙手机，再保存或移入系统图库。

### 它会写什么

- **照片**：EXIF `DateTimeOriginal` / `CreateDate` / `ModifyDate`、`OffsetTime*`、XMP DateCreated，以及系统文件创建/修改时间。
- **视频**：影片级 `mvhd`、轨道级 `TrackCreateDate` / `TrackModifyDate`、媒体级 `MediaCreateDate` / `MediaModifyDate`、`Keys:CreationDate`，以及系统文件时间。
- 所有目标时间按 UTC+8 解释；每次处理生成新的输出子文件夹，不覆盖原文件。

### 已验证与未验证

- 已在 HarmonyOS NEXT（Mate 70 Pro+ / 7.0.0.109 SP6）真机验证：JPG、MP4，包含华为相机和微信保存的真实文件。
- 手机端视频保存已真机验证：MP4 + JPG 一起上传、日期改到 2026-10-09 11:06，图库显示正确。
- 传输测速：USB 单流上传约 19MB/s、下载约 25MB/s；Wi-Fi 跨子网约 4.5–4.8MB/s（链路总带宽限制）。多连接并行实测无提升，已移除，统一单流传输。
- PC 端写入已额外验证 PNG、MOV；手机端 PNG、MP4 已随混合批次真机验证，MOV 和 HEIC 尚未真机验证（HEIC 当前不测）。GIF/WebP 真机确认图库不采用内嵌日期，手机端会自动跳过。
- 最小双向互传已真机验证通过：手机上传 → PC 改日期 → 手机下载并 `SaveButton` + `createAsset` 保存，图库日期正确。
- 互传服务只接受配对令牌；旧版硬编码测试 token 已移除。

### 常见问题

**处理后图库日期没变？**

先看目标日期是不是还等于当前日期。目标列默认是“未修改”，需要先在“批量设为”里选一个新日期并点“应用到已选”，或直接改单行目标日期；改过的行会显示“将修改”。如果所有目标都没变，应用会弹确认，处理结果也会标注“日期未变”。

**出现 ExifTool MakerNote 警告怎么办？**

华为相机照片经常会触发 `Duplicate MakerNoteUnknown tag` 结构警告，它不影响日期字段。工具现在会在写入后回读实际日期，结果里显示的是回读值；这类已知警告不会出现在主结果里。

**手机图库还是旧日期？**

如果图库已经有同名照片，手机可能显示的是旧条目，而不是新传进去的副本。把输出文件改成唯一文件名，或者放进一个新相册再检查。之前的验证测试用的是 `p01-metaA-mtimeB.jpg` 这类唯一文件名，所以没有这个干扰。

**上传中断或上传失败会破坏上一批吗？**

不会。新批次先写入 `phone-inbox/.incoming/` 临时目录，整批接收成功后才替换旧批次；中断时旧文件和批次清单保持不变，临时文件会自动清理。

**重复上传同名文件会变成 `xxx-2.jpg` 吗？**

不会。新批次替换旧批次时会保留原名；只有同一批里出现两个完全同名的文件才会加 `-2`。

**重启电脑端后网页报令牌无效？**

应用服务器每次启动都会生成新的页面会话令牌，刷新浏览器页面即可；手机端的配对令牌保存在 `paired-devices.json`，不受影响。

**关掉窗口后手机连不上？**

日期编辑器和互传服务由 `start.bat` / `startup.bat` 一起启动；关闭启动窗口会同时停止两个服务。重新双击桌面 `TimePostman` 即可。

### 代码结构

- `app/server.mjs`：本地 HTTP 服务、扫描/处理 API、任务进度、输出清理。
- `app/lib/media-dates.mjs`：媒体扫描、日期读取、元数据写入。
- `app/public/`：网页界面。
- `phone-transfer/server.mjs`：局域网互传、配对、上传暂存与批次替换。
- `phone-receiver/entry/src/main/ets/model/Types.ets`：共享类型和常量。
- `phone-receiver/entry/src/main/ets/service/PcLink.ets`：网络与配对、偏好存储、上传/下载。
- `phone-receiver/entry/src/main/ets/service/MediaCache.ets`：格式识别、缓存暂存与清理。
- `phone-receiver/entry/src/main/ets/service/GallerySaver.ets`：缓存文件写入系统图库。
- `phone-receiver/entry/src/main/ets/components/`：状态卡、连接卡、上传卡、结果卡等 UI 组件。
- `phone-receiver/entry/src/main/ets/pages/Index.ets`：页面状态编排（约 586 行）。
- `scripts/verify.mjs`：可行性验证 CLI，保留用于回归测试和格式验证。

## 手机双向互传（最小闭环已验证）

**2026-10-22 真机验证通过**：手机上传照片 → 电脑改日期 → 手机刷新/下载 → 系统 SaveButton + `createAsset` 保存，图库日期正确。最小双向闭环成立。

**2026-10-22 批量验证**：11 张照片一次上传成功；手机端一次保存全部成功。服务端上传上限已从 10 修到 30（`upload.array` 的 maxCount 之前漏改），SaveButton 10 秒临时授权窗口足够 11 张小图；失败项保留重试逻辑保留。

**2026-10-23 扩展名修复 + 18/18 通过**：批量 18 张里 13 张 JPG 成功、5 张失败，原因是这 5 张实际是 JPEG 内容但被手机按 URI 后缀命名成 `.png`，ExifTool 拒绝把 PNG 元数据写进 JPEG。手机端改为按文件头识别 JPG/PNG/HEIC；PC 端输出也加了扩展名归一化作为兜底。5 张重新上传后全部成功，18/18 通过。华为 MakerNote 警告是良性提示，不影响日期；PC 结果页现在只显示实际写入日期，成功项不再展示 ExifTool 警告，失败项仍显示错误。

补充：`SaveButton` + `createAsset` 保存的测试图在图库显示 **2020-01-02 12:00**，说明图库会采用文件内嵌 EXIF。

当前最小闭环：

1. 手机 App 选择照片，上传到电脑的 `phone-inbox/`；
2. 电脑网页端点“手机传入”，只扫描最新上传批次（新批次先传临时目录，成功后整体替换旧副本；同名文件可保留原名），扫描、设置目标日期、处理；
3. 手机 App 刷新电脑结果，下载处理后的文件；
4. 手机用系统 SaveButton + `createAsset` 批量保存到图库。

启动：

```bash
# 推荐：一键启动两个服务并打开网页
npm run start:all

# 或双击项目根目录的 start.bat
# 调试时可分开运行：npm run app / npm run phone:transfer
```

### 首次配对（自动发现 / 手动 IP）

- 手机和电脑在同一 Wi-Fi：手机 App 点“发现电脑”，选中电脑后点“配对”。
- 电脑页面顶部会出现配对横幅和 6 位配对码；在手机 App 输入配对码确认。
- USB 测试：先运行 `hdc rport tcp:8787 tcp:8787`，手机 App 手动输入 `127.0.0.1`，点“用 IP 配对”，配对码同样在电脑页面看。
- 配对成功后双方保存 token（电脑在 `phone-transfer/paired-devices.json`），之后自动连接，不用每次输入。
- 自动发现使用 UDP `8786`；如果路由器 AP 隔离或防火墙导致发现不到，用手动 IP 兜底。Windows 防火墙请允许“专用网络”。

手机工程 `phone-receiver/` 已改成“发现/配对 + 上传/回传”界面，signed HAP 已构建。具体步骤见 `phone-receiver/README.md`。互传服务只监听局域网，不要把端口暴露到公网。

## 为什么不在手机上直接改

鸿蒙 NEXT 的媒体库日期字段（`dateTaken` / `dateAdded` / `dateModified`）是只读的，视频也没有公开的元数据写入接口。即使手机端能改 EXIF，图库也可能已经缓存了旧日期，不一定立刻重排。

所以这个方案把“修改”提前到文件入库之前：PC 端负责改文件内部的 EXIF / MP4 容器时间，手机端只需要接收并原样保存。

## 验证脚本：快速开始

环境要求：Node.js 20+。项目自带 ExifTool 和 FFmpeg 二进制，不需要单独安装。下面的命令用于可行性验证，不是日常使用入口；日常使用请运行 `start.bat` 或 `npm run start:all`。

```bash
npm install
npm run verify:doctor
npm run verify:all
```

`verify:all` 会：

1. 检查 Node、ExifTool、FFmpeg；
2. 如果 `samples/input/` 为空，生成 JPG / MP4 / MOV 合成样本；
3. 按测试矩阵生成文件变体；
4. 回读每个文件，确认 PC 端写入正确。

产物在：

```
samples/output/run-<时间>/media/
```

**只把 `media/` 里的文件传到手机。** 同目录下的 `manifest.md`、`manifest.csv`、`README.txt` 留在电脑上看。

### 用你自己的真实文件复测

合成样本已经证明了图库规则。真实文件复测是为了确认各格式的元数据写入和读取，尤其是微信文件和 HEIC。

推荐做法：

1. 把以下真实文件放进 `samples/real/`，可以只放一部分：
   - 微信保存的 JPG（日期变成保存日期的那种）
   - 微信保存的 MP4（日期显示很久以前的那种）
   - 华为相机拍摄的照片：HEIC 优先；如果相机默认是 JPG，用相机 JPG 也可以
   - 华为相机拍摄的视频：通常是 MP4；如果有 iPhone 拍的 MOV，再额外加一段
   - 可选：PNG 截图
2. 运行：

```bash
npm run verify:real
```

它会处理 `samples/real/` 里的所有文件，生成新的 `run-*/media/`，并自动回读检查。

3. 只把新 run 的 `media/` 传到手机，重复上面的真机步骤。

也可以指定任意目录：

```bash
node scripts/verify.mjs prepare --input "D:\MediaTest"
npm run verify:inspect
```

支持：JPG / JPEG / HEIC / HEIF / PNG / MP4 / MOV / M4V。GIF/WebP 可以写入元数据，但鸿蒙图库不采用其内嵌日期，已改为自动跳过。

真实视频会复制 3 份，先用几十秒的短视频，避免占用太多磁盘。HEIC 必须是真实文件；FFmpeg 不生成 HEIC。

## 测试矩阵

脚本使用两个固定日期，都选在中午 12 点：

- **A** = `2017-04-09 12:00:00`（UTC+8）
- **B** = `2022-09-18 12:00:00`（UTC+8）

中午 12 点是为了避免时区换算跨天：照片 EXIF 存本地时间，视频 `mvhd` 存 UTC，差 8 小时也不会改变日期。

每个输入文件会生成以下变体：

| 变体 | 内嵌元数据 | 文件时间 | 用途 |
| --- | --- | --- | --- |
| `bothA` | A | A | 基础对照：至少要知道 A 能不能正常显示 |
| `metaA-mtimeB` | A | B | 关键组：看图库优先认元数据还是文件时间 |
| `metaB-mtimeA` | B | A | 反向关键组：交叉验证，排除偶然 |
| `nodate-mtimeA` | 删除所有时间元数据 | A | 仅图片：看图库是否回退到文件时间 |

视频没有 `nodate` 变体，因为删除 `mvhd` 时间会破坏容器语义。

文件名里的 `p01` / `v01` 是编号，`metaA-mtimeB` 等是变体，**故意不含日期**，避免图库按文件名解析日期。原始文件名和所有时间记录在 `manifest.csv` / `manifest.md` 里。

## 真机测试步骤（HarmonyOS NEXT）

1. 在电脑上打开 `samples/output/run-<时间>/media/`。
2. 用**华为分享、USB 或系统文件管理**把文件传到手机。优先用华为分享。
   **不要用微信/QQ 转发测试文件**，它们可能重新压缩或改写元数据。
3. 把文件保存进系统图库。
4. 先只测 4 个关键文件，不用一次测 10 个：
   - 照片：`p01-metaA-mtimeB.jpg`、`p01-metaB-mtimeA.jpg`
   - 视频：`v01-metaA-mtimeB.mov`、`v01-metaB-mtimeA.mov`
   - 合成样本里 MP4 和 MOV 两种都有；真实文件以华为相机/微信的 MP4 为主，MOV 是可选补充。
5. 在图库里打开每个文件的详情，确认文件名，记录两件事：
   - **图库显示日期**：详情页/照片上方显示的日期；
   - **时间线位置**：它在“照片”时间线里被分到哪一天。
6. 把观察结果填进 `manifest.csv` 的 `observed_gallery_date` 和 `observed_timeline_position`，或直接填 `manifest.md`。
7. 重启手机后再看一次，确认结果稳定。
8. 有精力再补测 `bothA` 和 `nodate-mtimeA`。

建议在清单里记录：设备型号、HarmonyOS 版本、传输方式、导入时间、是否开启图库云同步。

## 结果判读

先看照片的 `metaA-mtimeB` 和 `metaB-mtimeA` 这一对，再看视频的同一对。

| 观察结果 | 结论 | 下一步 |
| --- | --- | --- |
| `metaA-mtimeB` 显示 A，`metaB-mtimeA` 显示 B | 图库优先读内嵌元数据 | PC 端预处理路线成立。先做 PC 单端 MVP，手机端可以用华为分享代替 |
| `metaA-mtimeB` 显示 B，`metaB-mtimeA` 显示 A | 图库优先读文件时间 | 手机接收端必须在保存前设置 mtime，才能让时间生效。先做最小鸿蒙接收端验证 |
| 两组都显示“当天” | 图库优先用导入时间 | 华为分享路径失败。继续用 SaveButton + createAsset 做最小接收端测试 |
| 照片和视频结论不同 | 两条链路规则不同 | 分开处理：照片走 EXIF，视频走 mvhd 或 mtime |
| 重启后结果变了 | 媒体库重新扫描会影响 | 记录机型和版本，产品承诺要更保守 |
| `bothA` 都不是 A | 还有别的日期来源 | 先别下结论，检查文件名、云同步、图库版本和传输方式 |

补充说明：

- **显示日期和时间线位置可能不一致**。两个都要记录，以时间线位置为准更接近用户感知。
- **`nodate-mtimeA` 只对图片有意义**。它显示 A，说明图库会回退到文件时间；显示当天，说明回退到了导入时间。
- **测试文件不要改名**。改名会破坏和清单的对应关系，也可能引入文件名日期解析。
- **不要在测试期间清理图库数据**。重启一次即可；清理数据会破坏已有图库，且不是你真正要验证的路径。
- **图库云同步可能干扰结果**。如果手机开启了云同步，记录这个状态；有条件的话关闭同步后再测一次。

## 当前已经验证的部分

脚本在你的 Windows 电脑上已经跑通：

- ExifTool 13.59 写入照片 EXIF 日期、XMP 日期和 Windows 文件创建/修改时间；
- 视频用 `QuickTimeUTC=1` 写入 `mvhd` 的 `QuickTime:CreateDate` / `ModifyDate`，并写 `Keys:CreationDate`；
- 额外用 MP4 box parser 直接读取 `mvhd` 原始 UTC 时间，确认容器内时间和 Keys 时间一致；
- 10 个合成样本（1 张图片 + 2 段视频输入）全部通过 PC 端回读检查；
- 修改后的 MP4 / MOV / JPG 都能正常解码。

**鸿蒙 NEXT 图库的真实行为已经验证（2026-10-20）：JPG 和 MP4 都优先采用内嵌元数据，时间线位置也跟随元数据。** 详见下一节。

## 真机验证结果（2026-10-20）

测试设备：

- 机型：HUAWEI Mate 70 Pro+
- 系统：HarmonyOS 7.0.0.109 SP6
- 传输方式：电脑传到手机普通文件夹，再用手机文件管理手动移动到图库文件夹（电脑无法直接写入图库目录）

### 第一轮：合成样本（规则验证）

在 HarmonyOS NEXT 真机上通过系统图库导入，测试了 4 个关键文件：

| 文件 | 元数据 | 文件时间 | 图库显示 | 时间线位置 |
| --- | --- | --- | --- | --- |
| `p01-metaA-mtimeB.jpg` | A = 2017-04-09 12:00 | B = 2022-09-18 12:00 | A | 正确 |
| `p01-metaB-mtimeA.jpg` | B = 2022-09-18 12:00 | A = 2017-04-09 12:00 | B | 正确 |
| `v02-metaA-mtimeB.mp4` | A = 2017-04-09 12:00 | B = 2022-09-18 12:00 | A | 正确 |
| `v02-metaB-mtimeA.mp4` | B = 2022-09-18 12:00 | A = 2017-04-09 12:00 | B | 正确 |

两个方向互相交叉，结果都跟随元数据，排除了偶然。

### 第二轮：真实文件（确认格式链路）

以下文件名来自真实文件运行 `run-20261020-230512`，编号与第一轮合成样本无关：

| 测试文件 | 原始文件 | 元数据 | 文件时间 | 图库显示 | 时间线位置 |
| --- | --- | --- | --- | --- | --- |
| `p01-metaA-mtimeB.jpg` | 华为相机.jpg | A | B | A | 正确 |
| `p01-metaB-mtimeA.jpg` | 华为相机.jpg | B | A | B | 正确 |
| `p02-metaA-mtimeB.jpg` | 微信保存.jpg | A | B | A | 正确 |
| `p02-metaB-mtimeA.jpg` | 微信保存.jpg | B | A | B | 正确 |
| `v01-metaA-mtimeB.mp4` | 华为相机.mp4 | A | B | A | 正确 |
| `v01-metaB-mtimeA.mp4` | 华为相机.mp4 | B | A | B | 正确 |
| `v02-metaA-mtimeB.mp4` | 微信保存.mp4 | A | B | A | 正确 |
| `v02-metaB-mtimeA.mp4` | 微信保存.mp4 | B | A | B | 正确 |

真实文件也全部通过，覆盖华为相机 JPG、微信 JPG、华为相机 MP4、微信 MP4。

结论：

- **HarmonyOS NEXT 图库对 JPG 和 MP4 都优先采用文件内嵌元数据，而不是文件修改时间。**
- **时间线位置也跟随元数据日期。**
- 真实视频里除了影片级 `mvhd`，还有不为零的轨道级/媒体级日期；把这些字段也写入后，图库仍然采用目标日期。
- 手机端不需要为了改日期去修改系统媒体库；PC 端预处理路线成立。
- 先用 PC 单端工具 + 文件传输（必要时在手机文件管理里移入图库目录）即可完成核心价值。手机 App / 局域网传输是体验增强，不是必需。

还要注意：

- 这次没有测 HEIC（华为相机当前保存为 JPG）和真实 MOV（合成 MOV 已通过）；这两种格式后续可以补测。
- 具体是 `mvhd` 还是 `Keys:CreationDate` 被读取并不重要，工具同时写了两者；JPG 则同时写了 EXIF 和 XMP。
- 不同 HarmonyOS NEXT 版本、机型、图库云同步状态可能不同，验证记录里要写清设备信息。
- 这次是通过文件管理移动进图库目录，不是通过 `createAsset` 入库；如果后续做手机接收端，仍需单独验证接收端的保存路径。
- 电脑无法直接写入图库目录，手动移动是一个真实的体验摩擦点；这也是后续做手机接收端的价值所在。

## 下一步路线

当前真机结果落在结果 1，PC MVP 已经完成。后续路线如下。

### 结果 1：图库认内嵌元数据（已确认，JPG/MP4）

已完成本地网页版 MVP：

1. 选择源文件夹和输出文件夹；
2. 扫描并显示当前日期与来源；
3. 单文件或批量设置目标日期；
4. 生成改好日期的副本，显示处理进度；
5. 处理完打开输出文件夹，传到手机。

接下来：

1. 用你的真实相册小批量试用（先 10-30 个），确认流程和性能；
2. 补测 HEIC、PNG、MOV，再决定是否需要在界面上标注格式限制；
3. 如果手动移入图库目录的摩擦明显，再做手机接收端 + 局域网传输；
4. 手机接收端先验证 SaveButton + createAsset 的保存路径，再决定是否投入双端开发。

手机端最小接收端已经验证通过：`createAsset` 会采用内嵌日期。下一步可以做完整的双向互传（手机上传 → PC 改日期 → 回传保存），但完整互传的复杂度仍然需要单独评估。

### 结果 2：图库认文件时间（当前 JPG/MP4 不是这条路径）

写一个最小鸿蒙 NEXT 接收端：

- 用 SaveButton 安全控件获得临时写入权限；
- 用 `photoAccessHelper.createAsset` + `fileIo` 保存文件；
- 在保存前尝试设置临时文件的 mtime（需要验证 `@ohos.file.fs` 是否提供 `utimes` 等接口）；
- 再测图库是否按 mtime 显示。

如果接收端能做到，架构就是“PC 改元数据 + 局域网传文件 + 手机端设置 mtime 后入库”。

### 结果 3：图库认导入时间

继续测最小接收端的 `createAsset` 路径：

- 如果接收端保存后仍显示导入时间，说明“让系统图库按指定日期显示”这个承诺在公开 API 下不成立；
- 这时要么改产品定义（例如只保证文件元数据正确、分享到其他平台正确），要么放弃系统图库路线。

### 先不要做的事

- 不要先做转码、MKV/AVI 兼容和更多格式的深度适配，先把 JPG/MP4 的真实相册流程跑顺；
- 不要在 MVP 上继续堆视觉细节，先收集真实使用中的问题；
- 不要先做 mDNS / 局域网自动发现；
- 核心假设已经验证，但在 HEIC、PNG、MOV 和手机接收端路径验证前，不要对用户承诺所有格式都能改。

## 技术说明

- **照片**：`AllDates` 写入 `DateTimeOriginal` / `CreateDate` / `ModifyDate`，同时写 `XMP-photoshop:DateCreated` 和 `OffsetTime* = +08:00`。
- **视频**：`QuickTime:CreateDate` / `ModifyDate`、轨道级 `TrackCreateDate` / `TrackModifyDate`、媒体级 `MediaCreateDate` / `MediaModifyDate` + `Keys:CreationDate`；写入时使用 `-api QuickTimeUTC=1`，把本地 12:00 正确转换成 UTC 04:00。真实相机视频的轨道/媒体日期不为零，所以这些字段也要一起写，避免图库从轨道头部取到旧时间。
- **文件时间**：通过 ExifTool 的 `FileCreateDate` / `FileModifyDate` 设置 Windows 文件创建/修改时间。
- **`nodate`**：用 `-time:all=` 删除所有时间元数据，再设置文件时间。
- **PC MVP**：`app/lib/media-dates.mjs` 复用同一套写入逻辑；`app/server.mjs` 只监听 `127.0.0.1`，使用随机会话令牌保护 API；`exports/` 是默认输出目录。
- **依赖**：`exiftool-vendored`（内置 ExifTool 13.59）、`@ffmpeg-installer/ffmpeg`（内置 FFmpeg 4.1，仅用于生成合成样本）、`express`（本地网页服务）。

## 目录结构

```
TimePostman/
  app/
    server.mjs            本地网页服务 + API
    lib/media-dates.mjs   媒体扫描、日期读取、元数据写入
    public/               网页界面
  scripts/verify.mjs      可行性验证 CLI
  samples/input/          合成样本
  samples/real/           你的真实测试素材（不会被修改）
  samples/output/run-*/   验证运行的副本、清单、结果记录
  exports/                网页版默认输出目录（每次新建子文件夹）
  phone-transfer/         手机互传的 PC 端局域网服务
  phone-inbox/            手机上传到电脑的照片
  phone-receiver/         手机端双向互传 ArkTS 工程
  package.json
  README.md
```

运行目录里的文件：

- `manifest.md`：人读版清单，含判读规则和填写栏；
- `manifest.csv`：用 Excel 填观察结果；
- `manifest.json`：脚本内部使用；
- `README.txt`：运行目录里的快速步骤；
- `media/`：传到手机的测试文件。

## 注意

PC MVP 和验证脚本都只修改副本，不会动源文件夹里的原文件。真机测试前请确认文件可以安全传入手机图库；如果你很在意图库整洁，建议先用一台测试机或一个空相册。网页服务只监听本机 `127.0.0.1`，不要把端口转发到局域网或公网。
