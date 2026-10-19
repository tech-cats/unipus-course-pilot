import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright-core";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");

const BROWSER_PRESETS = {
  edge: { id: "edge", label: "Microsoft Edge", engine: "chromium", channel: "msedge" },
  chrome: { id: "chrome", label: "Google Chrome", engine: "chromium", channel: "chrome" },
  chromium: { id: "chromium", label: "Chromium", engine: "chromium", channel: "chromium" },
  firefox: { id: "firefox", label: "Mozilla Firefox", engine: "firefox", channel: "" },
};

const BROWSER_ALIASES = {
  msedge: "edge",
  "microsoft-edge": "edge",
  googlechrome: "chrome",
  "google-chrome": "chrome",
  ff: "firefox",
};

const UNIPUS_COUNTRY_CODE = "+86";

const LEVEL_COLOR = {
  info: "\u001b[36m",
  ok: "\u001b[32m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
  reset: "\u001b[0m",
};

function log(level, message) {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const color = LEVEL_COLOR[level] ?? "";
  console.log(`${color}[${time}] ${message}${LEVEL_COLOR.reset}`);
}

function parseDotEnv(source) {
  const result = {};

  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (match[2].trim().startsWith('"')) {
      value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"');
    }

    result[match[1]] = value;
  }

  return result;
}

