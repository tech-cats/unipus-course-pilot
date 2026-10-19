# UNIPUS MOOC 自动导航播放器

这是一个基于 Node.js + Playwright 的课程自动导航播放器。它从 `.env` 读取课程地址，使用本机 Google Chrome 打开课程，识别课程目录中的视频任务，按顺序播放并等待结束。

它不会答题、提交作业、处理验证码或绕过平台的登录与风控流程。首次运行需要在弹出的 Chrome 窗口中手动登录，登录状态保存在 `.browser-profile/`，后续运行可复用。

## 运行环境

- Windows 10/11
- Node.js 20 或更高版本
- 已安装 Google Chrome

## 安装

在当前目录打开 PowerShell：

```powershell
npm install
```

如果只想使用本机 Chrome，不需要额外下载 Playwright 浏览器。

## 配置

编辑 `.env`，把 `COURSE_URL` 换成要学习的课程入口：

```dotenv
COURSE_URL=https://moocs.unipus.cn/my/course/8021
```

常用选项：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HEADLESS` | `false` | 必须保持 `false` 才能手动登录并处理平台提示 |
| `PLAYBACK_RATE` | `1` | 正常播放速率；平台可能按实际时长记录 |
| `MUTE_VIDEO` | `true` | 播放时静音 |
| `SKIP_COMPLETED` | `true` | 根据课程目录图标跳过已完成任务 |
| `ASSUME_ALL_TASKS_ARE_VIDEO` | `false` | 仅当整门课的任务都是视频时才建议开启 |
| `VIDEO_MAX_WATCH_MINUTES` | `240` | 单个视频的最大等待分钟数，`0` 表示不限制 |
| `KEEP_BROWSER_OPEN` | `false` | 完成后是否保留浏览器窗口 |

浏览器登录状态保存在 `.browser-profile/`，不要把该目录或 `.env` 提交到仓库。

## 使用

先检查脚本能否识别课程目录：

```powershell
npm start -- --dry-run
```

首次运行会进入 UNIPUS 登录页。请在弹出的 Chrome 中手动完成登录。脚本确认进入课程页后会自动扫描并列出识别到的视频任务，但不会播放。

确认列表正确后开始播放：

```powershell
npm start
```

运行期间请保持浏览器窗口打开。脚本播放完一个视频后会返回课程页，重新扫描目录并继续下一个视频，直到没有待处理任务或达到你的停止条件。

按 `Ctrl+C` 可以停止。下次运行会重新读取课程目录，已完成任务通常会被平台图标标记并跳过。

## 页面结构变化

平台页面如果改版，优先用 dry-run 检查识别结果。相关配置在 `.env`：

- `TASK_SELECTOR`：课程目录任务链接选择器
- `VIDEO_KEYWORDS`：判断任务为视频的 URL、文字或图标关键词
- `EXCLUDE_KEYWORDS`：排除作业、测验、考试、讨论等任务
- `COMPLETED_KEYWORDS`：识别已完成状态的图标关键词

默认规则来自当前平台常见的 `a[href*="task"]` 和 `videoclass` 图标结构。脚本只在任务被明确识别为视频时进入任务页，避免误点作业或测验。

## 注意事项

- 本工具只做正常页面导航和视频播放，不包含反检测、验证码识别、请求伪造或进度上报绕过。
- 自动播放是否符合课程规则，需要以任课教师和平台要求为准。
- 如果平台要求点击确认、完成随堂问题或人工验证，请自行在浏览器中处理；脚本不会代做。
- 如果视频页面没有原生 `<video>` 元素，可能需要根据该课程播放器增加对应选择器。
