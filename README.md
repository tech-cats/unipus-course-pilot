# UNIPUS MOOC 自动导航播放器

这是一个基于 Node.js + Playwright 的课程自动导航播放器。它从 `.env` 读取课程地址和登录凭据，默认使用本机 Microsoft Edge 打开课程，识别课程目录中的视频任务，按顺序播放并等待结束。

账号密码通过 `.env` 自动提交。登录状态按浏览器隔离保存在 `.browser-profile/<浏览器>/`，后续运行可复用会话。遇到验证码、二次验证或平台风控时，脚本会回退到手动处理，不会绕过这些流程。

## 运行环境

- Windows 10/11
- Node.js 20 或更高版本
- 已安装 Microsoft Edge、Google Chrome、Chromium 或 Firefox 之一
- 默认使用 Microsoft Edge

## 安装

在当前目录打开 PowerShell：

```powershell
npm install
```

项目使用 `playwright-core`，直接调用本机已安装的浏览器，不需要额外下载 Playwright 浏览器。

## 配置

编辑 `.env`，填写课程入口和 UNIPUS 登录凭据：

```dotenv
COURSE_URL=https://moocs.unipus.cn/my/course/8021
BROWSER=edge

UNIPUS_USERNAME=你的账号
UNIPUS_PASSWORD=你的密码
```

常用选项：

`UNIPUS_USERNAME` 可以填写手机号、用户名或邮箱；手机号按中国大陆 `+86` 处理。密码保存在 `.env` 中，不要写进脚本或提交到 Git。


| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BROWSER` | `edge` | `edge`、`chrome`、`chromium` 或 `firefox` |
| `BROWSER_EXECUTABLE` | 空 | 可选，指定浏览器可执行文件的完整路径 |
| `BROWSER_PROFILE_DIR` | 空 | 可选，覆盖按浏览器自动生成的配置目录 |
| `AUTO_LOGIN` | `true` | 是否使用 `.env` 凭据自动登录 |
| `LOGIN_MODE` | `auto` | `auto`、`username` 或 `phone` |
| `ACCEPT_LOGIN_AGREEMENT` | `true` | 自动登录时是否勾选登录协议 |
| `TASK_DISCOVERY_TIMEOUT_MS` | `20000` | 等待课程目录异步加载的最长时间 |
| `HEADLESS` | `false` | 需要处理验证码时请保持 `false` |
| `PLAYBACK_RATE` | `1` | 正常播放速率；平台可能按实际时长记录 |
| `MUTE_VIDEO` | `true` | 播放时静音 |
| `SKIP_COMPLETED` | `true` | 根据课程目录图标跳过已完成任务 |
| `ASSUME_ALL_TASKS_ARE_VIDEO` | `false` | 仅当整门课的任务都是视频时才建议开启 |
| `VIDEO_MAX_WATCH_MINUTES` | `240` | 单个视频的最大等待分钟数，`0` 表示不限制 |
| `KEEP_BROWSER_OPEN` | `false` | 完成后是否保留浏览器窗口 |

浏览器配置目录按浏览器隔离，例如 Edge 使用 `.browser-profile/edge`，Chrome 使用 `.browser-profile/chrome`。这样切换浏览器时不会复用不兼容的 Chromium/Firefox 配置。

不要把 `.env` 或 `.browser-profile/` 提交到仓库。

## 使用

先检查脚本能否识别课程目录：

```powershell
npm start -- --dry-run
```

首次运行且 `.env` 中没有凭据时，脚本会停在登录页等待手动登录。填写 `UNIPUS_USERNAME` 和 `UNIPUS_PASSWORD` 后，脚本会自动填写并提交登录表单。如果平台弹出验证码或二次验证，仍需要在浏览器中手动完成。脚本确认进入课程页后会自动扫描并列出识别到的视频任务，但不会播放。

确认列表正确后开始播放：

```powershell
npm start
```

运行期间请保持浏览器窗口打开。脚本播放完一个视频后会返回课程页，重新扫描目录并继续下一个视频，直到没有待处理任务或达到你的停止条件。

任务会逐个处理，终端只显示当前任务和单行动态进度条，不再一次性列出全部待完成任务。

按 `Ctrl+C` 可以停止。下次运行会重新读取课程目录，已完成任务通常会被平台图标标记并跳过。

## 浏览器适配

`BROWSER=edge` 是默认值，对应 Microsoft Edge 的 `msedge` 通道。切换浏览器时修改：

```dotenv
BROWSER=chrome
# 或
BROWSER=firefox
```

如果浏览器安装在非标准位置，可设置 `BROWSER_EXECUTABLE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`。不同浏览器使用独立配置目录，首次切换时需要重新自动登录一次。

## 页面结构变化



平台页面如果改版，优先用 dry-run 检查识别结果。相关配置在 `.env`：


- `TASK_SELECTOR`：课程目录任务链接选择器
- `VIDEO_KEYWORDS`：判断任务为视频的 URL、文字或图标关键词
- `EXCLUDE_KEYWORDS`：排除作业、测验、考试、讨论等任务
- `COMPLETED_KEYWORDS`：识别已完成状态的图标关键词

当前 UNIPUS 目录使用 `li.task-item.task-content`，视频任务链接通常是 `a.title[href*="/task/"]`，视频类型由 `es-icon-videoclass` 图标标识。脚本会等待目录异步加载后再扫描，避免页面刚打开时误报“没有识别到视频任务”。

## 注意事项

- 本工具只做正常页面导航和视频播放，不包含反检测、验证码识别、请求伪造或进度上报绕过。
- 自动播放是否符合课程规则，需要以任课教师和平台要求为准。
- 如果平台要求点击确认、完成随堂问题或人工验证，请自行在浏览器中处理；脚本不会代做。
- 如果视频页面没有原生 `<video>` 元素，可能需要根据该课程播放器增加对应选择器。