async function loadEnvFile(filePath) {
  try {
    const source = await fs.readFile(filePath, "utf8");
    const values = parseDotEnv(source);
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function envString(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function envRaw(name, fallback = "") {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function resolveBrowser(rawName, executable) {
  const requested = String(rawName || "edge").trim().toLowerCase();
  const preset = BROWSER_PRESETS[BROWSER_ALIASES[requested] ?? requested];
  if (!preset) {
    throw new Error(`Unsupported BROWSER=${rawName}. Use edge, chrome, chromium, or firefox.`);
  }

  return {
    ...preset,
    executable: executable ? resolveFromRoot(executable) : "",
  };
}

function envNumber(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = envString(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}; received: ${raw}`);
  }
  return value;
}

function envBoolean(name, fallback) {
  const raw = envString(name, String(fallback)).toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false; received: ${raw}`);
}

function splitKeywords(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isLoginUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.hostname === "sso.unipus.cn" ||
      /\/login(?:\/|$)/i.test(url.pathname) ||
      /cas\/callback/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isMoocsUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "moocs.unipus.cn" || url.hostname.endsWith(".moocs.unipus.cn");
  } catch {
    return false;
  }
}

function seconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}s` : "unknown";
}

async function readConfig() {
  await loadEnvFile(path.join(ROOT_DIR, ".env"));

  const courseUrl = normalizeUrl(envString("COURSE_URL"));
  if (!courseUrl) {
    throw new Error("COURSE_URL is missing or invalid. Set it in .env.");
  }
  if (!isMoocsUrl(courseUrl)) {
    throw new Error("COURSE_URL must point to moocs.unipus.cn.");
  }

  const browser = resolveBrowser(
    envString("BROWSER", envString("BROWSER_CHANNEL", "edge")),
    envString("BROWSER_EXECUTABLE"),
  );
  const profileRoot = resolveFromRoot(envString("USER_DATA_DIR", ".browser-profile"));
  const profileOverride = envString("BROWSER_PROFILE_DIR");
  const userDataDir = profileOverride
    ? resolveFromRoot(profileOverride)
    : path.join(profileRoot, browser.id);

  return {
    courseUrl,
    browser,
    username: envString("UNIPUS_USERNAME", envString("UNIPUS_ACCOUNT")),
    password: envRaw("UNIPUS_PASSWORD", envRaw("UNIPUS_PASS")),
    autoLogin: envBoolean("AUTO_LOGIN", true),
    loginMode: envString("LOGIN_MODE", "auto").toLowerCase(),
    acceptLoginAgreement: envBoolean("ACCEPT_LOGIN_AGREEMENT", true),
    headless: envBoolean("HEADLESS", false),
    slowMo: envNumber("SLOW_MO", 0, { min: 0, max: 5000 }),
    userDataDir,
    taskDiscoveryTimeoutMs: envNumber("TASK_DISCOVERY_TIMEOUT_MS", 20000, {
      min: 1000,
    }),
    loginWaitTimeoutMs: envNumber("LOGIN_WAIT_TIMEOUT_MS", 900000, { min: 10000 }),
    navigationTimeoutMs: envNumber("NAVIGATION_TIMEOUT_MS", 60000, { min: 5000 }),
    videoWaitTimeoutMs: envNumber("VIDEO_WAIT_TIMEOUT_MS", 60000, { min: 5000 }),
    pollIntervalMs: envNumber("POLL_INTERVAL_MS", 3000, { min: 500 }),
    playbackRate: envNumber("PLAYBACK_RATE", 1, { min: 0.25, max: 2 }),
    muteVideo: envBoolean("MUTE_VIDEO", true),
    skipCompleted: envBoolean("SKIP_COMPLETED", true),
    taskSelector: envString(
      "TASK_SELECTOR",
      'a.title[href*="/task/"],a[href*="task"],a[href*="/courseware/"],a[href*="/lesson/"],a[data-task-id]',
    ),
    videoKeywords: splitKeywords(envString("VIDEO_KEYWORDS", "videoclass,video,视频,观看")),
    excludeKeywords: splitKeywords(
      envString(
        "EXCLUDE_KEYWORDS",
        "zuoye,assignment,homework,exam,quiz,test,作业,测验,考试,讨论,问答",
      ),
    ),
    completedKeywords: splitKeywords(
      envString("COMPLETED_KEYWORDS", "iccheckcircleblack24px,completed,finished,已完成"),
    ),
    assumeAllTasksAreVideo: envBoolean("ASSUME_ALL_TASKS_ARE_VIDEO", false),
    videoMaxWatchMinutes: envNumber("VIDEO_MAX_WATCH_MINUTES", 240, { min: 0 }),
    keepBrowserOpen: envBoolean("KEEP_BROWSER_OPEN", false),
  };
}

async function collectTasks(page, config) {
  const tasks = [];

  for (const frame of page.frames()) {
    try {
      const frameTasks = await frame.evaluate(
        ({ selector, videoKeywords, excludeKeywords, completedKeywords, assumeAllTasksAreVideo }) => {
          const normalizeClass = (element) => {
            if (!element) return "";
            if (typeof element.className === "string") return element.className;
            return element.getAttribute?.("class") ?? "";
          };

          const matchesAny = (value, keywords) => {
            const lower = value.toLowerCase();
            return keywords.some((keyword) => lower.includes(keyword));
          };

          const anchors = Array.from(document.querySelectorAll(selector));
          return anchors.flatMap((anchor) => {
            const taskRoot = anchor.closest(".task-item, [data-task-id], li");
            const taskId =
              anchor.getAttribute("data-task-id") ||
              taskRoot?.getAttribute("data-task-id") ||
              taskRoot?.id?.match(/task_id_(\d+)/)?.[1] ||
              "";
            const courseId = location.pathname.match(/\/course\/(\d+)/)?.[1] || "";
            const href =
              anchor.getAttribute("href") ||
              anchor.getAttribute("data-href") ||
              taskRoot?.getAttribute("data-url") ||
              taskRoot?.getAttribute("data-href") ||
              (taskId && courseId ? `/course/${courseId}/task/${taskId}/show` : "");
            if (!href || href.startsWith("javascript:") || href === "#") return [];

            let absoluteUrl;
            try {
              absoluteUrl = new URL(href, location.href).href;
            } catch {
              return [];
            }

            const text = (anchor.innerText || anchor.textContent || "")
              .replace(/\s+/g, " ")
              .trim() ||
              (taskRoot?.innerText || taskRoot?.textContent || "")
              .replace(/\s+/g, " ")
              .trim();
            if (!text) return [];

            const context = [anchor];
            if (taskRoot && taskRoot !== anchor) {
              context.push(taskRoot);
            } else {
              let node = anchor.parentElement;
              for (let depth = 0; node && depth < 3; depth += 1) {
                context.push(node);
                node = node.parentElement;
              }
            }

            const contextClasses = context
              .map(normalizeClass)
              .concat(
                context.flatMap((item) =>
                  Array.from(item.querySelectorAll?.("i, svg") ?? []).map(normalizeClass),
                ),
              )
              .join(" ");

            const evidence = `${absoluteUrl} ${text} ${contextClasses}`;
            const hasVideoHint = matchesAny(evidence, videoKeywords);
            const hasExcludeHint = matchesAny(evidence, excludeKeywords);
            const completed = matchesAny(contextClasses, completedKeywords);
            const lowerUrl = absoluteUrl.toLowerCase();
            const hasExcludedUrl = /(assignment|homework|exam|quiz|test)/i.test(lowerUrl);
            const hasVideoUrl = /video/i.test(lowerUrl);
            const isVideo = assumeAllTasksAreVideo || hasVideoHint || hasVideoUrl;
            const excluded = hasExcludeHint || hasExcludedUrl;

            if (!isVideo || excluded) return [];

            return [
              {
                taskId,
                url: absoluteUrl,
                text,
                completed,
                frameUrl: location.href,
              },
            ];
          });
        },
        {
          selector: config.taskSelector,
          videoKeywords: config.videoKeywords,
          excludeKeywords: config.excludeKeywords,
          completedKeywords: config.completedKeywords,
          assumeAllTasksAreVideo: config.assumeAllTasksAreVideo,
        },
      );

      tasks.push(...frameTasks);
    } catch {
      // A frame can disappear while the page is navigating.
    }
  }

  const unique = new Map();
  for (const task of tasks) {
    const existing = unique.get(task.url);
    if (!existing) {
      unique.set(task.url, task);
      continue;
    }

    if (!existing.text && task.text) existing.text = task.text;
    existing.completed = existing.completed && task.completed;
  }

  return Array.from(unique.values());
}

async function clickVisibleExactText(page, labels) {
  for (const frame of page.frames()) {
    for (const label of labels) {
      try {
        const candidates = frame.getByText(label, { exact: true });
        const count = Math.min(await candidates.count(), 10);
        for (let index = 0; index < count; index += 1) {
          const candidate = candidates.nth(index);
          if (await candidate.isVisible().catch(() => false)) {
            await candidate.click({ timeout: 3000 });
            return true;
          }
        }
      } catch {
        // Try the next frame or label.
      }
    }
  }
  return false;
}

async function prepareOutline(page, config) {
  const deadline = Date.now() + config.taskDiscoveryTimeoutMs;
  let directoryClicked = false;

  while (Date.now() < deadline) {
    const tasks = await collectTasks(page, config);
    if (tasks.length > 0) return tasks;

    if (!directoryClicked) {
      directoryClicked = await clickVisibleExactText(page, ["目录", "课程目录", "章节目录"]);
      if (directoryClicked) {
        await page.waitForTimeout(1000);
      }
    }

    await page.waitForTimeout(1000);
  }

  log(
    "warn",
    `等待 ${Math.ceil(config.taskDiscoveryTimeoutMs / 1000)} 秒后仍未发现任务，将再做一次页面刷新检查。`,
  );
  await reloadCourse(page, config);
  return collectTasks(page, config);
}

function printTaskList(tasks, config) {
  const pending = config.skipCompleted ? tasks.filter((task) => !task.completed) : tasks;
  log("info", `检测到 ${tasks.length} 个视频任务，本次待处理 ${pending.length} 个。`);
  for (const [index, task] of tasks.entries()) {
    const status = task.completed ? "已完成" : "待处理";
    log("info", `${String(index + 1).padStart(2, "0")}. [${status}] ${task.text.slice(0, 90)}`);
  }
  return pending;
}

function looksLikePhoneNumber(value) {
  return /^\+?[\d\s-]{6,20}$/.test(value.trim());
}

async function fillFirstVisible(page, selectors, value) {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      try {
        const locator = frame.locator(selector).first();
        if (await locator.isVisible().catch(() => false)) {
          await locator.fill(value, { timeout: 5000 });
          return true;
        }
      } catch {
        // Try the next selector or frame.
      }
    }
  }
  return false;
}

async function attemptAutomaticLogin(page, config) {
  const mode = ["auto", "username", "phone"].includes(config.loginMode)
    ? config.loginMode
    : "auto";
  const useUsername =
    mode === "username" || (mode === "auto" && !looksLikePhoneNumber(config.username));

  if (useUsername) {
    await clickVisibleExactText(page, ["用户名/邮箱登录", "用户名登录"]);
    await page.waitForTimeout(500);
  }

  let phone = config.username.replace(/[\s-]/g, "");
  if (phone.startsWith(UNIPUS_COUNTRY_CODE)) {
    phone = phone.slice(UNIPUS_COUNTRY_CODE.length);
  }

  const accountFilled = useUsername
    ? await fillFirstVisible(
        page,
        [
          "#username",
          'input[autocomplete="username"]',
          'input[placeholder*="用户名"]',
          'input[placeholder*="邮箱"]',
        ],
        config.username,
      )
    : await fillFirstVisible(
        page,
        ["#phone", 'input[autocomplete="username"]', 'input[placeholder*="手机"]'],
        phone,
      );
  if (!accountFilled) return false;

  const passwordFilled = await fillFirstVisible(
    page,
    ["#password", 'input[type="password"]'],
    config.password,
  );
  if (!passwordFilled) return false;

  if (config.acceptLoginAgreement) {
    for (const frame of page.frames()) {
      const checkbox = frame.locator("#agreement").first();
      try {
        if ((await checkbox.count()) > 0 && !(await checkbox.isChecked())) {
          await checkbox.check({ force: true, timeout: 3000 });
        }
      } catch {
        // The agreement checkbox is optional on some login variants.
      }
    }
  }

  let submitted = false;
  for (const frame of page.frames()) {
    try {
      const button = frame.locator("button.ugsso-btn-primary").first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 5000 });
        submitted = true;
        break;
      }
    } catch {
      // Try another frame.
    }
  }
  if (!submitted) return false;

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!isLoginUrl(page.url())) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function waitForAuthenticatedCourse(page, config) {
  const deadline = Date.now() + config.loginWaitTimeoutMs;
  let loginMessageShown = false;
  const autoLoginConfigured = Boolean(config.autoLogin && config.username && config.password);
  let autoLoginAttempted = !autoLoginConfigured;

  await page.goto(config.courseUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.navigationTimeoutMs,
  });

  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error("浏览器页面已关闭。");
    const currentUrl = page.url();

    if (isLoginUrl(currentUrl)) {
      if (!autoLoginAttempted) {
        autoLoginAttempted = true;
        log("info", `检测到登录页，正在使用 .env 中的账号自动登录 ${config.browser.label}。`);
        const loggedIn = await attemptAutomaticLogin(page, config);
        if (loggedIn) {
          log("ok", "自动登录成功。");
          await page.waitForTimeout(1000);
          continue;
        }
      }

      if (!loginMessageShown) {
        loginMessageShown = true;
        log(
          "warn",
          autoLoginConfigured
            ? `自动登录未完成，需要在 ${config.browser.label} 中手动处理。可能需要验证码、二次验证，或账号密码有误。`
            : `未配置自动登录，需要在 ${config.browser.label} 中手动登录，或在 .env 填写 UNIPUS_USERNAME 和 UNIPUS_PASSWORD。`,
        );
        log("warn", `登录完成后会自动继续，最多等待 ${Math.ceil(config.loginWaitTimeoutMs / 60000)} 分钟。`);
        if (config.headless) {
          throw new Error("HEADLESS=true 时自动登录未完成；请检查账号密码，或改用 HEADLESS=false 手动完成验证。");
        }
      }
      await page.waitForTimeout(1000);
      continue;
    }

    if (isMoocsUrl(currentUrl)) {
      if (!currentUrl.startsWith(config.courseUrl)) {
        await page.goto(config.courseUrl, {
          waitUntil: "domcontentloaded",
          timeout: config.navigationTimeoutMs,
        });
      }

      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      log("ok", "课程页面已就绪。");
      return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error("等待登录或课程页面超时。请检查 .env 中的 LOGIN_WAIT_TIMEOUT_MS。");
}

async function reloadCourse(page, config) {
  await page.goto(config.courseUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.navigationTimeoutMs,
  });

  if (isLoginUrl(page.url())) {
    await waitForAuthenticatedCourse(page, config);
  }

  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function inspectVideo(frame, config) {
  return frame.evaluate(
    ({ muteVideo, playbackRate, shouldPlay }) => {
      const videos = [];
      const visitedRoots = new Set();

      const visit = (root) => {
        if (!root || visitedRoots.has(root)) return;
        visitedRoots.add(root);

        for (const video of root.querySelectorAll("video")) {
          const rect = video.getBoundingClientRect();
          videos.push({ video, area: Math.max(1, rect.width * rect.height) });
        }

        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) visit(element.shadowRoot);
        }
      };

      visit(document);
      videos.sort((a, b) => b.area - a.area);
      const video = videos[0]?.video;
      if (!video) return { found: false };

      if (muteVideo) video.muted = true;
      if (Number.isFinite(playbackRate)) video.playbackRate = playbackRate;

      if (shouldPlay && video.paused && !video.ended) {
        const promise = video.play();
        if (promise?.catch) promise.catch(() => {});
      }

      return {
        found: true,
        currentTime: Number(video.currentTime),
        duration: Number(video.duration),
        paused: Boolean(video.paused),
        ended: Boolean(video.ended),
        readyState: Number(video.readyState),
        muted: Boolean(video.muted),
        playbackRate: Number(video.playbackRate),
      };
    },
    { muteVideo: config.muteVideo, playbackRate: config.playbackRate, shouldPlay: true },
  );
}

async function findPlayingFrame(page, config) {
  let best = null;

  for (const frame of page.frames()) {
    try {
      const state = await inspectVideo(frame, config);
      if (!state.found) continue;

      const score = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : 1;
      if (!best || score > best.score) best = { frame, state, score };
    } catch {
      // Cross-origin or detached frames can fail transiently.
    }
  }

  return best;
}

async function clickPlayControl(page) {
  for (const frame of page.frames()) {
    for (const label of ["继续学习", "开始学习", "播放"]) {
      try {
        const locator = frame.getByRole("button", { name: label, exact: false });
        const count = Math.min(await locator.count(), 5);
        for (let index = 0; index < count; index += 1) {
          const button = locator.nth(index);
          if (await button.isVisible().catch(() => false)) {
            await button.click({ timeout: 3000 });
            return true;
          }
        }
      } catch {
        // Try another control.
      }
    }
  }
  return false;
}

async function waitForVideo(page, config) {
  const deadline = Date.now() + config.videoWaitTimeoutMs;
  let controlClicked = false;

  while (Date.now() < deadline) {
    const found = await findPlayingFrame(page, config);
    if (found) return found;

    if (!controlClicked) {
      controlClicked = await clickPlayControl(page);
      if (controlClicked) {
        log("info", "已点击课程的开始/继续学习按钮。");
        await page.waitForTimeout(1500);
      }
    }

    await page.waitForTimeout(1000);
  }

  return null;
}

async function watchVideo(page, config, task) {
  const found = await waitForVideo(page, config);
  if (!found) {
    return { status: "no-video", detail: "页面中未找到 video 元素" };
  }

  let frame = found.frame;
  let lastTime = -1;
  let lastProgressLog = -1;
  let lastMovementAt = Date.now();
  let resumeAttempts = 0;
  const startedAt = Date.now();

  log("ok", `开始播放: ${task.text.slice(0, 80)}`);

  while (true) {
    if (page.isClosed()) throw new Error("浏览器页面在播放过程中被关闭。");

    if (isLoginUrl(page.url())) {
      log("warn", "登录状态已失效，等待重新登录后继续。");
      await waitForAuthenticatedCourse(page, config);
      return { status: "retry", detail: "登录状态失效，需重新进入任务" };
    }

    let state;
    try {
      state = await inspectVideo(frame, config);
    } catch {
      const refreshed = await findPlayingFrame(page, config);
      if (refreshed) {
        frame = refreshed.frame;
        state = refreshed.state;
      } else {
        state = { found: false };
      }
    }

    const now = Date.now();
    const maxWatchMs = config.videoMaxWatchMinutes * 60 * 1000;
    if (maxWatchMs > 0 && now - startedAt > maxWatchMs) {
      return { status: "timeout", detail: "超过单个视频的最大等待时间" };
    }

    if (!state.found) {
      if (now - startedAt > 30000) {
        return { status: "lost-video", detail: "播放器或 video 元素消失" };
      }
      await page.waitForTimeout(config.pollIntervalMs);
      continue;
    }

    const duration = Number(state.duration);
    const currentTime = Number(state.currentTime);
    const complete =
      state.ended ||
      (Number.isFinite(duration) && duration > 0 && currentTime >= Math.max(0, duration - 1.5));

    if (complete) {
      await page.waitForTimeout(1500);
      return { status: "completed", detail: `${seconds(duration)} 视频已播放结束` };
    }

    if (Number.isFinite(currentTime) && Math.abs(currentTime - lastTime) > 0.2) {
      lastMovementAt = now;
      lastTime = currentTime;
      resumeAttempts = 0;
    }

    if (state.paused) {
      await inspectVideo(frame, config);
    }

    const percent =
      Number.isFinite(duration) && duration > 0
        ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
        : -1;

    if (percent >= 0) {
      const bucket = Math.floor(percent / 10) * 10;
      if (bucket !== lastProgressLog) {
        lastProgressLog = bucket;
        log("info", `进度 ${percent.toFixed(1)}% (${seconds(currentTime)} / ${seconds(duration)})`);
      }
    }

    if (now - lastMovementAt > 60000) {
      resumeAttempts += 1;
      log("warn", `播放进度 60 秒未变化，正在尝试恢复播放 (${resumeAttempts}/3)。`);
      await inspectVideo(frame, config);
      if (resumeAttempts >= 3) {
        return { status: "stalled", detail: "视频持续卡住，已跳过" };
      }
      lastMovementAt = now;
    }

    await page.waitForTimeout(config.pollIntervalMs);
  }
}

async function runTask(page, config, task) {
  log("info", `进入任务: ${task.text.slice(0, 100)}`);

  await page.goto(task.url, {
    waitUntil: "domcontentloaded",
    timeout: config.navigationTimeoutMs,
  });

  if (isLoginUrl(page.url())) {
    log("warn", "任务打开后跳转到了登录页，等待重新登录。");
    await waitForAuthenticatedCourse(page, config);
    return { status: "retry", detail: "登录后需重新打开任务" };
  }

  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  return watchVideo(page, config, task);
}

async function launchBrowser(config) {
  await fs.mkdir(config.userDataDir, { recursive: true });

  const options = {
    headless: config.headless,
    slowMo: config.slowMo,
    viewport: null,
    locale: "zh-CN",
    acceptDownloads: false,
    args: ["--start-maximized"],
  };

  if (config.browser.engine === "chromium") {
    options.args = ["--start-maximized"];
  } else {
    delete options.viewport;
  }


  if (config.browser.executable) {
    options.executablePath = config.browser.executable;
  } else if (config.browser.channel) {
    options.channel = config.browser.channel;
  }

  const launcher = config.browser.engine === "firefox" ? firefox : chromium;
  try {
    return await launcher.launchPersistentContext(config.userDataDir, options);
  } catch (error) {
    throw new Error(
      `无法启动 ${config.browser.label}。请确认浏览器已安装，或设置 BROWSER_EXECUTABLE。原始错误: ${error.message}`,
      { cause: error },
    );
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const config = await readConfig();
  const course = new URL(config.courseUrl);

  log("info", `课程地址: ${course.href}`);
  log("info", `浏览器: ${config.browser.label}`);
  log("info", `浏览器配置目录: ${config.userDataDir}`);
  if (config.playbackRate !== 1) {
    log("warn", `PLAYBACK_RATE=${config.playbackRate}。平台可能按实际观看时长记录，请自行确认课程规则。`);
  }

  const context = await launchBrowser(config);
  activeContext = context;
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(config.navigationTimeoutMs);

  let keepOpen = config.keepBrowserOpen;
  try {
    await waitForAuthenticatedCourse(page, config);
    await reloadCourse(page, config);

    const allTasks = await prepareOutline(page, config);
    if (allTasks.length === 0) {
      throw new Error(
        "没有识别到视频任务。请先确认课程目录已展开；必要时检查 .env 中的 " +
          "TASK_SELECTOR 和 VIDEO_KEYWORDS。",
      );
    }

    const pending = printTaskList(allTasks, config);
    if (dryRun) {
      log("ok", "dry-run 完成，未播放任何视频。");
      return;
    }
    if (pending.length === 0) {
      log("ok", "没有待处理的视频任务。");
      return;
    }

    const failed = [];
    let completed = 0;
    let skipped = 0;

    for (const [index, task] of pending.entries()) {
      log("info", `任务 ${index + 1}/${pending.length}: ${task.text.slice(0, 100)}`);

      let result;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          result = await runTask(page, config, task);
        } catch (error) {
          result = { status: "error", detail: error.message };
        }

        if (result.status !== "retry" || attempt === 2) break;
        await reloadCourse(page, config);
      }

      if (result?.status === "completed") {
        completed += 1;
        log("ok", `任务完成 (${completed}/${pending.length}): ${result.detail}`);
      } else if (result?.status === "no-video") {
        skipped += 1;
        log("warn", `跳过非播放页或未识别的播放器: ${result.detail}`);
      } else {
        failed.push({ task, result });
        log("error", `任务未完成: ${result?.detail ?? "unknown error"}`);
      }

      if (index < pending.length - 1) {
        await reloadCourse(page, config);
      }
    }

    log("ok", `本次完成 ${completed} 个，跳过 ${skipped} 个，失败 ${failed.length} 个。`);
    if (failed.length > 0) {
      log("warn", "失败任务不会自动重试，可下次运行脚本继续。");
      for (const item of failed) {
        log("warn", `- ${item.task.text.slice(0, 100)} (${item.result?.detail ?? "unknown"})`);
      }
    }
  } catch (error) {
    log("error", error.message);
    process.exitCode = 1;
  } finally {
    if (!keepOpen) {
      await context.close().catch(() => {});
    } else {
      log("warn", `浏览器保持打开。关闭 ${config.browser.label} 后脚本会退出。`);
      await new Promise((resolve) => context.once("close", resolve));
    }
  }
}

let activeContext = null;

process.on("SIGINT", async () => {
  log("warn", "收到停止信号，正在关闭浏览器。");
  await activeContext?.close().catch(() => {});
  process.exit(130);
});

await main().catch((error) => {
  log("error", `启动失败: ${error.message}`);
  process.exitCode = 1;
});
