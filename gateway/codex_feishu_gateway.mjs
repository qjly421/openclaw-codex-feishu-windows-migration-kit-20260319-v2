#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildTimeSeriesMorningBrief,
  dateKeyInTimeZone,
  DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE,
} from './timeseries_morning_brief.mjs';

async function importLarkSdkCandidate(candidate) {
  if (!candidate) {
    return null;
  }
  try {
    const isAbsolutePath = path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate);
    const imported = isAbsolutePath ? await import(pathToFileURL(candidate).href) : await import(candidate);
    return imported?.default || imported;
  } catch {
    return null;
  }
}

async function loadLarkSdk() {
  const candidates = [
    process.env.FEISHU_LARK_SDK_PATH,
    process.env.LARK_SDK_PATH,
    '@larksuiteoapi/node-sdk/lib/index.js',
    '@larksuiteoapi/node-sdk',
    path.join(process.cwd(), 'node_modules', '@larksuiteoapi', 'node-sdk', 'lib', 'index.js'),
    '/opt/homebrew/lib/node_modules/openclaw/node_modules/@larksuiteoapi/node-sdk/lib/index.js',
    '/usr/local/lib/node_modules/openclaw/node_modules/@larksuiteoapi/node-sdk/lib/index.js',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const mod = await importLarkSdkCandidate(candidate);
    if (mod) {
      return mod;
    }
  }
  throw new Error('Unable to load @larksuiteoapi/node-sdk. Install it locally with npm, or set FEISHU_LARK_SDK_PATH to the SDK entry file.');
}

const Lark = await loadLarkSdk();

const HOME = os.homedir();
const DEFAULT_ROOT = process.env.FEISHU_GATEWAY_ROOT || path.join(HOME, '.codex-feishu-gateway');
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_ROOT, 'feishu_gateway.json');
const DEFAULT_STATE_PATH = path.join(DEFAULT_ROOT, 'feishu_gateway_state.json');
const DEFAULT_USAGE_LEDGER_PATH = path.join(DEFAULT_ROOT, 'feishu_usage_ledger.jsonl');
const DEFAULT_CODEX_SESSIONS_ROOT = path.join(HOME, '.codex', 'sessions');
const DEFAULT_CODEX_BIN = process.platform === 'darwin' ? '/Applications/Codex.app/Contents/Resources/codex' : 'codex';
const DEFAULT_WORKSPACE = process.cwd();
const DEFAULT_REPLY_CHUNK_LIMIT = 1800;
const DEFAULT_CODEX_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_CODEX_FIRST_EVENT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_GROUP_SESSION_SCOPE = 'group';
const DEFAULT_TYPING_EMOJI = 'Typing';
const DEFAULT_GROUP_ASSISTANT_MODE = 'hybrid';
const DEFAULT_GROUP_PUBLIC_MEMORY_LIMIT = 24;
const DEFAULT_GROUP_HIGHLIGHT_LIMIT = 12;
const DEFAULT_PROMPT_RECENT_GROUP_MESSAGES = 8;
const MAX_GROUP_MEMORY_TEXT_LENGTH = 240;
const DEFAULT_PROGRESS_UPDATES = true;
const DEFAULT_PROGRESS_COMMAND_UPDATES = false;
const DEFAULT_PROGRESS_INITIAL_DELAY_MS = 8000;
const DEFAULT_PROGRESS_UPDATE_INTERVAL_MS = 15000;
const DEFAULT_PROGRESS_MAX_MESSAGES = 6;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_RUN_WATCH_INTERVAL_MS = 15_000;
const ACTIVE_RUN_SPAWN_GRACE_MS = 15_000;
const ACTIVE_RUN_STALE_PROCESS_GRACE_MS = 60_000;
const DEFAULT_FEISHU_API_RETRY_ATTEMPTS = 3;
const DEFAULT_FEISHU_API_RETRY_BASE_DELAY_MS = 1500;
const DEFAULT_FEISHU_API_TIMEOUT_MS = 15000;
const DEFAULT_FEISHU_FILE_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
const DEFAULT_FEISHU_FILE_SPLIT_CHUNK_BYTES = 29 * 1024 * 1024;
const DEFAULT_PLAN_QUESTION_LIMIT = 3;
const STARTUP_NOTIFY_SYNTHETIC_SENDER_OPEN_ID = '__codex_startup_notify__';
const DEFAULT_STARTUP_NOTIFY_MESSAGE = '我已真正上线。';
const DEFAULT_CARD_CALLBACK_HOST = '0.0.0.0';
const DEFAULT_CARD_CALLBACK_PORT = 16688;
const DEFAULT_CARD_CALLBACK_PATH = '/webhook/card';
const DEFAULT_CARD_CALLBACK_AUTO_CHALLENGE = true;
const DEFAULT_CARD_CALLBACK_TUNNEL_STARTUP_TIMEOUT_MS = 15000;
const WS_MESSAGE_TYPE_EVENT = 'event';
const WS_MESSAGE_TYPE_CARD = 'card';
const WS_HEADER_KEY_BIZ_RT = 'biz_rt';
const WS_ACK_OK = 200;
const WS_ACK_INTERNAL_ERROR = 500;
const KNOWN_CARD_ACTION_EVENT_TYPES = new Set([
  'card.action.trigger',
  'card.action.trigged',
  'card.action',
]);
const DEFAULT_SIMPLE_TASK_MAX_CHARS = 90;
const DEFAULT_SIMPLE_TASK_MAX_LINES = 2;
const SIMPLE_TASK_COMPLEXITY_PATTERN = /(research|investigate|analy[sz]e|design|architecture|migrate|refactor|review|audit|workflow|state machine|callback|permission|deploy|release|rollback|integration|plan|调研|研究|分析|设计|方案|架构|迁移|重构|评审|审计|工作流|状态机|回调|权限|联调|部署|上线|发布|回滚|排查|定位|梳理)/i;
const SIMPLE_TASK_MULTI_STEP_PATTERN = /(\n\s*[-*]\s+|\n\s*\d+[.)]\s+|然后|并且|同时|另外|顺便|再把|以及|分别|依次|先.+再|\band\b|\balso\b|\bthen\b|\bplus\b)/i;

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key.startsWith('no-')) {
      options[key.slice(3)] = false;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
      continue;
    }
    options[key] = true;
  }
  return { command: positionals[0] || 'watch', options };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const jsonWriteQueues = new Map();
const jsonAppendQueues = new Map();
const codexSessionFileCache = new Map();
const activeRunControllers = new Map();

async function readJson(filePath, fallback) {
  const targetPath = path.resolve(filePath);
  if (!(await pathExists(targetPath))) {
    return fallback;
  }
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return JSON.parse(await fs.readFile(targetPath, 'utf8'));
    } catch {
      if (attempt >= 5) {
        return fallback;
      }
      await sleep(80);
    }
  }
}

async function writeJson(filePath, payload) {
  const targetPath = path.resolve(filePath);
  const serialized = JSON.stringify(payload, null, 2);
  const previous = jsonWriteQueues.get(targetPath) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const directory = path.dirname(targetPath);
    const tempPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(tempPath, serialized, 'utf8');
      await fs.rename(tempPath, targetPath);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  });
  jsonWriteQueues.set(targetPath, next);
  try {
    await next;
  } finally {
    if (jsonWriteQueues.get(targetPath) === next) {
      jsonWriteQueues.delete(targetPath);
    }
  }
}

async function appendJsonl(filePath, payload) {
  const targetPath = path.resolve(filePath);
  const serialized = `${JSON.stringify(payload)}\n`;
  const previous = jsonAppendQueues.get(targetPath) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.appendFile(targetPath, serialized, 'utf8');
  });
  jsonAppendQueues.set(targetPath, next);
  try {
    await next;
  } finally {
    if (jsonAppendQueues.get(targetPath) === next) {
      jsonAppendQueues.delete(targetPath);
    }
  }
}

async function readFirstLine(filePath) {
  const handle = await fs.open(filePath, 'r');
  const buffer = Buffer.alloc(4096);
  let collected = '';
  let position = 0;
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead <= 0) {
        return collected;
      }
      position += bytesRead;
      collected += buffer.toString('utf8', 0, bytesRead);
      const newlineIndex = collected.indexOf('\n');
      if (newlineIndex >= 0) {
        return collected.slice(0, newlineIndex).replace(/\r$/, '');
      }
    }
  } finally {
    await handle.close();
  }
}

async function findCodexSessionFileByThreadId(sessionsRoot, threadId) {
  const normalizedThreadId = String(threadId || '').trim();
  if (!normalizedThreadId) {
    return '';
  }
  const cachedPath = codexSessionFileCache.get(normalizedThreadId);
  if (cachedPath && await pathExists(cachedPath)) {
    return cachedPath;
  }
  const root = path.resolve(String(sessionsRoot || DEFAULT_CODEX_SESSIONS_ROOT));
  if (!(await pathExists(root))) {
    return '';
  }
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }
      const firstLine = await readFirstLine(fullPath).catch(() => '');
      const parsed = safeJsonParse(firstLine);
      if (parsed?.type === 'session_meta' && parsed.payload?.id === normalizedThreadId) {
        codexSessionFileCache.set(normalizedThreadId, fullPath);
        return fullPath;
      }
    }
  }
  return '';
}

function zeroUsageSummary() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    lastTokenTimestamp: '',
    sessionFile: '',
  };
}

function usageSummaryWithDefaults(summary) {
  return {
    ...zeroUsageSummary(),
    ...(summary || {}),
  };
}

function diffUsageSummary(startSummary, endSummary) {
  const start = usageSummaryWithDefaults(startSummary);
  const end = usageSummaryWithDefaults(endSummary);
  return {
    inputTokens: Math.max(0, end.inputTokens - start.inputTokens),
    cachedInputTokens: Math.max(0, end.cachedInputTokens - start.cachedInputTokens),
    outputTokens: Math.max(0, end.outputTokens - start.outputTokens),
    reasoningOutputTokens: Math.max(0, end.reasoningOutputTokens - start.reasoningOutputTokens),
    totalTokens: Math.max(0, end.totalTokens - start.totalTokens),
    requestCount: Math.max(0, end.requestCount - start.requestCount),
  };
}

async function summarizeCodexSessionUsage(sessionsRoot, threadId, attempts = 5) {
  const normalizedThreadId = String(threadId || '').trim();
  if (!normalizedThreadId) {
    return null;
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const sessionFile = await findCodexSessionFileByThreadId(sessionsRoot, normalizedThreadId);
    if (!sessionFile) {
      if (attempt >= attempts) {
        return null;
      }
      await sleep(100);
      continue;
    }
    try {
      const lines = (await fs.readFile(sessionFile, 'utf8')).split(/\r?\n/).filter(Boolean);
      let requestCount = 0;
      let previousTotalTokens = null;
      let latest = null;
      let lastTokenTimestamp = '';
      for (const line of lines) {
        const entry = safeJsonParse(line);
        if (entry?.type !== 'event_msg' || entry.payload?.type !== 'token_count') {
          continue;
        }
        const usage = entry.payload?.info?.total_token_usage;
        const totalTokens = usage?.total_tokens;
        if (typeof totalTokens !== 'number') {
          continue;
        }
        if (totalTokens !== previousTotalTokens) {
          requestCount += 1;
          previousTotalTokens = totalTokens;
        }
        latest = usage;
        lastTokenTimestamp = entry.timestamp || lastTokenTimestamp;
      }
      return {
        inputTokens: latest?.input_tokens || 0,
        cachedInputTokens: latest?.cached_input_tokens || 0,
        outputTokens: latest?.output_tokens || 0,
        reasoningOutputTokens: latest?.reasoning_output_tokens || 0,
        totalTokens: latest?.total_tokens || 0,
        requestCount,
        lastTokenTimestamp,
        sessionFile,
      };
    } catch {
      if (attempt >= attempts) {
        return null;
      }
      await sleep(100);
    }
  }
  return null;
}

function parseIsoTimeMs(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPidAlive(pid) {
  const normalizedPid = Number(pid);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withPromiseTimeout(label, promiseFactory, timeoutMs = DEFAULT_FEISHU_API_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    Promise.resolve()
      .then(() => promiseFactory())
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function describeError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function isRecoverableCodexExitErrorMessage(message) {
  const normalized = oneLine(message).toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes('timeout waiting for child process to exit');
}

function isRecoverableCodexResumeFailureMessage(message) {
  const normalized = oneLine(message).toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes('codex resume emitted no json events within');
}

function shouldTreatNonZeroCodexExitAsRecoveredReply({ exitCode, reply, errorText }) {
  if (Number(exitCode) === 0) {
    return false;
  }
  if (!String(reply || '').trim()) {
    return false;
  }
  return isRecoverableCodexExitErrorMessage(errorText);
}

function shouldAutoResetCodexThreadAfterFailure(error, threadId = '') {
  if (!String(threadId || '').trim()) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error || '');
  return isRecoverableCodexExitErrorMessage(message) || isRecoverableCodexResumeFailureMessage(message);
}

function buildCodexSessionResetNotice() {
  return 'I detected that the previous Codex thread became unhealthy. I kept this reply and reset the thread for the next message. Re-send any key context if you still need it.';
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)} KB`;
  }
  return `${value} B`;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeHttpPath(value, fallback = DEFAULT_CARD_CALLBACK_PATH) {
  const normalized = String(value || fallback).trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function normalizeUrlBase(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizeStringArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return [];
}

function quoteShellArg(value) {
  const text = String(value);
  if (!text || /\s|["']/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function formatCommandForLog(command, args = []) {
  return [quoteShellArg(command), ...args.map((arg) => quoteShellArg(arg))].join(' ');
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  return ['', '0.0.0.0', '127.0.0.1', 'localhost', '::', '::1', '[::]', '[::1]'].includes(normalized);
}

function normalizeLocalCallbackHost(hostname) {
  const normalized = String(hostname || '').trim();
  if (!normalized || normalized === '0.0.0.0') {
    return '127.0.0.1';
  }
  if (normalized === '::' || normalized === '[::]') {
    return '[::1]';
  }
  if (normalized.includes(':') && !normalized.startsWith('[')) {
    return `[${normalized}]`;
  }
  return normalized;
}

function buildCallbackUrlFromBase(baseUrl, callbackPath = DEFAULT_CARD_CALLBACK_PATH) {
  const normalizedBaseUrl = normalizeUrlBase(baseUrl);
  if (!normalizedBaseUrl) {
    return '';
  }
  try {
    const base = normalizedBaseUrl.endsWith('/') ? normalizedBaseUrl : `${normalizedBaseUrl}/`;
    return new URL(normalizeHttpPath(callbackPath), base).toString();
  } catch {
    return '';
  }
}

function buildLocalCardCallbackUrl(config) {
  const host = normalizeLocalCallbackHost(config.cardCallbackHost || DEFAULT_CARD_CALLBACK_HOST);
  return buildCallbackUrlFromBase(`http://${host}:${config.cardCallbackPort}`, config.cardCallbackPath);
}

function isFeishuEventCallbackPayload(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  if (data.type === 'url_verification') {
    return true;
  }
  if (typeof data.schema === 'string') {
    return true;
  }
  if (data.header && typeof data.header === 'object' && typeof data.header.event_type === 'string') {
    return true;
  }
  return Boolean(data.event && typeof data.event === 'object');
}

function looksLikeCardActionPayload(data) {
  const normalized = normalizeCardActionPayload(data);
  return Boolean(
    normalized
    && typeof normalized === 'object'
    && typeof normalized.open_message_id === 'string'
    && normalized.open_message_id
    && normalized.action
    && typeof normalized.action === 'object'
  );
}

function normalizeCardActionPayload(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }
  const normalized = { ...data };
  if (typeof data.schema === 'string' && data.event && typeof data.event === 'object') {
    Object.assign(normalized, data.header || {}, data.event || {});
  }
  if (!normalized.event_type && typeof data.header?.event_type === 'string') {
    normalized.event_type = data.header.event_type;
  }
  if (!normalized.action && data.event?.action && typeof data.event.action === 'object') {
    normalized.action = data.event.action;
  }
  if (!normalized.token && typeof data.event?.token === 'string') {
    normalized.token = data.event.token;
  }
  if (!normalized.tenant_key && typeof data.header?.tenant_key === 'string') {
    normalized.tenant_key = data.header.tenant_key;
  }
  if (!normalized.app_id && typeof data.header?.app_id === 'string') {
    normalized.app_id = data.header.app_id;
  }
  if (!normalized.open_id && typeof normalized.operator?.open_id === 'string') {
    normalized.open_id = normalized.operator.open_id;
  }
  if (!normalized.open_message_id && typeof normalized.context?.open_message_id === 'string') {
    normalized.open_message_id = normalized.context.open_message_id;
  }
  if (!normalized.open_chat_id && typeof normalized.context?.open_chat_id === 'string') {
    normalized.open_chat_id = normalized.context.open_chat_id;
  }
  return normalized;
}

function getFeishuCallbackEventType(data) {
  const normalized = normalizeCardActionPayload(data);
  if (!normalized || typeof normalized !== 'object') {
    return '';
  }
  return String(normalized.header?.event_type || normalized.event_type || normalized.type || '').trim();
}

function isKnownCardActionEventType(data) {
  return KNOWN_CARD_ACTION_EVENT_TYPES.has(getFeishuCallbackEventType(data));
}

function clipJsonText(value, limit = 1200) {
  try {
    return clipText(JSON.stringify(value), limit);
  } catch {
    return '[unserializable]';
  }
}

function summarizeCardActionPayload(data) {
  const normalized = normalizeCardActionPayload(data);
  if (!normalized || typeof normalized !== 'object') {
    return 'payload=none';
  }
  const action = normalized.action && typeof normalized.action === 'object' ? normalized.action : {};
  const summary = {
    eventType: getFeishuCallbackEventType(normalized) || undefined,
    openId: normalized.open_id || undefined,
    openMessageId: normalized.open_message_id || undefined,
    openChatId: normalized.open_chat_id || undefined,
    actionTag: action.tag || undefined,
    actionName: action.name || undefined,
    actionValueKeys: action.value && typeof action.value === 'object' ? Object.keys(action.value).slice(0, 12) : undefined,
    hasToken: typeof normalized.token === 'string' && Boolean(normalized.token),
    hasTenantKey: typeof normalized.tenant_key === 'string' && Boolean(normalized.tenant_key),
  };
  return clipJsonText(summary, 500);
}

function extractPublicHttpUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const deduped = [];
  for (const item of matches) {
    const normalized = normalizeUrlBase(item);
    if (!normalized) {
      continue;
    }
    try {
      const parsed = new URL(normalized);
      if (isLoopbackHost(parsed.hostname)) {
        continue;
      }
      if (!deduped.includes(normalized)) {
        deduped.push(normalized);
      }
    } catch {
    }
  }
  return deduped;
}

function resolveExecutableOnPath(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) {
    return '';
  }
  const pathExts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  const directCandidates = [];
  if (path.isAbsolute(raw) || raw.includes(path.sep) || raw.includes('/')) {
    directCandidates.push(raw);
  } else {
    const searchRoots = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const root of searchRoots) {
      directCandidates.push(path.join(root, raw));
      for (const ext of pathExts) {
        directCandidates.push(path.join(root, `${raw}${ext}`));
      }
    }
  }
  for (const item of directCandidates) {
    try {
      if (existsSync(item)) {
        return item;
      }
    } catch {
    }
  }
  return '';
}

function createLineLogger(prefix, onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    let lineBreakIndex = buffer.indexOf('\n');
    while (lineBreakIndex >= 0) {
      const line = buffer.slice(0, lineBreakIndex).replace(/\r$/, '');
      buffer = buffer.slice(lineBreakIndex + 1);
      onLine(prefix, line);
      lineBreakIndex = buffer.indexOf('\n');
    }
  };
}

async function updateCardCallbackRuntimeState(state, stateFile, patch) {
  state.runtime ||= {};
  state.runtime.cardCallback = {
    ...(state.runtime.cardCallback || {}),
    ...patch,
    updatedAt: nowIso(),
  };
  await writeJson(stateFile, state);
}

async function startCardCallbackTunnel({ config, state, stateFile }) {
  if (!config.cardCallbackTunnelEnabled) {
    return null;
  }

  const requestedBin = String(config.cardCallbackTunnelBin || '').trim();
  const tunnelBin = resolveExecutableOnPath(requestedBin)
    || resolveExecutableOnPath(path.join(DEFAULT_ROOT, 'bin', 'cloudflared'))
    || resolveExecutableOnPath(path.join(DEFAULT_ROOT, 'bin', 'cloudflared.exe'))
    || resolveExecutableOnPath('cloudflared');

  if (!tunnelBin) {
    console.warn('card callback tunnel is enabled, but cloudflared was not found. Install it or set cardCallbackTunnelBin.');
    await updateCardCallbackRuntimeState(state, stateFile, {
      status: 'tunnel_missing_binary',
      publicBaseUrl: '',
      publicCallbackUrl: '',
      tunnelPid: null,
      tunnelCommand: '',
    });
    return null;
  }

  const localCallbackUrl = buildLocalCardCallbackUrl(config);
  const tunnelArgs = normalizeStringArray(config.cardCallbackTunnelArgs);
  const resolvedArgs = tunnelArgs.length > 0
    ? tunnelArgs
    : ['tunnel', '--no-autoupdate', '--url', localCallbackUrl];
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(tunnelBin);

  console.log(`starting card callback tunnel: ${formatCommandForLog(tunnelBin, resolvedArgs)}`);
  const child = spawn(tunnelBin, resolvedArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: needsShell,
  });

  let discoveredPublicBaseUrl = '';
  let tunnelReadyResolve;
  const tunnelReady = new Promise((resolve) => {
    tunnelReadyResolve = resolve;
  });
  const maybeSetPublicBaseUrl = async (value) => {
    const normalized = normalizeUrlBase(value);
    if (!normalized || discoveredPublicBaseUrl) {
      return;
    }
    discoveredPublicBaseUrl = normalized;
    const publicCallbackUrl = buildCallbackUrlFromBase(normalized, config.cardCallbackPath);
    console.log(`card callback public url ${publicCallbackUrl}`);
    await updateCardCallbackRuntimeState(state, stateFile, {
      status: 'tunnel_ready',
      publicBaseUrl: normalized,
      publicCallbackUrl,
      tunnelPid: child.pid || null,
      tunnelCommand: formatCommandForLog(tunnelBin, resolvedArgs),
    });
    tunnelReadyResolve(normalized);
  };
  const onTunnelLine = (stream, line) => {
    if (!line.trim()) {
      return;
    }
    console.log(`[card tunnel ${stream}] ${line}`);
    const urls = extractPublicHttpUrls(line);
    if (urls.length > 0) {
      void maybeSetPublicBaseUrl(urls[0]);
    }
  };
  const stdoutLogger = createLineLogger('stdout', onTunnelLine);
  const stderrLogger = createLineLogger('stderr', onTunnelLine);
  child.stdout?.on('data', (chunk) => {
    const urls = extractPublicHttpUrls(chunk.toString());
    if (urls.length > 0) {
      void maybeSetPublicBaseUrl(urls[0]);
    }
    stdoutLogger(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    const urls = extractPublicHttpUrls(chunk.toString());
    if (urls.length > 0) {
      void maybeSetPublicBaseUrl(urls[0]);
    }
    stderrLogger(chunk);
  });

  child.on('error', async (error) => {
    console.error(`card callback tunnel failed: ${describeError(error)}`);
    await updateCardCallbackRuntimeState(state, stateFile, {
      status: 'tunnel_error',
      tunnelPid: null,
      publicBaseUrl: discoveredPublicBaseUrl,
      publicCallbackUrl: buildCallbackUrlFromBase(discoveredPublicBaseUrl, config.cardCallbackPath),
    });
    tunnelReadyResolve('');
  });
  child.on('exit', async (code, signal) => {
    console.log(`card callback tunnel exited code=${code ?? 'null'} signal=${signal ?? 'none'}`);
    await updateCardCallbackRuntimeState(state, stateFile, {
      status: 'tunnel_exited',
      tunnelPid: null,
      publicBaseUrl: discoveredPublicBaseUrl,
      publicCallbackUrl: buildCallbackUrlFromBase(discoveredPublicBaseUrl, config.cardCallbackPath),
    });
  });

  await updateCardCallbackRuntimeState(state, stateFile, {
    status: 'tunnel_starting',
    localCallbackUrl,
    publicBaseUrl: '',
    publicCallbackUrl: '',
    tunnelPid: child.pid || null,
    tunnelCommand: formatCommandForLog(tunnelBin, resolvedArgs),
  });

  const timeoutHandle = setTimeout(() => {
    tunnelReadyResolve('');
  }, DEFAULT_CARD_CALLBACK_TUNNEL_STARTUP_TIMEOUT_MS);
  const initialPublicBaseUrl = await tunnelReady.finally(() => {
    clearTimeout(timeoutHandle);
  });

  if (!initialPublicBaseUrl) {
    console.warn('card callback tunnel started, but no public URL was detected yet. Keep watching the gateway logs.');
  }

  return {
    child,
    publicBaseUrl: initialPublicBaseUrl,
  };
}

function getFeishuFileUploadMaxBytes(config = {}) {
  return normalizePositiveInteger(config.feishuFileUploadMaxBytes, DEFAULT_FEISHU_FILE_UPLOAD_MAX_BYTES);
}

function getFeishuFileSplitChunkBytes(config = {}) {
  return Math.min(
    getFeishuFileUploadMaxBytes(config),
    normalizePositiveInteger(config.feishuFileSplitChunkBytes, DEFAULT_FEISHU_FILE_SPLIT_CHUNK_BYTES),
  );
}

function isRetryableFeishuError(error) {
  const text = describeError(error).toLowerCase();
  return [
    'econnreset',
    'econnaborted',
    'etimedout',
    'timeout',
    'socket hang up',
    'aggregateerror',
    'tenant_access_token',
    'network error',
    'temporary failure',
    'eacces',
  ].some((token) => text.includes(token));
}

async function withRetry(label, fn, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || DEFAULT_FEISHU_API_RETRY_ATTEMPTS);
  const baseDelayMs = Math.max(100, Number(options.baseDelayMs) || DEFAULT_FEISHU_API_RETRY_BASE_DELAY_MS);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableFeishuError(error)) {
        throw error;
      }
      const delayMs = baseDelayMs * attempt;
      console.warn(`${label} failed on attempt ${attempt}/${attempts}: ${describeError(error)}; retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function normalizeList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function currentBootId() {
  return String(Math.floor((Date.now() - (os.uptime() * 1000)) / 1000));
}

function withDefaults(config, overrides = {}) {
  const merged = {
    domain: 'feishu',
    workspace: DEFAULT_WORKSPACE,
    codexBin: DEFAULT_CODEX_BIN,
    codexSessionsRoot: DEFAULT_CODEX_SESSIONS_ROOT,
    stateFile: DEFAULT_STATE_PATH,
    usageLedgerEnabled: true,
    usageLedgerFile: DEFAULT_USAGE_LEDGER_PATH,
    dmPolicy: 'open',
    groupPolicy: 'open',
    allowFrom: ['*'],
    groupAllowFrom: ['*'],
    requireMentionInGroups: false,
    replyChunkLimit: DEFAULT_REPLY_CHUNK_LIMIT,
    codexTimeoutMs: DEFAULT_CODEX_TIMEOUT_MS,
    codexFirstEventTimeoutMs: DEFAULT_CODEX_FIRST_EVENT_TIMEOUT_MS,
    groupSessionScope: DEFAULT_GROUP_SESSION_SCOPE,
    groupAssistantMode: DEFAULT_GROUP_ASSISTANT_MODE,
    groupPublicMemoryLimit: DEFAULT_GROUP_PUBLIC_MEMORY_LIMIT,
    groupHighlightLimit: DEFAULT_GROUP_HIGHLIGHT_LIMIT,
    codexArgs: [],
    typingIndicator: true,
    typingEmoji: DEFAULT_TYPING_EMOJI,
    progressUpdates: DEFAULT_PROGRESS_UPDATES,
    progressCommandUpdates: DEFAULT_PROGRESS_COMMAND_UPDATES,
    progressInitialDelayMs: DEFAULT_PROGRESS_INITIAL_DELAY_MS,
    progressUpdateIntervalMs: DEFAULT_PROGRESS_UPDATE_INTERVAL_MS,
    progressMaxMessages: DEFAULT_PROGRESS_MAX_MESSAGES,
    mediaRoot: path.join(DEFAULT_ROOT, 'media'),
    startupNotifyChatIds: [],
    startupNotifyMessage: '',
    startupNotifyDeduplicatePerBoot: true,
    startupMorningBriefEnabled: false,
    startupMorningBriefChatIds: [],
    startupMorningBriefMaxItems: 4,
    startupMorningBriefMaxAgeDays: 7,
    startupMorningBriefDeduplicateDaily: true,
    startupMorningBriefTimeZone: DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE,
    feishuFileUploadMaxBytes: DEFAULT_FEISHU_FILE_UPLOAD_MAX_BYTES,
    feishuFileSplitChunkBytes: DEFAULT_FEISHU_FILE_SPLIT_CHUNK_BYTES,
    planFirstForTasks: true,
    autoPlanInGroups: false,
    planQuestionLimit: DEFAULT_PLAN_QUESTION_LIMIT,
    planCardsEnabled: true,
    cardCallbackEnabled: false,
    cardLongConnectionEnabled: false,
    cardCallbackHost: DEFAULT_CARD_CALLBACK_HOST,
    cardCallbackPort: DEFAULT_CARD_CALLBACK_PORT,
    cardCallbackPath: DEFAULT_CARD_CALLBACK_PATH,
    cardCallbackAutoChallenge: DEFAULT_CARD_CALLBACK_AUTO_CHALLENGE,
    cardCallbackPublicBaseUrl: '',
    cardCallbackTunnelEnabled: false,
    cardCallbackTunnelBin: '',
    cardCallbackTunnelArgs: [],
    verificationToken: '',
    encryptKey: '',
    cardActionRequireSameUser: true,
    simpleTaskMaxChars: DEFAULT_SIMPLE_TASK_MAX_CHARS,
    simpleTaskMaxLines: DEFAULT_SIMPLE_TASK_MAX_LINES,
    ...config,
    ...overrides,
  };
  merged.allowFrom = normalizeList(merged.allowFrom);
  merged.groupAllowFrom = normalizeList(merged.groupAllowFrom);
  merged.startupNotifyChatIds = normalizeList(merged.startupNotifyChatIds);
  merged.startupMorningBriefChatIds = normalizeList(merged.startupMorningBriefChatIds);
  merged.codexArgs = Array.isArray(merged.codexArgs) ? merged.codexArgs.map(String) : [];
  merged.replyChunkLimit = Number(merged.replyChunkLimit) || DEFAULT_REPLY_CHUNK_LIMIT;
  merged.codexTimeoutMs = Number(merged.codexTimeoutMs) || DEFAULT_CODEX_TIMEOUT_MS;
  {
    const parsedFirstEventTimeoutMs = Number(merged.codexFirstEventTimeoutMs);
    merged.codexFirstEventTimeoutMs = Number.isFinite(parsedFirstEventTimeoutMs) && parsedFirstEventTimeoutMs >= 0
      ? parsedFirstEventTimeoutMs
      : DEFAULT_CODEX_FIRST_EVENT_TIMEOUT_MS;
  }
  merged.progressCommandUpdates = normalizeBoolean(merged.progressCommandUpdates, DEFAULT_PROGRESS_COMMAND_UPDATES);
  merged.groupPublicMemoryLimit = Math.max(6, Number(merged.groupPublicMemoryLimit) || DEFAULT_GROUP_PUBLIC_MEMORY_LIMIT);
  merged.groupHighlightLimit = Math.max(3, Number(merged.groupHighlightLimit) || DEFAULT_GROUP_HIGHLIGHT_LIMIT);
  merged.progressInitialDelayMs = Math.max(0, Number(merged.progressInitialDelayMs) || DEFAULT_PROGRESS_INITIAL_DELAY_MS);
  merged.progressUpdateIntervalMs = Math.max(1000, Number(merged.progressUpdateIntervalMs) || DEFAULT_PROGRESS_UPDATE_INTERVAL_MS);
  merged.progressMaxMessages = Math.max(1, Number(merged.progressMaxMessages) || DEFAULT_PROGRESS_MAX_MESSAGES);
  merged.mediaRoot = path.resolve(String(merged.mediaRoot || path.join(DEFAULT_ROOT, 'media')));
  merged.codexSessionsRoot = path.resolve(String(merged.codexSessionsRoot || DEFAULT_CODEX_SESSIONS_ROOT));
  merged.usageLedgerEnabled = normalizeBoolean(merged.usageLedgerEnabled, true);
  merged.usageLedgerFile = path.resolve(String(merged.usageLedgerFile || DEFAULT_USAGE_LEDGER_PATH));
  merged.startupNotifyMessage = String(merged.startupNotifyMessage || '').trim();
  merged.startupNotifyDeduplicatePerBoot = merged.startupNotifyDeduplicatePerBoot !== false;
  merged.startupMorningBriefEnabled = normalizeBoolean(merged.startupMorningBriefEnabled, false);
  merged.startupMorningBriefMaxItems = Math.max(1, Math.min(6, Number(merged.startupMorningBriefMaxItems) || 4));
  merged.startupMorningBriefMaxAgeDays = Math.max(1, Math.min(14, Number(merged.startupMorningBriefMaxAgeDays) || 5));
  merged.startupMorningBriefDeduplicateDaily = normalizeBoolean(merged.startupMorningBriefDeduplicateDaily, true);
  merged.startupMorningBriefTimeZone = String(merged.startupMorningBriefTimeZone || DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE).trim() || DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE;
  merged.feishuFileUploadMaxBytes = getFeishuFileUploadMaxBytes(merged);
  merged.feishuFileSplitChunkBytes = getFeishuFileSplitChunkBytes(merged);
  merged.planFirstForTasks = merged.planFirstForTasks !== false;
  merged.autoPlanInGroups = merged.autoPlanInGroups === true;
  merged.planQuestionLimit = Math.max(1, Math.min(5, Number(merged.planQuestionLimit) || DEFAULT_PLAN_QUESTION_LIMIT));
  merged.planCardsEnabled = normalizeBoolean(merged.planCardsEnabled, true);
  merged.cardCallbackEnabled = normalizeBoolean(merged.cardCallbackEnabled, false);
  merged.cardLongConnectionEnabled = normalizeBoolean(merged.cardLongConnectionEnabled, false);
  merged.cardCallbackHost = String(merged.cardCallbackHost || DEFAULT_CARD_CALLBACK_HOST).trim() || DEFAULT_CARD_CALLBACK_HOST;
  merged.cardCallbackPort = normalizePositiveInteger(merged.cardCallbackPort, DEFAULT_CARD_CALLBACK_PORT);
  merged.cardCallbackPath = normalizeHttpPath(merged.cardCallbackPath, DEFAULT_CARD_CALLBACK_PATH);
  merged.cardCallbackAutoChallenge = normalizeBoolean(merged.cardCallbackAutoChallenge, DEFAULT_CARD_CALLBACK_AUTO_CHALLENGE);
  merged.cardCallbackPublicBaseUrl = normalizeUrlBase(merged.cardCallbackPublicBaseUrl);
  merged.cardCallbackTunnelEnabled = normalizeBoolean(merged.cardCallbackTunnelEnabled, false);
  merged.cardCallbackTunnelBin = String(merged.cardCallbackTunnelBin || '').trim();
  merged.cardCallbackTunnelArgs = normalizeStringArray(merged.cardCallbackTunnelArgs);
  merged.verificationToken = String(merged.verificationToken || '').trim();
  merged.encryptKey = String(merged.encryptKey || '').trim();
  merged.cardActionRequireSameUser = normalizeBoolean(merged.cardActionRequireSameUser, true);
  merged.simpleTaskMaxChars = Math.max(24, normalizePositiveInteger(merged.simpleTaskMaxChars, DEFAULT_SIMPLE_TASK_MAX_CHARS));
  merged.simpleTaskMaxLines = Math.max(1, normalizePositiveInteger(merged.simpleTaskMaxLines, DEFAULT_SIMPLE_TASK_MAX_LINES));
  return merged;
}

function createClient(config) {
  return new Lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: config.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
  });
}

function isWsReadyLog(args) {
  return args.map((item) => String(item)).join(' ').includes('ws client ready');
}

function createWsLogger(hooks = {}) {
  const emit = (level, args) => {
    const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    writer(`[${level}]:`, args);
    if (level === 'info' && isWsReadyLog(args) && typeof hooks.onReady === 'function') {
      Promise.resolve(hooks.onReady()).catch((error) => {
        console.error(`startup ready hook failed: ${describeError(error)}`);
      });
    }
  };
  return {
    trace: (...args) => emit('trace', args),
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    fatal: (...args) => emit('fatal', args),
  };
}

function patchWsClientForCardMessages() {
  const proto = Lark?.WSClient?.prototype;
  if (!proto || proto.__codexCardMessagePatchApplied) {
    return;
  }
  proto.__codexCardMessagePatchApplied = true;
  proto.handleEventData = async function handleEventDataWithCards(frame) {
    const headers = frame.headers.reduce((acc, cur) => {
      acc[cur.key] = cur.value;
      return acc;
    }, {});
    const { message_id, sum, seq, type, trace_id } = headers;
    const payload = frame.payload;
    console.log(`feishu ws data frame type=${type || '-'} trace_id=${trace_id || '-'} message_id=${message_id || '-'} seq=${seq || '-'} sum=${sum || '-'} payload_bytes=${payload?.length || 0}`);
    if (type !== WS_MESSAGE_TYPE_EVENT && type !== WS_MESSAGE_TYPE_CARD) {
      return;
    }
    const mergedData = this.dataCache.mergeData({
      message_id,
      sum: Number(sum),
      seq: Number(seq),
      trace_id,
      data: payload,
    });
    if (!mergedData) {
      return;
    }
    this.logger.debug('[ws]', `receive message, message_type: ${type}; message_id: ${message_id}; trace_id: ${trace_id}; data: ${JSON.stringify(mergedData)}`);
    if (type === WS_MESSAGE_TYPE_CARD || looksLikeCardActionPayload(mergedData) || isKnownCardActionEventType(mergedData)) {
      console.log(`feishu ws callback frame type=${type} trace_id=${trace_id || '-'} summary=${summarizeCardActionPayload(mergedData)}`);
      console.log(`feishu ws callback raw=${clipJsonText(mergedData, 1600)}`);
    }
    const responsePayload = { code: WS_ACK_OK };
    const startedAt = Date.now();
    try {
      const result = await this.eventDispatcher?.invoke?.(mergedData, { needCheck: false, messageType: type });
      if (result) {
        responsePayload.data = Buffer.from(JSON.stringify(result)).toString('base64');
      }
    } catch (error) {
      responsePayload.code = WS_ACK_INTERNAL_ERROR;
      this.logger.error('[ws]', `invoke event failed, message_type: ${type}; message_id: ${message_id}; trace_id: ${trace_id}; error: ${error}`);
    }
    const finishedAt = Date.now();
    this.sendMessage({
      ...frame,
      headers: [...frame.headers, { key: WS_HEADER_KEY_BIZ_RT, value: String(finishedAt - startedAt) }],
      payload: new TextEncoder().encode(JSON.stringify(responsePayload)),
    });
  };
}

function createWsClient(config, hooks = {}) {
  patchWsClientForCardMessages();
  return new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: config.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.info,
    logger: createWsLogger(hooks),
  });
}

async function fetchBotInfo(config) {
  const client = createClient(config);
  const response = await withRetry('fetch bot info', async () => client.request({
    method: 'GET',
    url: '/open-apis/bot/v3/info',
    data: {},
    timeout: 10000,
  }));
  if (response.code !== 0) {
    throw new Error(`bot info failed: ${JSON.stringify(response)}`);
  }
  const bot = response.bot || response.data?.bot || {};
  return {
    botOpenId: bot.open_id || '',
    botName: bot.app_name || bot.bot_name || config.botName || 'Codex Bot',
    activateStatus: bot.activate_status,
  };
}

function loadMessageText(message) {
  const raw = message.content || '';
  if (message.message_type === 'text') {
    try {
      return JSON.parse(raw).text || '';
    } catch {
      return raw;
    }
  }
  if (message.message_type === 'post') {
    try {
      const parsed = JSON.parse(raw);
      const lines = [];
      for (const section of parsed.content || []) {
        for (const node of section) {
          if (node.tag === 'text' && node.text) {
            lines.push(node.text);
          }
        }
      }
      return lines.join(' ').trim();
    } catch {
      return raw;
    }
  }
  return '';
}

function parseMediaKeys(content, messageType) {
  try {
    const parsed = JSON.parse(content || '{}');
    const imageKey = parsed.image_key || '';
    const fileKey = parsed.file_key || '';
    switch (messageType) {
      case 'image':
        return { imageKey };
      case 'file':
        return { fileKey, fileName: parsed.file_name || '' };
      default:
        return {};
    }
  } catch {
    return {};
  }
}

function sanitizeFileName(fileName) {
  const base = String(fileName || 'attachment').trim() || 'attachment';
  return base.replace(/[\\/:*?"<>|]/g, '_');
}

function sanitizeFileNameForUpload(fileName) {
  const asciiOnly = /^[\x20-\x7E]+$/;
  if (asciiOnly.test(fileName)) {
    return fileName;
  }
  return encodeURIComponent(fileName).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function extensionForMessageType(messageType) {
  switch (messageType) {
    case 'image':
      return '.png';
    case 'file':
      return '.bin';
    default:
      return '';
  }
}

async function readFeishuResponseBuffer(response) {
  if (Buffer.isBuffer(response)) return response;
  if (response instanceof ArrayBuffer) return Buffer.from(response);
  if (response?.data && Buffer.isBuffer(response.data)) return response.data;
  if (response?.data instanceof ArrayBuffer) return Buffer.from(response.data);
  if (typeof response?.getReadableStream === 'function') {
    const stream = response.getReadableStream();
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (typeof response?.writeFile === 'function') {
    const tmpPath = path.join(os.tmpdir(), `feishu-resource-${randomUUID()}`);
    await response.writeFile(tmpPath);
    const buffer = await fs.readFile(tmpPath);
    await fs.rm(tmpPath, { force: true });
    return buffer;
  }
  if (typeof response?.[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of response) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('unexpected Feishu media response');
}

async function downloadMessageResource(client, messageId, fileKey, type) {
  const response = await withRetry(`download ${type} resource for ${messageId}`, async () => client.im.messageResource.get({
    path: { message_id: messageId, file_key: fileKey },
    params: { type },
  }));
  if (response?.code && response.code !== 0) {
    throw new Error(response.msg || `code ${response.code}`);
  }
  return readFeishuResponseBuffer(response);
}

async function saveInboundAttachment(config, buffer, originalName, messageType) {
  const inboundDir = path.join(config.mediaRoot, 'inbound');
  await fs.mkdir(inboundDir, { recursive: true });
  const safeName = sanitizeFileName(originalName || `attachment-${Date.now()}${extensionForMessageType(messageType)}`);
  const ext = path.extname(safeName) || extensionForMessageType(messageType);
  const stem = path.basename(safeName, ext) || `attachment-${Date.now()}`;
  const finalPath = path.join(inboundDir, `${stem}-${randomUUID()}${ext}`);
  await fs.writeFile(finalPath, buffer);
  return finalPath;
}

async function resolveInboundAttachments(config, client, message) {
  const messageType = message.message_type || '';
  if (!['image', 'file'].includes(messageType)) {
    return [];
  }
  const content = message.content || '';
  const { imageKey, fileKey, fileName } = parseMediaKeys(content, messageType);
  const resourceKey = fileKey || imageKey;
  if (!resourceKey) {
    return [];
  }
  try {
    const resourceType = messageType === 'image' ? 'image' : 'file';
    const buffer = await downloadMessageResource(client, message.message_id, resourceKey, resourceType);
    const savedPath = await saveInboundAttachment(config, buffer, fileName || `${messageType}${extensionForMessageType(messageType)}`, messageType);
    return [{ path: savedPath, fileName: path.basename(savedPath), messageType }];
  } catch (error) {
    console.warn(`failed to download inbound ${messageType}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function normalizeMentions(text, mentions, botOpenId) {
  if (!mentions || mentions.length === 0) {
    return text.trim();
  }
  let result = text;
  for (const mention of mentions) {
    const replacement = mention.id?.open_id === botOpenId ? '' : `@${mention.name || 'user'}`;
    if (mention.key) {
      result = result.split(mention.key).join(replacement);
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

function isBotMentioned(event, botOpenId) {
  if (!botOpenId) {
    return false;
  }
  const raw = event.message?.content || '';
  if (raw.includes('@_all')) {
    return true;
  }
  return (event.message?.mentions || []).some((mention) => mention.id?.open_id === botOpenId);
}

function senderOpenIdOf(event) {
  return event.sender?.sender_id?.open_id || event.sender?.sender_id?.user_id || '';
}

function isAllowedEvent(event, config) {
  const chatType = event.message?.chat_type;
  const senderOpenId = senderOpenIdOf(event);
  const chatId = event.message?.chat_id || '';
  const senderAllowed = config.allowFrom.includes('*') || (senderOpenId && config.allowFrom.includes(senderOpenId));
  if (chatType === 'p2p' || chatType === 'private') {
    if (config.dmPolicy === 'allowlist') {
      return senderAllowed;
    }
    return true;
  }
  if (config.groupPolicy === 'disabled') {
    return false;
  }
  const groupAllowed = config.groupAllowFrom.includes('*') || (chatId && config.groupAllowFrom.includes(chatId));
  if (config.groupPolicy === 'allowlist' && !groupAllowed) {
    return false;
  }
  return senderAllowed || config.allowFrom.includes('*');
}

function sessionKeyOf(event, config) {
  const chatId = event.message.chat_id;
  const senderOpenId = senderOpenIdOf(event) || 'unknown';
  const chatType = event.message.chat_type;
  if (chatType === 'group' && config.groupSessionScope === 'group_sender') {
    return `${chatId}:sender:${senderOpenId}`;
  }
  return chatId;
}

function parseSlashCommand(text) {
  const normalized = String(text || '').trim();
  const match = normalized.match(/^\/([a-z]+)(?:\s+([\s\S]+))?$/i);
  if (!match) {
    return null;
  }
  return {
    name: String(match[1] || '').toLowerCase(),
    args: String(match[2] || '').trim(),
    raw: normalized,
  };
}

function clipText(text, limit = MAX_GROUP_MEMORY_TEXT_LENGTH) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function isPlanApprovalCommand(commandName) {
  return ['approve', 'go'].includes(String(commandName || '').toLowerCase());
}

function isPlanCancelCommand(commandName) {
  return ['cancel', 'discard'].includes(String(commandName || '').toLowerCase());
}

function isDirectExecuteCommand(commandName) {
  return ['run', 'execute'].includes(String(commandName || '').toLowerCase());
}

function isExecutionStopCommand(commandName) {
  return ['stop', 'abort'].includes(String(commandName || '').toLowerCase());
}

function normalizePlanDirectiveStatus(status, questions = []) {
  const normalized = String(status || '').trim().toLowerCase();
  if (['needs_input', 'awaiting_answers', 'question', 'questions', 'needs-info'].includes(normalized)) {
    return 'needs_input';
  }
  if (['ready', 'awaiting_approval', 'approval', 'approved'].includes(normalized)) {
    return 'ready';
  }
  return questions.length > 0 ? 'needs_input' : 'ready';
}

function inferPlanQuestionsFromReply(text, limit = DEFAULT_PLAN_QUESTION_LIMIT) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim());
  const headingPattern = /^(open questions?|questions?|待确认|需要确认|待补充|缺失信息|需要补充的信息)\s*[:：]?$/i;
  const stopPattern = /^(approval gate|next step|next steps|plan|proposed plan|实施计划|计划|假设|assumptions|findings|goal|总结|summary)\s*[:：]?$/i;
  const questions = [];
  let capture = false;
  for (const line of lines) {
    if (!capture && headingPattern.test(line)) {
      capture = true;
      continue;
    }
    if (!capture) {
      continue;
    }
    if (!line) {
      if (questions.length > 0) {
        break;
      }
      continue;
    }
    const normalized = line.replace(/^[-*•\d.)\s]+/, '').trim();
    if (!normalized) {
      continue;
    }
    if (stopPattern.test(normalized)) {
      break;
    }
    questions.push(clipText(normalized, 220));
    if (questions.length >= limit) {
      break;
    }
  }
  return questions;
}

function extractPlanDirective(text, questionLimit = DEFAULT_PLAN_QUESTION_LIMIT) {
  const raw = String(text || '');
  const match = raw.match(/\[feishu-plan\]([\s\S]*?)\[\/feishu-plan\]/im);
  if (!match) {
    const inferredQuestions = inferPlanQuestionsFromReply(raw, questionLimit);
    return {
      cleanText: raw.trim(),
      plan: inferredQuestions.length > 0 ? {
        status: 'needs_input',
        questions: inferredQuestions,
      } : null,
    };
  }

  const block = match[1];
  const questions = [];
  let status = '';
  for (const line of block.split(/\r?\n/).map((row) => row.trim()).filter(Boolean)) {
    const statusMatch = line.match(/^status\s*:\s*(.+)$/i);
    if (statusMatch) {
      status = statusMatch[1].trim();
      continue;
    }
    const questionMatch = line.match(/^question\s*:\s*(.+)$/i);
    if (questionMatch) {
      questions.push(clipText(questionMatch[1].trim(), 220));
    }
  }

  const cleanText = raw.replace(match[0], '').replace(/\n{3,}/g, '\n\n').trim();
  const normalizedQuestions = questions.filter(Boolean).slice(0, questionLimit);
  return {
    cleanText,
    plan: {
      status: normalizePlanDirectiveStatus(status, normalizedQuestions),
      questions: normalizedQuestions,
    },
  };
}

function decoratePlanReply(text, planMeta) {
  const cleanText = String(text || '').trim();
  if (!planMeta) {
    return cleanText;
  }
  const footer = planMeta.status === 'needs_input'
    ? 'Reply in this chat with the missing info and I will update the plan.'
    : 'Reply with revisions, or send /approve to start implementation.';
  if (!cleanText) {
    return footer;
  }
  return `${cleanText}\n\n${footer}`;
}

function ensurePlanSessions(state) {
  state.planSessions ||= {};
  return state.planSessions;
}

function getPlanSession(state, key) {
  return state.planSessions?.[key] || null;
}

function clearPlanSession(state, key) {
  if (!state.planSessions) {
    return;
  }
  delete state.planSessions[key];
}

function clearBoundCodexThread(state, key, threadId = '') {
  const normalizedThreadId = String(threadId || '').trim();
  const existingSession = state.chatSessions?.[key];
  if (existingSession && (!normalizedThreadId || existingSession.threadId === normalizedThreadId)) {
    delete state.chatSessions[key];
  }
  const planSession = getPlanSession(state, key);
  if (planSession && (!normalizedThreadId || planSession.threadId === normalizedThreadId)) {
    planSession.threadId = '';
    planSession.updatedAt = nowIso();
  }
}

function buildUserStopError(message = 'Stopped by user via /stop.') {
  const error = new Error(String(message || 'Stopped by user via /stop.'));
  error.code = 'USER_STOP_REQUESTED';
  return error;
}

function isUserStopError(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'USER_STOP_REQUESTED');
}

function registerActiveRunController(key, control) {
  activeRunControllers.set(String(key || ''), control);
}

function clearActiveRunController(key, sourceMessageId = '') {
  const normalizedKey = String(key || '');
  if (!normalizedKey) {
    return;
  }
  const existing = activeRunControllers.get(normalizedKey);
  if (!existing) {
    return;
  }
  if (sourceMessageId && existing.sourceMessageId && existing.sourceMessageId !== sourceMessageId) {
    return;
  }
  activeRunControllers.delete(normalizedKey);
}

function hasLiveActiveRunController(key, sourceMessageId = '') {
  const normalizedKey = String(key || '');
  if (!normalizedKey) {
    return false;
  }
  const existing = activeRunControllers.get(normalizedKey);
  if (!existing?.abortController || existing.abortController.signal?.aborted) {
    return false;
  }
  if (sourceMessageId && existing.sourceMessageId && existing.sourceMessageId !== sourceMessageId) {
    return false;
  }
  return true;
}

function requestActiveRunStop(key, reason = 'Stopped by user via /stop.') {
  const normalizedKey = String(key || '');
  if (!normalizedKey) {
    return 'not_found';
  }
  const existing = activeRunControllers.get(normalizedKey);
  if (!existing?.abortController) {
    return 'not_found';
  }
  if (existing.stopRequested || existing.abortController.signal?.aborted) {
    return 'already_requested';
  }
  existing.stopRequested = true;
  existing.stopRequestedAt = nowIso();
  existing.abortController.abort(buildUserStopError(reason));
  return 'requested';
}

function planCardActionsEnabled(config) {
  return Boolean(config.planCardsEnabled && (config.cardCallbackEnabled || config.cardLongConnectionEnabled));
}

function clipCardText(text, limit = 900) {
  return clipText(String(text || '').replace(/\r/g, ''), limit);
}

function buildPlanCardActionValue(action, key, planSession) {
  return {
    action,
    session_key: key,
    plan_updated_at: planSession?.updatedAt || '',
  };
}

function buildPlanCard({ key, planSession, config, statusText = '', detailText = '' }) {
  const status = String(planSession?.status || 'awaiting_approval');
  const actionsEnabled = planCardActionsEnabled(config);
  const summaryText = clipCardText(planSession?.latestPlanText || '', 1200);
  const questions = Array.isArray(planSession?.questions) ? planSession.questions.filter(Boolean) : [];
  const title = status === 'awaiting_answers'
    ? 'Plan needs more input'
    : status === 'approval_started'
      ? 'Execution started'
      : status === 'canceled'
        ? 'Plan canceled'
        : status === 'stale'
          ? 'Plan updated'
          : status === 'error'
            ? 'Plan action failed'
            : 'Plan ready for approval';
  const template = status === 'awaiting_answers'
    ? 'orange'
    : status === 'approval_started'
      ? 'green'
      : status === 'canceled'
        ? 'grey'
        : status === 'error'
          ? 'red'
          : 'blue';
  const introText = statusText
    || (status === 'awaiting_answers'
      ? 'Reply in chat with the missing details and I will refresh the plan.'
      : status === 'approval_started'
        ? 'Execution has started. Progress updates will be posted in chat.'
        : status === 'canceled'
          ? 'This pending plan has been canceled.'
          : status === 'stale'
            ? 'This card was stale. The latest plan state is shown below.'
            : actionsEnabled
              ? 'Approve to start execution, revise in chat, or cancel this plan.'
              : 'Card actions are offline. Use /approve or /cancel in chat after you configure the callback endpoint.');
  const bodyText = status === 'awaiting_answers'
    ? questions.length > 0
      ? `Open questions:\n- ${questions.join('\n- ')}`
      : 'The plan still needs user input.'
    : summaryText || 'No plan summary is available.';
  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: clipCardText(introText, 300),
      },
    },
    {
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: clipCardText(bodyText, 1200),
      },
    },
  ];
  if (detailText) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: clipCardText(detailText, 400),
      },
    });
  }
  if (status === 'awaiting_approval' && actionsEnabled) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          type: 'primary',
          text: { tag: 'plain_text', content: 'Approve' },
          value: buildPlanCardActionValue('approve_plan', key, planSession),
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: 'Revise' },
          value: buildPlanCardActionValue('revise_plan', key, planSession),
        },
        {
          tag: 'button',
          type: 'danger',
          text: { tag: 'plain_text', content: 'Cancel' },
          value: buildPlanCardActionValue('cancel_plan', key, planSession),
        },
      ],
    });
  }
  if (status === 'awaiting_answers' && actionsEnabled) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          type: 'danger',
          text: { tag: 'plain_text', content: 'Cancel' },
          value: buildPlanCardActionValue('cancel_plan', key, planSession),
        },
      ],
    });
  }
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template,
      title: {
        tag: 'plain_text',
        content: title,
      },
    },
    elements,
  };
}

function markPlanExecutionRequested(state, key, actorOpenId = '') {
  const planSession = getPlanSession(state, key);
  if (!planSession) {
    return null;
  }
  planSession.status = 'approval_started';
  planSession.updatedAt = nowIso();
  if (actorOpenId) {
    planSession.approvedByOpenId = actorOpenId;
  }
  planSession.approvedAt = nowIso();
  return planSession;
}

function buildSyntheticEventFromPlanSession(planSession, senderOpenId = '', messageId = '') {
  return {
    message: {
      chat_id: planSession?.chatId || '',
      chat_type: planSession?.chatType || 'p2p',
      message_id: messageId || planSession?.lastMessageId || `synthetic-${randomUUID()}`,
      create_time: String(Date.now()),
      mentions: [],
    },
    sender: {
      sender_id: {
        open_id: senderOpenId || planSession?.senderOpenId || '',
      },
      sender_type: 'user',
    },
  };
}

function buildSyntheticStartupEvent(chatId, senderOpenId = STARTUP_NOTIFY_SYNTHETIC_SENDER_OPEN_ID, messageId = '') {
  return {
    message: {
      chat_id: chatId || '',
      chat_type: 'group',
      message_id: messageId || `synthetic-${randomUUID()}`,
      create_time: String(Date.now()),
      mentions: [],
    },
    sender: {
      sender_id: {
        open_id: senderOpenId || STARTUP_NOTIFY_SYNTHETIC_SENDER_OPEN_ID,
      },
      sender_type: 'user',
    },
  };
}

function senderOpenIdFromSessionKey(sessionKey) {
  const normalizedKey = String(sessionKey || '');
  const marker = ':sender:';
  const markerIndex = normalizedKey.indexOf(marker);
  if (markerIndex < 0) {
    return '';
  }
  return normalizedKey.slice(markerIndex + marker.length).trim();
}

function buildPlanFollowupPrompt(planSession, userText, mode = 'answers') {
  const heading = mode === 'revision'
    ? 'The user requested changes to the plan before approval. Update the plan.'
    : 'The user answered your open planning questions. Update the plan.';
  const parts = [
    heading,
    `Original request: ${planSession?.originalRequest || '(unknown)'}`,
  ];
  const priorQuestions = Array.isArray(planSession?.questions) ? planSession.questions.filter(Boolean) : [];
  if (priorQuestions.length > 0) {
    parts.push(`Outstanding questions before this reply:\n- ${priorQuestions.join('\n- ')}`);
  }
  parts.push(`User reply:\n${String(userText || '').trim()}`);
  return parts.join('\n\n');
}

function buildPlanExecutionPrompt(planSession, approvalNote = '') {
  const parts = [
    'The user approved the latest plan. Execute it now.',
    `Original request: ${planSession?.originalRequest || '(unknown)'}`,
  ];
  if (planSession?.latestPlanText) {
    parts.push(`Approved plan:\n${clipText(planSession.latestPlanText, 2400)}`);
  }
  if (approvalNote) {
    parts.push(`User note:\n${approvalNote}`);
  }
  parts.push('Proceed with implementation. Make concrete changes when appropriate and report the result.');
  return parts.join('\n\n');
}

function countMeaningfulLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
}

function isSimpleDirectExecuteCandidate({ classification, attachments = [], text, config }) {
  if (!classification?.taskLike) {
    return false;
  }
  if (attachments.length > 0) {
    return false;
  }
  if (classification.intent === 'sensitive_task') {
    return false;
  }
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    return false;
  }
  const lineCount = countMeaningfulLines(normalizedText);
  const punctuationCount = (normalizedText.match(/[，,；;、]/g) || []).length;
  if (normalizedText.length > config.simpleTaskMaxChars) {
    return false;
  }
  if (lineCount > config.simpleTaskMaxLines) {
    return false;
  }
  if (punctuationCount > 2) {
    return false;
  }
  if (SIMPLE_TASK_MULTI_STEP_PATTERN.test(normalizedText)) {
    return false;
  }
  if (SIMPLE_TASK_COMPLEXITY_PATTERN.test(normalizedText)) {
    return false;
  }
  return true;
}

function shouldAutoPlanMessage({ event, command, classification, attachments = [], text, config }) {
  if (command) {
    return false;
  }
  if (!config.planFirstForTasks) {
    return false;
  }
  if ((event.message?.chat_type || '') === 'group' && !config.autoPlanInGroups) {
    return false;
  }
  const normalizedText = String(text || '').trim();
  if (!normalizedText && attachments.length === 0) {
    return false;
  }
  if (attachments.length > 0) {
    return true;
  }
  if (classification.intent === 'sensitive_task') {
    return true;
  }
  if (!classification.taskLike) {
    return false;
  }
  return !isSimpleDirectExecuteCandidate({ classification, attachments, text: normalizedText, config });
}

function shortSenderId(senderOpenId) {
  const value = String(senderOpenId || 'unknown');
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function detectDecision(text) {
  return /(决定|结论|确认|统一|定了|定为|采用|通过|按这个|就这么|就这样)/i.test(text);
}

function detectTask(text) {
  return /(待办|todo|负责|截止|ddl|进度|排期|安排|跟进|完成|提交|处理|修改|修复|评审|review|上线|同步|看一下|帮我)/i.test(text);
}

function detectSummaryRequest(text) {
  return /(总结|汇总|概括|纪要|回顾|同步一下|总结下|帮我捋一下)/i.test(text);
}

function detectSensitive(text) {
  return /(密码|口令|验证码|token|secret|apikey|api key|appsecret|cookie|身份证|手机号|电话|邮箱|住址|工资|薪资|报价|合同|简历|隐私|敏感)/i.test(text);
}

function detectQuestion(text) {
  return /[?？]$/.test(text)
    || /^(谁|什么|怎么|为什么|为啥|能不能|可不可以|请问|how|what|why|who|when)/i.test(text);
}

function classifyMessage({ chatType, text, attachments = [] }) {
  const normalizedText = String(text || '').trim();
  const hasAttachment = attachments.length > 0;
  const containsSensitive = detectSensitive(normalizedText);
  const summaryRequest = detectSummaryRequest(normalizedText);
  const decisionLike = detectDecision(normalizedText);
  const taskLike = detectTask(normalizedText) || hasAttachment;
  const questionLike = detectQuestion(normalizedText);
  const explicitPrivate = /(私聊|单聊|私下|别在群里|转私聊|dm)/i.test(normalizedText);
  let intent = 'general';
  if (summaryRequest) {
    intent = 'summary';
  } else if (containsSensitive) {
    intent = 'sensitive_task';
  } else if (decisionLike) {
    intent = 'decision';
  } else if (taskLike) {
    intent = 'task';
  } else if (questionLike) {
    intent = 'question';
  }
  const shouldSuggestPrivate = chatType === 'group'
    && (explicitPrivate || containsSensitive || hasAttachment || (taskLike && normalizedText.length > 80));
  return {
    visibility: chatType === 'group' ? 'public' : 'private',
    intent,
    hasAttachment,
    containsSensitive,
    summaryRequest,
    questionLike,
    taskLike,
    decisionLike,
    shouldSuggestPrivate,
    responseMode: chatType === 'group' ? 'group_assistant' : 'personal_assistant',
  };
}

function ensureGroupContext(state, chatId) {
  state.groupContexts ||= {};
  state.groupContexts[chatId] ||= {
    updatedAt: '',
    recentMessages: [],
    participants: {},
    highlights: {
      tasks: [],
      decisions: [],
      questions: [],
    },
  };
  const context = state.groupContexts[chatId];
  context.recentMessages ||= [];
  context.participants ||= {};
  context.highlights ||= {};
  context.highlights.tasks ||= [];
  context.highlights.decisions ||= [];
  context.highlights.questions ||= [];
  return context;
}

function addUniqueHighlight(list, value, limit) {
  if (!value) {
    return;
  }
  const normalized = String(value).trim();
  if (!normalized || list.includes(normalized)) {
    return;
  }
  list.push(normalized);
  if (list.length > limit) {
    list.splice(0, list.length - limit);
  }
}

function updateGroupContext(state, event, text, attachments, classification, config) {
  const chatType = event.message?.chat_type || '';
  const chatId = event.message?.chat_id || '';
  if (chatType !== 'group' || !chatId) {
    return null;
  }
  const normalizedText = clipText(text);
  if ((!normalizedText && attachments.length === 0) || normalizedText.startsWith('/')) {
    return ensureGroupContext(state, chatId);
  }
  const context = ensureGroupContext(state, chatId);
  const senderOpenId = senderOpenIdOf(event) || 'unknown';
  const messageId = event.message?.message_id || randomUUID();
  const entryText = clipText(normalizedText || '(attachment only)');
  const attachmentNote = attachments.length > 0 ? ` [attachments:${attachments.length}]` : '';
  const senderState = context.participants[senderOpenId] || { messageCount: 0 };
  context.participants[senderOpenId] = {
    messageCount: Number(senderState.messageCount || 0) + 1,
    lastSeenAt: nowIso(),
    lastMessageId: messageId,
  };
  context.updatedAt = nowIso();
  context.recentMessages.push({
    messageId,
    senderOpenId,
    timestamp: event.message?.create_time || '',
    text: `${entryText}${attachmentNote}`.trim(),
    intent: classification.intent,
    shouldSuggestPrivate: Boolean(classification.shouldSuggestPrivate),
  });
  if (context.recentMessages.length > config.groupPublicMemoryLimit) {
    context.recentMessages.splice(0, context.recentMessages.length - config.groupPublicMemoryLimit);
  }
  const senderPrefix = shortSenderId(senderOpenId);
  if (classification.taskLike) {
    addUniqueHighlight(context.highlights.tasks, `${senderPrefix}: ${entryText}`, config.groupHighlightLimit);
  }
  if (classification.decisionLike) {
    addUniqueHighlight(context.highlights.decisions, `${senderPrefix}: ${entryText}`, config.groupHighlightLimit);
  }
  if (classification.questionLike) {
    addUniqueHighlight(context.highlights.questions, `${senderPrefix}: ${entryText}`, config.groupHighlightLimit);
  }
  return context;
}

function formatGroupContextForPrompt(groupContext) {
  if (!groupContext) {
    return ['participants_seen: 0', 'recent_public_messages:', '- (none)'];
  }
  const participantCount = Object.keys(groupContext.participants || {}).length;
  const recentMessages = (groupContext.recentMessages || []).slice(-DEFAULT_PROMPT_RECENT_GROUP_MESSAGES);
  const taskHighlights = groupContext.highlights?.tasks || [];
  const decisionHighlights = groupContext.highlights?.decisions || [];
  const questionHighlights = groupContext.highlights?.questions || [];
  const lines = [
    `participants_seen: ${participantCount}`,
    `memory_updated_at: ${groupContext.updatedAt || '-'}`,
    'recent_public_messages:',
    ...(recentMessages.length > 0
      ? recentMessages.map((entry) => `- [${entry.intent || 'general'}] ${shortSenderId(entry.senderOpenId)}: ${entry.text || '(empty)'}`)
      : ['- (none)']),
    'public_highlights_tasks:',
    ...(taskHighlights.length > 0 ? taskHighlights.map((item) => `- ${item}`) : ['- (none)']),
    'public_highlights_decisions:',
    ...(decisionHighlights.length > 0 ? decisionHighlights.map((item) => `- ${item}`) : ['- (none)']),
    'public_highlights_questions:',
    ...(questionHighlights.length > 0 ? questionHighlights.map((item) => `- ${item}`) : ['- (none)']),
  ];
  return lines;
}

function buildPrompt(event, text, attachments = [], options = {}) {
  const senderId = senderOpenIdOf(event) || 'unknown';
  const chatType = event.message?.chat_type || 'unknown';
  const chatId = event.message?.chat_id || 'unknown';
  const timestamp = event.message?.create_time || '';
  const classification = options.classification || classifyMessage({ chatType, text, attachments });
  const groupContext = options.groupContext || null;
  const parts = [
    'You are replying through a Feishu bot connected to Codex.',
    'Reply in concise plain text suitable for chat.',
    'Avoid markdown tables and code fences unless the user explicitly asks.',
    'If you want to send a local file or image back through Feishu, append one line per attachment exactly as: [feishu-attachment] <absolute-path>. Accept both POSIX paths like /tmp/file.pdf and Windows paths like C:\\path\\to\\file.pdf.',
    'In direct chats, act as a personal execution assistant and keep continuity for that sender only.',
    '',
    '[Feishu context]',
    `chat_type: ${chatType}`,
    `chat_id: ${chatId}`,
    `sender_open_id: ${senderId}`,
    `message_time: ${timestamp}`,
  ];
  if (chatType === 'group') {
    parts.push(
      '',
      '[Group assistant policy]',
      'You are acting in a group chat. Be a public group assistant first: answer briefly, summarize shared context, coordinate openly, and avoid flooding the group.',
      'Use only the public group memory below as shared context. Never reveal, rely on, or infer private direct-message context from any person.',
      'If the request looks sensitive, highly personal, attachment-heavy, or long-running, answer briefly in the group and suggest continuing in direct chat.',
      'If the user asks for a summary, progress update, or public feedback, prioritize the shared group memory below.',
      '',
      '[Message classification]',
      `visibility: ${classification.visibility}`,
      `intent: ${classification.intent}`,
      `contains_sensitive: ${classification.containsSensitive ? 'yes' : 'no'}`,
      `has_attachment: ${classification.hasAttachment ? 'yes' : 'no'}`,
      `suggest_private_followup: ${classification.shouldSuggestPrivate ? 'yes' : 'no'}`,
      '',
      '[Group public memory]',
      ...formatGroupContextForPrompt(groupContext),
    );
  } else {
    parts.push(
      '',
      '[Direct chat policy]',
      'You are in a direct chat. Focus on execution, continuity, and actionable next steps for this sender.',
      '',
      '[Message classification]',
      `visibility: ${classification.visibility}`,
      `intent: ${classification.intent}`,
      `contains_sensitive: ${classification.containsSensitive ? 'yes' : 'no'}`,
      `has_attachment: ${classification.hasAttachment ? 'yes' : 'no'}`,
    );
  }
  if (options.planOnly) {
    parts.push(
      '',
      '[Planning mode]',
      'Research first: inspect files, attachments, and other available context as needed.',
      'Do not edit files, do not apply patches, and do not claim the task is complete.',
      'Ask concise follow-up questions when key requirements or constraints are missing.',
      'Keep the response concise and structured as:',
      '1. Goal',
      '2. Findings',
      '3. Assumptions',
      '4. Plan',
      '5. Open questions or blockers',
      'After the user-visible response, append exactly:',
      '[feishu-plan]',
      'status: needs_input|ready',
      'question: <question text>',
      '[/feishu-plan]',
      'Use status needs_input when any blocking question remains. Use status ready when the plan is ready for approval and omit question lines in that case.',
    );
  }
  parts.push('', '[User message]', text);
  if (attachments.length > 0) {
    parts.push('', '[Attachments]');
    for (const attachment of attachments) {
      parts.push(`- type: ${attachment.messageType}`);
      parts.push(`  path: ${attachment.path}`);
      parts.push(`  file_name: ${attachment.fileName}`);
    }
  }
  return parts.join('\n');
}

async function createTempFile(prefix) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  return { dir: tmpDir, file: path.join(tmpDir, 'last-message.txt') };
}

// `exec resume` does not accept `-C` in newer Codex builds, so rely on cwd instead.
function buildCodexCliArgs(config, sessionId, outputFile) {
  const args = ['exec'];
  if (sessionId) {
    args.push('resume');
  }
  args.push('--json', '--skip-git-repo-check', '-o', outputFile);
  args.push(...config.codexArgs);
  if (sessionId) {
    args.push('--', sessionId, '-');
    return args;
  }
  args.push('--', '-');
  return args;
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function runCodexTurn(config, sessionId, prompt, hooks = {}) {
  const temp = await createTempFile('codex-feishu');
  const promptText = typeof prompt === 'string' ? prompt : String(prompt || '');
  const args = buildCodexCliArgs(config, sessionId, temp.file);
  return new Promise((resolve, reject) => {
    const child = spawn(config.codexBin, args, {
      cwd: config.workspace,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (typeof hooks.onSpawn === 'function') {
      try {
        hooks.onSpawn({ pid: child.pid, command: config.codexBin, args: [...args] });
      } catch (error) {
        console.warn(`spawn hook failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    child.stdin.end(promptText);
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let threadId = sessionId || '';
    let lastAgentMessage = '';
    let lastErrorMessage = '';
    let settled = false;
    let exitFallbackTimer = null;
    let firstEventTimeout = null;
    let sawJsonEvent = false;
    let abortSignal = hooks.signal || null;
    let abortHandler = null;
    const cleanupTemp = async () => {
      await fs.rm(temp.dir, { recursive: true, force: true });
    };
    const clearFirstEventTimeout = () => {
      if (!firstEventTimeout) {
        return;
      }
      clearTimeout(firstEventTimeout);
      firstEventTimeout = null;
    };
    const settleError = async (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearFirstEventTimeout();
      if (exitFallbackTimer) {
        clearTimeout(exitFallbackTimer);
        exitFallbackTimer = null;
      }
      if (abortSignal && abortHandler) {
        abortSignal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }
      try {
        await cleanupTemp();
      } catch {
      }
      reject(error);
    };
    const settleFromProcessExit = async (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearFirstEventTimeout();
      if (exitFallbackTimer) {
        clearTimeout(exitFallbackTimer);
        exitFallbackTimer = null;
      }
      if (abortSignal && abortHandler) {
        abortSignal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }
      try {
        let fileReply = '';
        try {
          fileReply = (await fs.readFile(temp.file, 'utf8')).trim();
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            throw error;
          }
        }
        const reply = fileReply || lastAgentMessage || '';
        const stderrText = stderrBuffer.trim();
        const stderrLines = stderrText.split('\n').map((line) => line.trim()).filter(Boolean).filter((line) => !line.startsWith('Warning: no last agent message;'));
        const errorText = lastErrorMessage || stderrLines.join('\n').trim();
        await cleanupTemp();
        if (shouldTreatNonZeroCodexExitAsRecoveredReply({ exitCode: code, reply, errorText })) {
          resolve({
            threadId,
            reply,
            recoveredExitError: errorText,
            exitCode: code,
          });
          return;
        }
        if (code !== 0) {
          reject(new Error(errorText || `Codex exited with code ${code}`));
          return;
        }
        if (!reply) {
          reject(new Error(errorText || 'Codex returned an empty reply.'));
          return;
        }
        resolve({ threadId, reply, recoveredExitError: '', exitCode: code });
      } catch (error) {
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      void settleError(new Error(`Codex timed out after ${config.codexTimeoutMs}ms`));
    }, config.codexTimeoutMs);
    if (config.codexFirstEventTimeoutMs > 0) {
      firstEventTimeout = setTimeout(() => {
        const action = sessionId ? 'resume' : 'start';
        try {
          child.kill('SIGTERM');
        } catch {
        }
        void settleError(new Error(`Codex ${action} emitted no JSON events within ${config.codexFirstEventTimeoutMs}ms and was aborted as stalled.`));
      }, config.codexFirstEventTimeoutMs);
      if (typeof firstEventTimeout.unref === 'function') {
        firstEventTimeout.unref();
      }
    }

    if (abortSignal) {
      abortHandler = () => {
        try {
          child.kill('SIGTERM');
        } catch {
        }
        const reason = abortSignal.reason;
        const abortError = reason instanceof Error ? reason : new Error(String(reason || 'Codex run aborted.'));
        void settleError(abortError);
      };
      if (abortSignal.aborted) {
        abortHandler();
        return;
      }
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        const event = safeJsonParse(line);
        if (event && !sawJsonEvent) {
          sawJsonEvent = true;
          clearFirstEventTimeout();
        }
        if (event && typeof hooks.onEvent === 'function') {
          try {
            hooks.onEvent(event);
          } catch (error) {
            console.warn(`progress hook failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (event?.type === 'thread.started' && event.thread_id) {
          threadId = event.thread_id;
        }
        if (event?.type === 'item.completed' && event.item?.type === 'agent_message') {
          lastAgentMessage = event.item?.text || lastAgentMessage;
        }
        if (event?.type === 'error' && event.message) {
          lastErrorMessage = event.message;
        }
        if (event?.type === 'turn.failed' && event.error?.message) {
          lastErrorMessage = event.error.message;
        }
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    child.on('error', (error) => {
      void settleError(error);
    });

    child.on('exit', (code) => {
      if (settled || exitFallbackTimer) {
        return;
      }
      exitFallbackTimer = setTimeout(() => {
        exitFallbackTimer = null;
        void settleFromProcessExit(code ?? -1);
      }, 250);
      if (typeof exitFallbackTimer.unref === 'function') {
        exitFallbackTimer.unref();
      }
    });

    child.on('close', (code) => {
      void settleFromProcessExit(code ?? -1);
    });
  });
}

function firstMeaningfulLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('[feishu-attachment]'));
  return lines[0] || '';
}

function formatTodoProgress(items = []) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) {
    return '';
  }
  const completed = rows.filter((item) => item?.completed).length;
  const lines = [`Plan update (${completed}/${rows.length} done)`];
  for (const item of rows.slice(0, 5)) {
    lines.push(`- ${item?.completed ? '[x]' : '[ ]'} ${clipText(item?.text || '', 120)}`);
  }
  if (rows.length > 5) {
    lines.push(`- ... ${rows.length - 5} more`);
  }
  return lines.join('\n');
}

function previewCommand(command) {
  const normalized = String(command || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return clipText(normalized, 220);
}

function previewCommandOutput(output) {
  const normalized = String(output || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (normalized.length === 0) {
    return '';
  }
  return clipText(normalized.join(' | '), 220);
}

function extractProgressUpdate(event) {
  const item = event?.item || null;
  if (!item) {
    return null;
  }
  if (item.type === 'todo_list' && ['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
    const text = formatTodoProgress(item.items || []);
    if (!text) {
      return null;
    }
    return {
      kind: 'todo',
      text,
      todoItems: Array.isArray(item.items) ? item.items.map((entry) => ({
        text: String(entry?.text || ''),
        completed: Boolean(entry?.completed),
      })) : [],
    };
  }
  if (item.type === 'agent_message' && event.type === 'item.completed') {
    const line = firstMeaningfulLine(item.text || '');
    if (!line) {
      return null;
    }
    return {
      kind: 'note',
      text: `Progress: ${clipText(line, 220)}`,
    };
  }
  if (item.type === 'command_execution' && event.type === 'item.started') {
    const commandText = previewCommand(item.command || '');
    if (!commandText) {
      return null;
    }
    return {
      kind: 'command_started',
      text: `Running command: ${commandText}`,
    };
  }
  if (item.type === 'command_execution' && event.type === 'item.completed') {
    const commandText = previewCommand(item.command || '');
    const outputText = previewCommandOutput(item.aggregated_output || '');
    const exitCode = typeof item.exit_code === 'number' ? item.exit_code : '?';
    const lines = [`Command finished (exit ${exitCode}): ${commandText || '(unknown command)'}`];
    if (outputText) {
      lines.push(`Output: ${outputText}`);
    }
    return {
      kind: 'command_completed',
      text: lines.join('\n'),
    };
  }
  return null;
}

function shouldSendProgressUpdate(config, update) {
  if (!config.progressUpdates || !update?.text) {
    return false;
  }
  if (!config.progressCommandUpdates && ['command_started', 'command_completed'].includes(update.kind)) {
    return false;
  }
  return true;
}

function chunkReply(text, limit) {
  const trimmed = text.trim();
  if (!trimmed) {
    return ['(空回复)'];
  }
  if (trimmed.length <= limit) {
    return [trimmed];
  }
  const result = [];
  let remaining = trimmed;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) {
      cut = remaining.lastIndexOf(' ', limit);
    }
    if (cut < limit * 0.5) {
      cut = limit;
    }
    result.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) {
    result.push(remaining);
  }
  return result;
}

function isAbsoluteLocalPath(filePath) {
  return path.isAbsolute(filePath) || /^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\[^\\]+\\[^\\]+/.test(filePath);
}

function extractAttachmentDirectives(text) {
  const matches = [];
  const pattern = /^\[feishu-attachment\]\s+(.+)$/gim;
  let match;
  while ((match = pattern.exec(text || '')) !== null) {
    const raw = match[1].trim().replace(/^['"`]/, '').replace(/['"`]$/, '');
    if (isAbsoluteLocalPath(raw)) {
      matches.push(raw);
    }
  }
  const seen = new Set();
  return matches.filter((item) => {
    if (seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  }).slice(0, 5);
}

function stripAttachmentDirectives(text) {
  return String(text || '').replace(/^\[feishu-attachment\]\s+.+$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
}

function isImagePath(filePath) {
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.tiff'].includes(path.extname(filePath).toLowerCase());
}

function detectFeishuFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (['.doc', '.docx'].includes(ext)) return 'doc';
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return 'xls';
  if (['.ppt', '.pptx', '.key'].includes(ext)) return 'ppt';
  if (ext === '.mp4') return 'mp4';
  if (ext === '.opus') return 'opus';
  return 'stream';
}

async function uploadImageFromPath(client, filePath) {
  const response = await withPromiseTimeout(`upload image ${path.basename(filePath)}`, async () => client.im.image.create({
    data: {
      image_type: 'message',
      image: (await import('node:fs')).createReadStream(filePath),
    },
  }));
  const imageKey = response?.image_key || response?.data?.image_key;
  if (!imageKey) {
    throw new Error(`image upload failed: ${JSON.stringify(response)}`);
  }
  return imageKey;
}

async function uploadFileFromPath(client, filePath, config = {}) {
  const fileName = path.basename(filePath);
  const fileStat = await fs.stat(filePath);
  const maxBytes = getFeishuFileUploadMaxBytes(config);
  if (fileStat.size > maxBytes) {
    throw new Error(`file too large for Feishu upload: ${fileName} (${formatSize(fileStat.size)} > ${formatSize(maxBytes)})`);
  }
  const response = await withPromiseTimeout(`upload file ${fileName}`, async () => client.im.file.create({
    data: {
      file_type: detectFeishuFileType(filePath),
      file_name: sanitizeFileNameForUpload(fileName),
      file: (await import('node:fs')).createReadStream(filePath),
    },
  }));
  const fileKey = response?.file_key || response?.data?.file_key;
  if (!fileKey) {
    throw new Error(`file upload failed: ${JSON.stringify(response)}`);
  }
  return fileKey;
}

function buildSplitPartFileName(fileName, partNumber, totalParts) {
  const width = Math.max(2, String(totalParts).length);
  return `${sanitizeFileName(fileName)}.part${String(partNumber).padStart(width, '0')}`;
}

async function splitFileForUpload(filePath, partSizeBytes) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`attachment is not a regular file: ${filePath}`);
  }

  const safePartSize = Math.max(1, normalizePositiveInteger(partSizeBytes, DEFAULT_FEISHU_FILE_SPLIT_CHUNK_BYTES));
  const totalParts = Math.max(1, Math.ceil(stat.size / safePartSize));
  const tempDir = path.join(os.tmpdir(), `feishu-outbound-split-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const sourceHandle = await fs.open(filePath, 'r');
  const parts = [];
  try {
    let offset = 0;
    for (let partNumber = 1; offset < stat.size; partNumber += 1) {
      const bytesToRead = Math.min(safePartSize, stat.size - offset);
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await sourceHandle.read(buffer, 0, bytesToRead, offset);
      if (bytesRead <= 0) {
        break;
      }
      const partFileName = buildSplitPartFileName(path.basename(filePath), partNumber, totalParts);
      const partPath = path.join(tempDir, partFileName);
      await fs.writeFile(partPath, buffer.subarray(0, bytesRead));
      parts.push({
        filePath: partPath,
        fileName: partFileName,
        size: bytesRead,
        partNumber,
        totalParts,
      });
      offset += bytesRead;
    }
  } finally {
    await sourceHandle.close();
  }

  return {
    originalFileName: path.basename(filePath),
    totalSize: stat.size,
    parts,
    tempDir,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

function buildSplitAttachmentNotice(filePath, splitResult) {
  const originalFileName = path.basename(filePath);
  const partNames = splitResult.parts.map((part) => part.fileName);
  const windowsJoin = `copy /b ${partNames.join('+')} ${originalFileName}`;
  const unixJoin = `cat ${partNames.join(' ')} > ${originalFileName}`;
  return [
    `File ${originalFileName} (${formatSize(splitResult.totalSize)}) exceeds Feishu's single-file limit and was split into ${splitResult.parts.length} parts.`,
    `Parts: ${partNames.join(', ')}`,
    `Windows merge: ${windowsJoin}`,
    `macOS/Linux merge: ${unixJoin}`,
  ].join('\n');
}

async function replyWithMessageContent(client, messageId, msgType, content) {
  const response = await withPromiseTimeout(`reply ${msgType} to message ${messageId}`, async () => client.im.message.reply({
    path: { message_id: messageId },
    data: {
      content: JSON.stringify(content),
      msg_type: msgType,
    },
  }));
  if (response?.code && response.code !== 0) {
    throw new Error(`${msgType} send failed: ${JSON.stringify(response)}`);
  }
  return response?.data?.message_id || messageId;
}

async function sendImageAttachment(client, messageId, filePath) {
  return withRetry(`send outbound image ${path.basename(filePath)}`, async () => {
    const imageKey = await uploadImageFromPath(client, filePath);
    return replyWithMessageContent(client, messageId, 'image', { image_key: imageKey });
  });
}

async function sendFileAttachment(client, messageId, filePath, config = {}) {
  return withRetry(`send outbound file ${path.basename(filePath)}`, async () => {
    const fileKey = await uploadFileFromPath(client, filePath, config);
    return replyWithMessageContent(client, messageId, 'file', { file_key: fileKey });
  });
}

async function sendReplyNotice(client, messageId, text) {
  try {
    const replyIds = await sendReplyText(client, messageId, text);
    return replyIds[replyIds.length - 1] || messageId;
  } catch (error) {
    console.warn(`attachment notice failed for message=${messageId}: ${describeError(error)}`);
    return messageId;
  }
}

async function sendSplitAttachment(client, messageId, filePath, config = {}) {
  const splitResult = await splitFileForUpload(filePath, getFeishuFileSplitChunkBytes(config));
  let currentReplyTarget = messageId;
  try {
    currentReplyTarget = await sendReplyNotice(client, currentReplyTarget, buildSplitAttachmentNotice(filePath, splitResult));
    for (const part of splitResult.parts) {
      currentReplyTarget = await sendFileAttachment(client, currentReplyTarget, part.filePath, config);
    }
    return {
      delivery: 'split',
      partCount: splitResult.parts.length,
      replyTargetMessageId: currentReplyTarget,
    };
  } finally {
    await splitResult.cleanup();
  }
}

async function sendOutboundAttachment(client, messageId, filePath, config = {}) {
  if (!(await pathExists(filePath))) {
    throw new Error(`attachment not found: ${filePath}`);
  }

  const fileStat = await fs.stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`attachment is not a regular file: ${filePath}`);
  }

  const maxBytes = getFeishuFileUploadMaxBytes(config);
  const fileName = path.basename(filePath);

  if (isImagePath(filePath)) {
    if (fileStat.size > maxBytes) {
      return sendSplitAttachment(client, messageId, filePath, config);
    }
    try {
      const replyTargetMessageId = await sendImageAttachment(client, messageId, filePath);
      return { delivery: 'image', replyTargetMessageId };
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      if (!isOutboundAttachmentTooLarge(errorText)) {
        throw error;
      }
      let currentReplyTarget = await sendReplyNotice(
        client,
        messageId,
        `Image ${fileName} (${formatSize(fileStat.size)}) exceeded Feishu image limits and will be sent as a file instead.`,
      );
      if (fileStat.size > maxBytes) {
        return sendSplitAttachment(client, currentReplyTarget, filePath, config);
      }
      currentReplyTarget = await sendFileAttachment(client, currentReplyTarget, filePath, config);
      return { delivery: 'file-fallback', replyTargetMessageId: currentReplyTarget };
    }
  }

  if (fileStat.size > maxBytes) {
    return sendSplitAttachment(client, messageId, filePath, config);
  }

  try {
    const replyTargetMessageId = await sendFileAttachment(client, messageId, filePath, config);
    return { delivery: 'file', replyTargetMessageId };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    if (!isOutboundAttachmentTooLarge(errorText)) {
      throw error;
    }
    return sendSplitAttachment(client, messageId, filePath, config);
  }
}

async function sendOutboundAttachments(client, messageId, filePaths, config = {}) {
  const results = [];
  let currentReplyTarget = messageId;
  for (const filePath of filePaths) {
    try {
      const delivery = await sendOutboundAttachment(client, currentReplyTarget, filePath, config);
      currentReplyTarget = delivery?.replyTargetMessageId || currentReplyTarget;
      results.push({ filePath, ok: true, ...delivery });
    } catch (error) {
      results.push({ filePath, ok: false, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
  }
  return results;
}

function isOutboundAttachmentTooLarge(errorText) {
  const normalized = oneLine(errorText).toLowerCase();
  return normalized.includes('234006')
    || normalized.includes('file size exceed the max value')
    || normalized.includes('file too large for feishu upload');
}

async function formatOutboundAttachmentFailure(item) {
  const fileName = path.basename(item.filePath || 'attachment');
  let sizeNote = '';
  try {
    const stat = await fs.stat(item.filePath);
    sizeNote = ` (${formatSize(stat.size)})`;
  } catch {
    sizeNote = '';
  }
  if (oneLine(item.error).toLowerCase().includes('attachment not found:')) {
    return `${fileName}${sizeNote}: local file not found`;
  }
  if (isOutboundAttachmentTooLarge(item.error)) {
    return `${fileName}${sizeNote}: exceeds Feishu's 30 MB file upload limit`;
  }
  return `${fileName}${sizeNote}: ${clipText(oneLine(item.error), 220)}`;
}

async function createSmokeTestArtifacts(tempDir, config, options = {}) {
  const textPath = path.join(tempDir, 'codex-feishu-smoke.txt');
  const imagePath = path.join(tempDir, 'codex-feishu-smoke.png');
  const largePath = path.join(tempDir, 'codex-feishu-smoke-large.bin');
  const largeBytes = Math.max(
    getFeishuFileUploadMaxBytes(config) + 1024,
    normalizePositiveInteger(options.largeBytes, getFeishuFileUploadMaxBytes(config) + (1024 * 1024)),
  );

  await fs.writeFile(
    textPath,
    [
      'Codex Feishu attachment smoke test',
      `time: ${nowIso()}`,
      `host: ${os.hostname()}`,
      `workspace: ${config.workspace}`,
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(
    imagePath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0xQAAAAASUVORK5CYII=', 'base64'),
  );

  const chunk = Buffer.alloc(1024 * 1024, 0x41);
  const targetHandle = await fs.open(largePath, 'w');
  try {
    let remaining = largeBytes;
    while (remaining > 0) {
      const nextChunk = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
      await targetHandle.write(nextChunk);
      remaining -= nextChunk.length;
    }
  } finally {
    await targetHandle.close();
  }

  return { textPath, imagePath, largePath, largeBytes };
}

async function sendText(client, chatId, text, limit = DEFAULT_REPLY_CHUNK_LIMIT) {
  const chunks = chunkReply(text, limit);
  const messageIds = [];
  for (const chunk of chunks) {
    const response = await withRetry(`send text to chat ${chatId}`, async () => withPromiseTimeout(
      `send text to chat ${chatId}`,
      async () => client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: chunk }),
        },
      }),
    ));
    if (response.code !== 0) {
      throw new Error(`send failed: ${JSON.stringify(response)}`);
    }
    messageIds.push(response?.data?.message_id || '');
  }
  return messageIds.filter(Boolean);
}

async function sendReplyText(client, messageId, text, limit = DEFAULT_REPLY_CHUNK_LIMIT) {
  const chunks = chunkReply(text, limit);
  const messageIds = [];
  let currentReplyTarget = messageId;
  for (const chunk of chunks) {
    const response = await withRetry(`reply to message ${currentReplyTarget}`, async () => withPromiseTimeout(
      `reply to message ${currentReplyTarget}`,
      async () => client.im.message.reply({
        path: { message_id: currentReplyTarget },
        data: {
          content: JSON.stringify({ text: chunk }),
          msg_type: 'text',
        },
      }),
    ));
    if (response?.code && response.code !== 0) {
      throw new Error(`reply failed: ${JSON.stringify(response)}`);
    }
    const createdMessageId = response?.data?.message_id || '';
    if (createdMessageId) {
      messageIds.push(createdMessageId);
      currentReplyTarget = createdMessageId;
    }
  }
  return messageIds;
}

async function sendReplyTextWithFallback(client, messageId, chatId, text, limit = DEFAULT_REPLY_CHUNK_LIMIT) {
  try {
    return await sendReplyText(client, messageId, text, limit);
  } catch (error) {
    console.warn(`reply fallback triggered for chat=${chatId} message=${messageId}: ${describeError(error)}`);
    return sendText(client, chatId, text, limit);
  }
}

async function sendInteractiveCard(client, chatId, card) {
  const response = await withRetry(`send interactive card to chat ${chatId}`, async () => withPromiseTimeout(
    `send interactive card to chat ${chatId}`,
    async () => client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    }),
  ));
  if (response?.code && response.code !== 0) {
    throw new Error(`interactive send failed: ${JSON.stringify(response)}`);
  }
  return response?.data?.message_id ? [response.data.message_id] : [];
}

async function sendReplyInteractiveCard(client, messageId, card) {
  const response = await withRetry(`reply interactive card to message ${messageId}`, async () => withPromiseTimeout(
    `reply interactive card to message ${messageId}`,
    async () => client.im.message.reply({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(card),
        msg_type: 'interactive',
      },
    }),
  ));
  if (response?.code && response.code !== 0) {
    throw new Error(`interactive reply failed: ${JSON.stringify(response)}`);
  }
  return response?.data?.message_id ? [response.data.message_id] : [];
}

async function sendReplyInteractiveCardWithFallback(client, messageId, chatId, card) {
  try {
    return await sendReplyInteractiveCard(client, messageId, card);
  } catch (error) {
    console.warn(`interactive reply fallback triggered for chat=${chatId} message=${messageId}: ${describeError(error)}`);
    return sendInteractiveCard(client, chatId, card);
  }
}

async function patchInteractiveCardMessage(client, messageId, card) {
  const response = await withRetry(`patch interactive card message ${messageId}`, async () => withPromiseTimeout(
    `patch interactive card message ${messageId}`,
    async () => client.im.v1.message.patch({
      path: { message_id: messageId },
      data: {
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    }),
  ));
  if (response?.code && response.code !== 0) {
    throw new Error(`interactive patch failed: ${JSON.stringify(response)}`);
  }
  return response?.data?.message_id || messageId;
}

function isLowSignalStartupText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return true;
  }
  if (/^[\d\s.]+$/.test(normalized)) {
    return true;
  }
  return /^(?:[?？!！.。]+|在不在|早+|晚+|早上好|晚上好|晚安|ok|oki?|oi|收到|好的|好|嗯+|可以|1|2|3)$/i.test(normalized);
}

function scoreStartupContextEntry(entry) {
  const intent = String(entry?.intent || 'general').toLowerCase();
  let score = 0;
  if (intent === 'decision') {
    score += 70;
  } else if (intent === 'task') {
    score += 65;
  } else if (intent === 'summary') {
    score += 55;
  } else if (intent === 'sensitive_task') {
    score += 45;
  } else if (intent === 'question') {
    score += 20;
  } else {
    score += 10;
  }
  return score + Math.min(String(entry?.text || '').trim().length, 90);
}

function pickBestStartupContextEntry(entries = []) {
  const candidates = (Array.isArray(entries) ? entries : []).filter((entry) => !isLowSignalStartupText(entry?.text));
  if (candidates.length === 0) {
    return null;
  }
  return candidates
    .slice()
    .sort((left, right) => {
      const scoreDiff = scoreStartupContextEntry(right) - scoreStartupContextEntry(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return Number(right?.timestamp || 0) - Number(left?.timestamp || 0);
    })[0];
}

function localDayStartMs(referenceDate = new Date()) {
  const current = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  return new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
}

function sessionKeyBelongsToChat(sessionKey, chatId) {
  const normalizedKey = String(sessionKey || '');
  const normalizedChatId = String(chatId || '');
  if (!normalizedKey || !normalizedChatId) {
    return false;
  }
  return normalizedKey === normalizedChatId || normalizedKey.startsWith(`${normalizedChatId}:sender:`);
}

function findYesterdayGroupEntry(groupContext, referenceDate = new Date()) {
  const recentMessages = Array.isArray(groupContext?.recentMessages) ? groupContext.recentMessages : [];
  if (recentMessages.length === 0) {
    return null;
  }
  const todayStartMs = localDayStartMs(referenceDate);
  const yesterdayStartMs = todayStartMs - ONE_DAY_MS;
  return pickBestStartupContextEntry(
    recentMessages.filter((entry) => {
      const timestampMs = Number(entry?.timestamp || 0);
      return Number.isFinite(timestampMs) && timestampMs >= yesterdayStartMs && timestampMs < todayStartMs;
    }),
  );
}

function findLatestMeaningfulGroupEntry(groupContext) {
  return pickBestStartupContextEntry(groupContext?.recentMessages || []);
}

function findStartupInterruptedRun({ chatId, startupContext = {} }) {
  const clearedRuns = Array.isArray(startupContext?.clearedActiveRuns) ? startupContext.clearedActiveRuns : [];
  return clearedRuns
    .filter((entry) => sessionKeyBelongsToChat(entry?.key, chatId))
    .sort((left, right) => {
      const rightActivity = Math.max(parseIsoTimeMs(right?.lastUpdateAt), parseIsoTimeMs(right?.startedAt));
      const leftActivity = Math.max(parseIsoTimeMs(left?.lastUpdateAt), parseIsoTimeMs(left?.startedAt));
      return rightActivity - leftActivity;
    })[0] || null;
}

function summarizeStartupContext({ chatId, state, startupContext = {}, referenceDate = new Date() }) {
  const groupContext = state?.groupContexts?.[chatId] || null;
  const interruptedRun = findStartupInterruptedRun({ chatId, startupContext });

  if (interruptedRun) {
    const interruptedEntry = (groupContext?.recentMessages || []).find((entry) => entry?.messageId === interruptedRun.sourceMessageId) || null;
    const fallbackEntry = findYesterdayGroupEntry(groupContext, referenceDate) || findLatestMeaningfulGroupEntry(groupContext);
    const summaryText = clipText(interruptedEntry?.text || fallbackEntry?.text || '', 120);
    return {
      kind: 'interrupted',
      text: summaryText,
    };
  }

  const yesterdayEntry = findYesterdayGroupEntry(groupContext, referenceDate);
  if (!yesterdayEntry) {
    return null;
  }
  return {
    kind: 'yesterday',
    text: clipText(yesterdayEntry.text || '', 120),
  };
}

function selectStartupNotificationSession({ chatId, config, state, startupContext = {} }) {
  const interruptedRun = findStartupInterruptedRun({ chatId, startupContext });
  if (interruptedRun?.key) {
    const existingSession = state?.chatSessions?.[interruptedRun.key] || null;
    return {
      key: interruptedRun.key,
      senderOpenId: existingSession?.senderOpenId || senderOpenIdFromSessionKey(interruptedRun.key) || STARTUP_NOTIFY_SYNTHETIC_SENDER_OPEN_ID,
      resumeThreadId: interruptedRun.threadId || existingSession?.threadId || '',
      interruptedRun,
    };
  }

  const syntheticSenderOpenId = STARTUP_NOTIFY_SYNTHETIC_SENDER_OPEN_ID;
  const key = config.groupSessionScope === 'group_sender'
    ? `${chatId}:sender:${syntheticSenderOpenId}`
    : chatId;
  const existingSession = state?.chatSessions?.[key] || null;
  return {
    key,
    senderOpenId: syntheticSenderOpenId,
    resumeThreadId: existingSession?.threadId || '',
    interruptedRun: null,
  };
}

function buildStartupNotificationOpening(config) {
  return String(config.startupNotifyMessage || DEFAULT_STARTUP_NOTIFY_MESSAGE).trim() || DEFAULT_STARTUP_NOTIFY_MESSAGE;
}

function buildStartupNotificationPrompt({ config, state, chatId, startupContext = {} }) {
  const lines = [
    '这是一次开机后的真实连通性自检，请直接产出一条要发到当前飞书群里的中文短消息。',
    '这条消息的目的有两个：',
    '1. 让群里看到你现在已经真正上线，Codex 到飞书的回复链路已经跑通。',
    '2. 自然承接昨天的上下文，帮助大家从昨天停下的地方继续。',
    '',
    '写作要求：',
    `1. 开头自然表达“${buildStartupNotificationOpening(config)}”这个意思，但不要机械复读原句。`,
    '2. 如果你能从当前会话上下文或下面的摘要判断出昨天这个群最后推进到哪里，就用 1 句准确总结；不知道就不要编造。',
    '3. 如果昨天有中断任务，就自然带一句：直接在这个群里继续发，你会接着昨天的上下文往下处理。',
    '4. 只输出最终要发到群里的话，不要解释规则，不要提系统提示、启动通知、自检、public memory、session、thread 之类内部术语。',
    '5. 保持简短，最多 3 句。',
    '6. 不要开始执行昨天的任务，不要编辑文件，不要运行命令，这次只发一条上线承接消息。',
  ];
  const contextSummary = summarizeStartupContext({ chatId, state, startupContext });
  if (contextSummary?.kind === 'interrupted' && contextSummary.text) {
    lines.push('', `已知上次中断前的摘要：${contextSummary.text}`);
  } else if (contextSummary?.kind === 'interrupted') {
    lines.push('', '已知：上次退出前这个群里还有未完成任务。');
  } else if (contextSummary?.kind === 'yesterday' && contextSummary.text) {
    lines.push('', `已知昨天这个群最后推进到：${contextSummary.text}`);
  } else {
    lines.push('', '如果没有足够上下文，就只需简短说明你现在已上线，可以继续。');
  }
  return lines.filter(Boolean).join('\n');
}

function buildStartupNotificationText(config, botInfo) {
  if (config.startupNotifyMessage) {
    return config.startupNotifyMessage;
  }
  return [
    DEFAULT_STARTUP_NOTIFY_MESSAGE,
    `bot: ${botInfo.botName || config.botName || 'Codex Bot'}`,
    `host: ${os.hostname()}`,
    `time: ${nowIso()}`,
    `workspace: ${config.workspace}`,
  ].join('\n');
}

function buildStartupNotificationBody({ config, botInfo, state, chatId, startupContext = {} }) {
  const lines = [buildStartupNotificationText(config, botInfo)];
  const contextSummary = summarizeStartupContext({ chatId, state, startupContext });
  if (contextSummary?.kind === 'interrupted' && contextSummary.text) {
    lines.push(`上次中断前这个群最后在做：${contextSummary.text}`);
    lines.push('如果要接着昨天断掉前的任务，直接在这个群里继续发，我会沿用昨天的会话接着处理。');
  } else if (contextSummary?.kind === 'interrupted') {
    lines.push('上次中断前这个群里有未完成任务。');
    lines.push('如果要接着昨天断掉前的任务，直接在这个群里继续发，我会沿用昨天的会话接着处理。');
  } else if (contextSummary?.kind === 'yesterday' && contextSummary.text) {
    lines.push(`昨天这个群最后在推进：${contextSummary.text}`);
    lines.push('如果今天要接着昨天的任务，直接在这个群里继续发，我会沿用昨天的会话接着处理。');
  }
  return lines.filter(Boolean).join('\n');
}

async function maybeSendStartupNotification({ config, state, stateFile, client, botInfo, queues, startupContext = {} }) {
  const chatIds = config.startupNotifyChatIds || [];
  if (chatIds.length === 0) {
    return false;
  }

  state.startupNotifications ||= {};
  const bootId = currentBootId();
  let delivered = false;

  for (const chatId of chatIds) {
    const existing = state.startupNotifications[chatId];
    if (config.startupNotifyDeduplicatePerBoot && existing?.bootId === bootId) {
      console.log(`startup notification skipped for chat=${chatId}: already sent for boot=${bootId}`);
      continue;
    }
    const startupSession = selectStartupNotificationSession({ chatId, config, state, startupContext });
    const prompt = buildStartupNotificationPrompt({ config, state, chatId, startupContext });
    const syntheticEvent = buildSyntheticStartupEvent(chatId, startupSession.senderOpenId);
    const result = await enqueueTurn({
      key: startupSession.key,
      event: syntheticEvent,
      sourceMessageId: syntheticEvent.message.message_id,
      replyTargetMessageId: syntheticEvent.message.message_id,
      runText: prompt,
      attachments: [],
      classification: {
        visibility: 'public',
        intent: 'summary',
        hasAttachment: false,
        containsSensitive: false,
        summaryRequest: true,
        questionLike: false,
        taskLike: false,
        decisionLike: false,
        shouldSuggestPrivate: false,
        responseMode: 'group_assistant',
      },
      groupContext: state.groupContexts?.[chatId] || null,
      planningMode: false,
      config,
      state,
      stateFile,
      client,
      queues,
      allowProcessingReaction: false,
      resumeThreadIdOverride: startupSession.resumeThreadId || '',
    });
    state.startupNotifications[chatId] = {
      bootId,
      sentAt: nowIso(),
      chatId,
      messageIds: result?.replyMessageIds || [],
      hostname: os.hostname(),
      sessionKey: startupSession.key,
      threadId: result?.threadId || startupSession.resumeThreadId || '',
      mode: 'codex_turn',
    };
    await writeJson(stateFile, state);
    console.log(`startup notification delivered via codex chat=${chatId} messages=${(result?.replyMessageIds || []).length}`);
    delivered = true;
  }

  return delivered;
}

function startupMorningBriefChatIds(config) {
  const explicitChatIds = config.startupMorningBriefChatIds || [];
  if (explicitChatIds.length > 0) {
    return explicitChatIds;
  }
  return config.startupNotifyChatIds || [];
}

function buildStartupMorningBriefItemKey(item = {}) {
  const arxivId = String(item.arxivId || '').trim();
  if (arxivId) {
    return `arxiv:${arxivId}`;
  }
  const itemKey = String(item.itemKey || '').trim();
  if (itemKey) {
    return itemKey;
  }
  const link = String(item.link || '').trim();
  if (link) {
    return `link:${link}`;
  }
  const title = String(item.title || '').trim().toLowerCase();
  if (title) {
    return `title:${title}`;
  }
  return '';
}

function listStartupMorningBriefExcludedItemKeys(state, chatId) {
  const record = state.startupMorningBriefs?.[chatId];
  const sentItems = record?.sentItems;
  if (!sentItems || typeof sentItems !== 'object') {
    return [];
  }
  return Object.keys(sentItems).filter(Boolean);
}

async function maybeSendStartupMorningBrief({ config, state, stateFile, client }) {
  if (!config.startupMorningBriefEnabled) {
    return false;
  }

  const chatIds = startupMorningBriefChatIds(config);
  if (chatIds.length === 0) {
    return false;
  }

  state.startupMorningBriefs ||= {};
  const dateKey = dateKeyInTimeZone(new Date(), config.startupMorningBriefTimeZone || DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE);
  const pendingChatIds = chatIds.filter((chatId) => {
    const existing = state.startupMorningBriefs?.[chatId];
    return !(config.startupMorningBriefDeduplicateDaily && existing?.dateKey === dateKey);
  });

  if (pendingChatIds.length === 0) {
    console.log(`startup morning brief skipped: already sent for ${dateKey}`);
    return false;
  }

  let delivered = false;
  for (const chatId of pendingChatIds) {
    const existing = state.startupMorningBriefs?.[chatId] || {};
    const excludeItemKeys = listStartupMorningBriefExcludedItemKeys(state, chatId);
    const brief = await buildTimeSeriesMorningBrief({
      maxItems: config.startupMorningBriefMaxItems,
      maxAgeDays: config.startupMorningBriefMaxAgeDays,
      timeZone: config.startupMorningBriefTimeZone || DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE,
      excludeItemKeys,
    });
    const messageIds = await sendText(client, chatId, brief.text, config.replyChunkLimit);
    const sentAt = nowIso();
    const sentItems = {
      ...(existing.sentItems && typeof existing.sentItems === 'object' ? existing.sentItems : {}),
    };
    for (const item of brief.items || []) {
      const key = buildStartupMorningBriefItemKey(item);
      if (!key) {
        continue;
      }
      sentItems[key] = sentAt;
    }
    state.startupMorningBriefs[chatId] = {
      dateKey,
      sentAt,
      generatedAt: brief.generatedAt,
      chatId,
      messageIds,
      itemCount: brief.items.length,
      sourceCategories: (brief.feeds || []).map((feed) => feed.category).filter(Boolean),
      errorCount: (brief.errors || []).length,
      sentItems,
    };
    await writeJson(stateFile, state);
    console.log(`startup morning brief delivered chat=${chatId} items=${brief.items.length} errors=${(brief.errors || []).length}`);
    delivered = true;
  }

  return delivered;
}

function shouldUseTypingIndicator(config) {
  return config.typingIndicator !== false;
}

async function addProcessingReaction(client, messageId, emojiType = DEFAULT_TYPING_EMOJI) {
  if (!messageId || !emojiType) {
    return null;
  }
  try {
    const response = await withRetry(`create reaction for ${messageId}`, async () => withPromiseTimeout(
      `create reaction for ${messageId}`,
      async () => client.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      }),
    ));
    if (response?.code && response.code !== 0) {
      console.warn(`feishu reaction create failed: ${JSON.stringify(response)}`);
      return null;
    }
    return { messageId, reactionId: response?.data?.reaction_id || null };
  } catch (error) {
    console.warn(`feishu reaction create error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function removeProcessingReaction(client, reactionState) {
  if (!reactionState?.messageId || !reactionState?.reactionId) {
    return;
  }
  try {
    const response = await withRetry(`delete reaction for ${reactionState.messageId}`, async () => withPromiseTimeout(
      `delete reaction for ${reactionState.messageId}`,
      async () => client.im.messageReaction.delete({
        path: {
          message_id: reactionState.messageId,
          reaction_id: reactionState.reactionId,
        },
      }),
    ));
    if (response?.code && response.code !== 0) {
      console.warn(`feishu reaction delete failed: ${JSON.stringify(response)}`);
    }
  } catch (error) {
    console.warn(`feishu reaction delete error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureState(stateFile) {
  const state = await readJson(stateFile, { version: 1, processedMessageIds: {}, chatSessions: {}, groupContexts: {}, activeRuns: {}, planSessions: {}, botInfo: {}, startupNotifications: {}, startupMorningBriefs: {} });
  state.processedMessageIds ||= {};
  state.chatSessions ||= {};
  state.groupContexts ||= {};
  state.activeRuns ||= {};
  state.planSessions ||= {};
  state.botInfo ||= {};
  state.startupNotifications ||= {};
  state.startupMorningBriefs ||= {};
  return state;
}

async function clearTransientStateOnStartup(state, stateFile) {
  const activeRuns = state?.activeRuns && typeof state.activeRuns === 'object' ? state.activeRuns : {};
  const activeKeys = Object.keys(activeRuns);
  if (activeKeys.length === 0) {
    return [];
  }
  const clearedRuns = activeKeys.map((key) => ({ key, ...(activeRuns[key] || {}) }));
  state.activeRuns = {};
  await writeJson(stateFile, state);
  console.warn(`cleared ${activeKeys.length} stale active run(s) from a previous gateway process`);
  return clearedRuns;
}

async function repairStaleActiveRuns(state, stateFile, source = 'runtime_watchdog') {
  const activeRuns = state?.activeRuns && typeof state.activeRuns === 'object' ? state.activeRuns : {};
  const staleEntries = [];
  const now = Date.now();

  for (const [key, activeRun] of Object.entries(activeRuns)) {
    if (!activeRun || activeRun.status !== 'running') {
      continue;
    }

    // Let the owning in-process controller decide whether a live run is stale.
    if (hasLiveActiveRunController(key, activeRun.sourceMessageId || '')) {
      continue;
    }

    const startedAtMs = parseIsoTimeMs(activeRun.startedAt);
    const lastUpdateAtMs = parseIsoTimeMs(activeRun.lastUpdateAt);
    const activityAtMs = Math.max(startedAtMs, lastUpdateAtMs);
    const codexPid = Number(activeRun.codexPid || 0);

    if (codexPid > 0) {
      if (!isPidAlive(codexPid) && activityAtMs > 0 && (now - activityAtMs) >= ACTIVE_RUN_STALE_PROCESS_GRACE_MS) {
        staleEntries.push({ key, reason: `codex_pid_missing:${codexPid}` });
      }
      continue;
    }

    if (startedAtMs > 0 && (now - startedAtMs) >= ACTIVE_RUN_SPAWN_GRACE_MS) {
      staleEntries.push({ key, reason: 'codex_pid_not_recorded' });
    }
  }

  if (staleEntries.length === 0) {
    return 0;
  }

  for (const staleEntry of staleEntries) {
    delete state.activeRuns[staleEntry.key];
    const planSession = getPlanSession(state, staleEntry.key);
    if (planSession?.status === 'approval_started') {
      planSession.status = 'awaiting_approval';
      planSession.updatedAt = nowIso();
    }
  }

  await writeJson(stateFile, state);

  for (const staleEntry of staleEntries) {
    console.warn(`cleared stale active run session=${staleEntry.key} source=${source} reason=${staleEntry.reason}`);
  }

  return staleEntries.length;
}

async function syncCardCallbackRuntimeOnStartup(config, state, stateFile) {
  if (config.cardCallbackEnabled) {
    return;
  }
  await updateCardCallbackRuntimeState(state, stateFile, {
    status: config.cardLongConnectionEnabled ? 'long_connection_only' : 'disabled',
    localCallbackUrl: '',
    publicBaseUrl: '',
    publicCallbackUrl: '',
    tunnelPid: null,
    tunnelCommand: '',
    autoChallenge: false,
  });
}

function trimProcessed(state) {
  const entries = Object.entries(state.processedMessageIds || {}).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  if (entries.length <= 5000) {
    return;
  }
  state.processedMessageIds = Object.fromEntries(entries.slice(entries.length - 3000));
}

async function handleCommand({ event, command, state, config, client, botInfo }) {
  const chatId = event.message.chat_id;
  const key = sessionKeyOf(event, config);
  const text = command?.raw || '';
  const planSession = getPlanSession(state, key);
  if (command?.name === 'status') {
    const mapping = state.chatSessions[key];
    const groupContext = state.groupContexts?.[chatId];
    const activeRun = state.activeRuns?.[key];
    await sendText(client, chatId, [
      `bot: ${botInfo.botName || config.botName || 'Codex Feishu Bot'}`,
      `bot_open_id: ${botInfo.botOpenId || '-'}`,
      `workspace: ${config.workspace}`,
      `chat_session_key: ${key}`,
      `codex_thread_id: ${mapping?.threadId || '(none)'}`,
      `active_run: ${activeRun?.status || 'idle'}`,
      `plan_session: ${planSession?.status || 'none'}`,
      `plan_questions: ${(planSession?.questions || []).length}`,
      `group_assistant_mode: ${config.groupAssistantMode || DEFAULT_GROUP_ASSISTANT_MODE}`,
      `group_public_participants: ${Object.keys(groupContext?.participants || {}).length}`,
      `group_public_recent_messages: ${(groupContext?.recentMessages || []).length}`,
    ].join('\n'), config.replyChunkLimit);
    return true;
  }
  if (command?.name === 'progress') {
    const activeRun = state.activeRuns?.[key];
    if (!activeRun && !planSession) {
      await sendText(client, chatId, 'No active task in this chat.', config.replyChunkLimit);
      return true;
    }
    const lines = [
      `status: ${activeRun?.status || planSession?.status || 'idle'}`,
      `mode: ${activeRun?.mode || (planSession ? 'plan' : 'execute')}`,
      `started_at: ${activeRun?.startedAt || planSession?.createdAt || '-'}`,
      `last_update_at: ${activeRun?.lastUpdateAt || planSession?.updatedAt || '-'}`,
      `progress: ${activeRun?.lastProgressText || (planSession ? 'Waiting for user input or approval.' : '(waiting for progress)')}`,
    ];
    if (planSession) {
      lines.push(`plan_status: ${planSession.status}`);
      if (planSession.status === 'awaiting_answers' && (planSession.questions || []).length > 0) {
        lines.push('open_questions:');
        for (const question of planSession.questions.slice(0, config.planQuestionLimit)) {
          lines.push(`- ${question}`);
        }
      }
    }
    const todoItems = Array.isArray(activeRun.todoItems) ? activeRun.todoItems : [];
    if (todoItems.length > 0) {
      lines.push('todo:');
      for (const item of todoItems.slice(0, 5)) {
        lines.push(`- ${item.completed ? '[x]' : '[ ]'} ${clipText(item.text || '', 120)}`);
      }
    }
    await sendText(client, chatId, lines.join('\n'), config.replyChunkLimit);
    return true;
  }
  if (command?.name === 'new' || command?.name === 'reset') {
    delete state.chatSessions[key];
    delete state.activeRuns[key];
    clearPlanSession(state, key);
    await sendText(client, chatId, 'Reset the Codex session bound to this Feishu chat.', config.replyChunkLimit);
    return true;
  }
  if (command?.name === 'help') {
    await sendText(client, chatId, [
      '/status show current binding and workspace',
      '/progress show the active task snapshot',
      '/plan <task> start a planning workflow first',
      '/approve start execution from the latest approved plan',
      '/cancel clear the pending plan without resetting the whole chat session',
      '/stop interrupt the current running task in this chat',
      '/run <task> bypass planning and execute directly',
      '/new or /reset clear the current Codex session',
      'Send a task in direct chat to plan first, then approve to execute',
    ].join('\n'), config.replyChunkLimit);
    return true;
  }
  if (text === '/new' || text === '/reset') {
    delete state.chatSessions[key];
    clearPlanSession(state, key);
    await sendText(client, chatId, '已重置这个飞书会话对应的 Codex session。');
    return true;
  }
  if (text === '/help') {
    await sendText(client, chatId, ['/status 查看当前绑定', '/approve 批准执行当前计划', '/cancel 清空当前待确认计划', '/new 或 /reset 重置会话', '直接发送任务会先进入规划，再批准执行'].join('\n'));
    return true;
  }
  return false;
}

async function maybeSendPlanCard({ client, chatId, replyTargetMessageId, key, state, stateFile, config }) {
  const planSession = getPlanSession(state, key);
  if (!config.planCardsEnabled || !planSession) {
    return [];
  }
  const card = buildPlanCard({ key, planSession, config });
  try {
    const messageIds = await sendReplyInteractiveCardWithFallback(client, replyTargetMessageId, chatId, card);
    if (messageIds.length > 0) {
      const latestPlanSession = getPlanSession(state, key);
      if (latestPlanSession) {
        latestPlanSession.cardMessageId = messageIds[messageIds.length - 1];
        latestPlanSession.cardUpdatedAt = nowIso();
        await writeJson(stateFile, state);
      }
    }
    return messageIds;
  } catch (error) {
    console.warn(`plan card delivery failed for session=${key}: ${describeError(error)}`);
    return [];
  }
}

async function patchStoredPlanCard({
  client,
  key,
  state,
  stateFile,
  config,
  statusText = '',
  detailText = '',
  fallbackMessageId = '',
}) {
  const planSession = getPlanSession(state, key);
  if (!config.planCardsEnabled || !planSession) {
    return false;
  }
  const messageId = String(planSession.cardMessageId || fallbackMessageId || '').trim();
  if (!messageId) {
    return false;
  }
  try {
    await patchInteractiveCardMessage(client, messageId, buildPlanCard({
      key,
      planSession,
      config,
      statusText,
      detailText,
    }));
    planSession.cardMessageId = messageId;
    planSession.cardUpdatedAt = nowIso();
    await writeJson(stateFile, state);
    return true;
  } catch (error) {
    console.error(`stored plan card patch failed for session=${key} message_id=${messageId}: ${describeError(error)}`);
    return false;
  }
}

function buildOriginalRequest({ planSession, commandName, autoPlanDecision, effectiveText, text }) {
  if (planSession?.originalRequest) {
    return planSession.originalRequest;
  }
  if (commandName === 'plan' || autoPlanDecision) {
    return effectiveText || text;
  }
  return effectiveText || text;
}

async function enqueueTurn({
  key,
  event,
  sourceMessageId,
  replyTargetMessageId,
  runText,
  attachments = [],
  classification,
  groupContext,
  planningMode = false,
  clearPlanOnSuccess = false,
  originalRequest = '',
  planFailureStatus = '',
  config,
  state,
  stateFile,
  client,
  queues,
  allowProcessingReaction = true,
  resumeThreadIdOverride = '',
}) {
  const queue = queues.get(key) || Promise.resolve();
  const next = queue.then(async () => {
    const currentPlanSession = getPlanSession(state, key);
    const existing = state.chatSessions[key];
    const resumeThreadId = resumeThreadIdOverride || currentPlanSession?.threadId || existing?.threadId || '';
    const chatId = event.message?.chat_id || currentPlanSession?.chatId || '';
    const chatType = event.message?.chat_type || currentPlanSession?.chatType || '';
    const senderOpenId = senderOpenIdOf(event);
    const messageId = sourceMessageId || event.message?.message_id || `synthetic-${randomUUID()}`;
    const prompt = buildPrompt(event, runText, attachments, { classification, groupContext, planOnly: planningMode });
    console.log(`message ${messageId} starting codex turn: sessionKey=${key} existingThread=${resumeThreadId || '(new)'} mode=${planningMode ? 'plan' : 'execute'}`);
    let reactionState = null;
    let observedThreadId = resumeThreadId;
    let activeThreadId = resumeThreadId;
    let usageLedgerLogged = false;
    let startedUsageSummary = resumeThreadId
      ? await summarizeCodexSessionUsage(config.codexSessionsRoot, resumeThreadId).catch(() => null)
      : null;
    let resultRecoveredExitError = '';
    const staleRunAbortController = new AbortController();
    const progressState = {
      announced: false,
      finished: false,
      lastSentAt: 0,
      lastProgressText: '',
      progressMessagesSent: 0,
      startedAt: nowIso(),
      replyTargetMessageId: replyTargetMessageId || messageId,
      codexPid: null,
    };
    registerActiveRunController(key, {
      abortController: staleRunAbortController,
      sourceMessageId: messageId,
      chatId,
      startedAt: progressState.startedAt,
      stopRequested: false,
    });
    let replyMessageIds = [];
    let progressUpdateChain = Promise.resolve();
    let staleRunTimer = null;
    const appendUsageLedger = async ({ status, finalThreadId = '', errorMessage = '' } = {}) => {
      if (!config.usageLedgerEnabled || usageLedgerLogged) {
        return;
      }
      usageLedgerLogged = true;
      try {
        const threadId = finalThreadId || observedThreadId || resumeThreadId || '';
        const finishedAt = nowIso();
        const finalUsageSummary = threadId
          ? await summarizeCodexSessionUsage(config.codexSessionsRoot, threadId).catch(() => null)
          : null;
        await appendJsonl(config.usageLedgerFile, {
          recordedAt: finishedAt,
          status: String(status || 'completed'),
          mode: planningMode ? 'plan' : 'execute',
          chatId,
          chatType,
          sessionKey: key,
          senderOpenId,
          sourceMessageId: messageId,
          replyTargetMessageId: progressState.replyTargetMessageId,
          threadId,
          startedAt: progressState.startedAt,
          finishedAt,
          matchedUsage: Boolean(finalUsageSummary),
          usage: usageSummaryWithDefaults(finalUsageSummary),
          deltaUsage: diffUsageSummary(startedUsageSummary, finalUsageSummary),
          sessionFile: finalUsageSummary?.sessionFile || '',
          lastTokenTimestamp: finalUsageSummary?.lastTokenTimestamp || '',
          errorMessage: errorMessage ? String(errorMessage) : '',
        });
      } catch (ledgerError) {
        usageLedgerLogged = false;
        console.warn(`usage ledger append failed for session=${key}: ${describeError(ledgerError)}`);
      }
    };
    const persistActiveRun = async (extra = {}) => {
      state.activeRuns[key] = {
        status: 'running',
        mode: planningMode ? 'plan' : 'execute',
        startedAt: progressState.startedAt,
        lastUpdateAt: nowIso(),
        lastProgressText: progressState.lastProgressText || 'Accepted and waiting for progress events.',
        sourceMessageId: messageId,
        threadId: observedThreadId || activeThreadId || '',
        gatewayPid: process.pid,
        codexPid: progressState.codexPid,
        ...extra,
      };
      await writeJson(stateFile, state);
    };
    const clearStaleRunTimer = () => {
      if (staleRunTimer) {
        clearTimeout(staleRunTimer);
        staleRunTimer = null;
      }
    };
    const scheduleStaleRunCheck = () => {
      clearStaleRunTimer();
      const delayMs = progressState.codexPid ? ACTIVE_RUN_STALE_PROCESS_GRACE_MS : ACTIVE_RUN_SPAWN_GRACE_MS;
      staleRunTimer = setTimeout(() => {
        const activeRun = state.activeRuns[key];
        if (!activeRun || progressState.finished || activeRun.sourceMessageId !== messageId) {
          return;
        }

        const codexPid = Number(activeRun.codexPid || progressState.codexPid || 0);
        if (codexPid > 0) {
          if (isPidAlive(codexPid)) {
            scheduleStaleRunCheck();
            return;
          }
          const lastUpdateAtMs = parseIsoTimeMs(activeRun.lastUpdateAt);
          if (lastUpdateAtMs > 0 && (Date.now() - lastUpdateAtMs) < ACTIVE_RUN_STALE_PROCESS_GRACE_MS) {
            scheduleStaleRunCheck();
            return;
          }
          const error = new Error(`Codex child process disappeared (pid=${codexPid}) and the run was cleared as stale.`);
          staleRunAbortController.abort(error);
          console.warn(`message ${messageId} stale run watchdog aborted sessionKey=${key} pid=${codexPid}`);
          return;
        }

        const startedAtMs = parseIsoTimeMs(activeRun.startedAt);
        if (startedAtMs > 0 && (Date.now() - startedAtMs) >= ACTIVE_RUN_SPAWN_GRACE_MS) {
          const error = new Error('Codex child process did not register in time and the run was cleared as stale.');
          staleRunAbortController.abort(error);
          console.warn(`message ${messageId} stale run watchdog aborted sessionKey=${key} reason=missing_codex_pid`);
        }
      }, delayMs);
      if (typeof staleRunTimer.unref === 'function') {
        staleRunTimer.unref();
      }
    };
    const flushProgressUpdates = async () => {
      try {
        await progressUpdateChain;
      } catch {
      }
    };
    const sendProgressUpdate = (update) => {
      progressUpdateChain = progressUpdateChain.then(async () => {
        if (!shouldSendProgressUpdate(config, update) || progressState.finished || !state.activeRuns[key]) {
          return;
        }
        const now = Date.now();
        const enoughTime = progressState.lastSentAt === 0
          ? (now - Date.parse(progressState.startedAt)) >= config.progressInitialDelayMs || update.kind === 'todo'
          : (now - progressState.lastSentAt) >= config.progressUpdateIntervalMs;
        const underLimit = progressState.progressMessagesSent < config.progressMaxMessages;
        if (!enoughTime || !underLimit || update.text === progressState.lastProgressText) {
          return;
        }
        progressState.announced = true;
        progressState.lastSentAt = now;
        progressState.lastProgressText = update.text;
        progressState.progressMessagesSent += 1;
        await persistActiveRun({ lastProgressText: update.text, todoItems: update.todoItems || state.activeRuns[key]?.todoItems || [] });
        const replyIds = await sendReplyTextWithFallback(client, progressState.replyTargetMessageId, chatId, update.text, config.replyChunkLimit);
        if (replyIds.length > 0) {
          progressState.replyTargetMessageId = replyIds[replyIds.length - 1];
        }
      }).catch((error) => {
        console.warn(`progress update failed: ${describeError(error)}`);
      });
      return progressUpdateChain;
    };
    await persistActiveRun({
      lastProgressText: planningMode ? 'Planning started.' : 'Task accepted. Waiting for progress events.',
      todoItems: [],
    });
    scheduleStaleRunCheck();
    try {
      if (allowProcessingReaction && shouldUseTypingIndicator(config) && messageId) {
        reactionState = await addProcessingReaction(client, messageId, config.typingEmoji || DEFAULT_TYPING_EMOJI);
      }
      const result = await runCodexTurn(config, resumeThreadId, prompt, {
        signal: staleRunAbortController.signal,
        onSpawn: ({ pid }) => {
          progressState.codexPid = Number(pid) || null;
          void persistActiveRun({
            lastProgressText: progressState.lastProgressText || (planningMode ? 'Planning started.' : 'Task accepted. Waiting for progress events.'),
            todoItems: state.activeRuns[key]?.todoItems || [],
          });
          scheduleStaleRunCheck();
        },
        onEvent: (turnEvent) => {
          if (turnEvent?.type === 'thread.started' && turnEvent.thread_id) {
            observedThreadId = turnEvent.thread_id;
            activeThreadId = turnEvent.thread_id;
          }
          const update = extractProgressUpdate(turnEvent);
          if (!update) {
            return;
          }
          void sendProgressUpdate(update);
        },
      });
      let effectiveResult = result;
      resultRecoveredExitError = String(result?.recoveredExitError || '').trim();
      if (!effectiveResult && false) {
        throw new Error('unreachable');
      }
      console.log(`message ${messageId} codex completed: thread=${effectiveResult.threadId || resumeThreadId || '(none)'}`);
      if (resultRecoveredExitError) {
        clearBoundCodexThread(state, key, effectiveResult.threadId || resumeThreadId);
        console.warn(`message ${messageId} auto-reset unhealthy thread after recovered exit: ${oneLine(resultRecoveredExitError)}`);
      }
      const attachmentPaths = extractAttachmentDirectives(effectiveResult.reply || '');
      const strippedReply = stripAttachmentDirectives(effectiveResult.reply || '');
      const extractedPlan = extractPlanDirective(strippedReply, config.planQuestionLimit);
      const cleanReply = planningMode ? extractedPlan.cleanText : strippedReply;
      progressState.finished = true;
      await flushProgressUpdates();
      if (resultRecoveredExitError) {
        delete state.chatSessions[key];
      } else {
        state.chatSessions[key] = {
          threadId: effectiveResult.threadId || resumeThreadId,
          chatId,
          chatType,
          senderOpenId,
          updatedAt: nowIso(),
          lastMessageId: messageId,
        };
      }
      if (planningMode) {
        const planMeta = extractedPlan.plan || { status: 'ready', questions: [] };
        ensurePlanSessions(state)[key] = {
          status: planMeta.status === 'needs_input' ? 'awaiting_answers' : 'awaiting_approval',
          threadId: resultRecoveredExitError ? '' : (effectiveResult.threadId || resumeThreadId),
          chatId,
          chatType,
          senderOpenId,
          sourceMessageId: currentPlanSession?.sourceMessageId || messageId,
          createdAt: currentPlanSession?.createdAt || nowIso(),
          updatedAt: nowIso(),
          originalRequest: originalRequest || currentPlanSession?.originalRequest || '(unknown)',
          latestPlanText: cleanReply,
          questions: planMeta.status === 'needs_input' ? (planMeta.questions || []) : [],
          lastMessageId: messageId,
        };
      } else if (clearPlanOnSuccess) {
        clearPlanSession(state, key);
      }
      delete state.activeRuns[key];
      state.processedMessageIds[messageId] = nowIso();
      trimProcessed(state);
      await writeJson(stateFile, state);
      observedThreadId = effectiveResult.threadId || observedThreadId || resumeThreadId;
      await appendUsageLedger({
        status: 'completed',
        finalThreadId: observedThreadId,
      });
      const replyTextBase = planningMode ? decoratePlanReply(cleanReply, extractedPlan.plan || { status: 'ready', questions: [] }) : cleanReply;
      const replyText = resultRecoveredExitError
        ? `${buildCodexSessionResetNotice()}\n\n${replyTextBase}`.trim()
        : replyTextBase;
      if (replyText) {
        replyMessageIds = await sendReplyTextWithFallback(client, progressState.replyTargetMessageId, chatId, replyText, config.replyChunkLimit);
        if (replyMessageIds.length > 0) {
          progressState.replyTargetMessageId = replyMessageIds[replyMessageIds.length - 1];
        }
      } else if (attachmentPaths.length === 0) {
        replyMessageIds = await sendText(client, chatId, '(no reply)');
      }
      if (planningMode) {
        await maybeSendPlanCard({
          client,
          chatId,
          replyTargetMessageId: progressState.replyTargetMessageId,
          key,
          state,
          stateFile,
          config,
        });
      }
      if (!planningMode && attachmentPaths.length > 0) {
        const attachmentResults = await sendOutboundAttachments(client, progressState.replyTargetMessageId, attachmentPaths, config);
        const failed = attachmentResults.filter((item) => !item.ok);
        if (failed.length > 0) {
          const failedLines = await Promise.all(failed.map((item) => formatOutboundAttachmentFailure(item)));
          await sendReplyTextWithFallback(
            client,
            progressState.replyTargetMessageId,
            chatId,
            `Attachment delivery failed:\n${failedLines.join('\n')}`,
            config.replyChunkLimit,
          );
        }
      }
      console.log(`message ${messageId} reply delivered`);
      return {
        threadId: effectiveResult.threadId || resumeThreadId || '',
        replyMessageIds,
        sourceMessageId: messageId,
      };
    } catch (error) {
      if (shouldAutoResetCodexThreadAfterFailure(error, resumeThreadId)) {
        console.warn(`message ${messageId} resume thread failed and will be retried fresh: thread=${resumeThreadId} error=${oneLine(error instanceof Error ? error.message : String(error))}`);
        clearBoundCodexThread(state, key, resumeThreadId);
        observedThreadId = '';
        activeThreadId = '';
        progressState.codexPid = null;
        startedUsageSummary = null;
        await persistActiveRun({
          lastProgressText: 'Previous Codex thread became unhealthy. Retrying in a fresh thread.',
          todoItems: [],
          threadId: '',
          codexPid: null,
        });
        scheduleStaleRunCheck();
        try {
          const retryResult = await runCodexTurn(config, '', prompt, {
            signal: staleRunAbortController.signal,
            onSpawn: ({ pid }) => {
              progressState.codexPid = Number(pid) || null;
              void persistActiveRun({
                lastProgressText: 'Retrying in a fresh Codex thread.',
                todoItems: state.activeRuns[key]?.todoItems || [],
                threadId: '',
                codexPid: progressState.codexPid,
              });
              scheduleStaleRunCheck();
            },
            onEvent: (turnEvent) => {
              if (turnEvent?.type === 'thread.started' && turnEvent.thread_id) {
                observedThreadId = turnEvent.thread_id;
                activeThreadId = turnEvent.thread_id;
              }
              const update = extractProgressUpdate(turnEvent);
              if (!update) {
                return;
              }
              void sendProgressUpdate(update);
            },
          });
          resultRecoveredExitError = String(retryResult?.recoveredExitError || '').trim();
          console.log(`message ${messageId} fresh-thread retry completed: thread=${retryResult.threadId || '(none)'}`);
          const attachmentPaths = extractAttachmentDirectives(retryResult.reply || '');
          const strippedReply = stripAttachmentDirectives(retryResult.reply || '');
          const extractedPlan = extractPlanDirective(strippedReply, config.planQuestionLimit);
          const cleanReply = planningMode ? extractedPlan.cleanText : strippedReply;
          progressState.finished = true;
          await flushProgressUpdates();
          if (resultRecoveredExitError) {
            clearBoundCodexThread(state, key, retryResult.threadId || '');
          } else {
            state.chatSessions[key] = {
              threadId: retryResult.threadId || '',
              chatId,
              chatType,
              senderOpenId,
              updatedAt: nowIso(),
              lastMessageId: messageId,
            };
          }
          if (planningMode) {
            const planMeta = extractedPlan.plan || { status: 'ready', questions: [] };
            ensurePlanSessions(state)[key] = {
              status: planMeta.status === 'needs_input' ? 'awaiting_answers' : 'awaiting_approval',
              threadId: resultRecoveredExitError ? '' : (retryResult.threadId || ''),
              chatId,
              chatType,
              senderOpenId,
              sourceMessageId: currentPlanSession?.sourceMessageId || messageId,
              createdAt: currentPlanSession?.createdAt || nowIso(),
              updatedAt: nowIso(),
              originalRequest: originalRequest || currentPlanSession?.originalRequest || '(unknown)',
              latestPlanText: cleanReply,
              questions: planMeta.status === 'needs_input' ? (planMeta.questions || []) : [],
              lastMessageId: messageId,
            };
          } else if (clearPlanOnSuccess) {
            clearPlanSession(state, key);
          }
          delete state.activeRuns[key];
          state.processedMessageIds[messageId] = nowIso();
          trimProcessed(state);
          await writeJson(stateFile, state);
          observedThreadId = retryResult.threadId || observedThreadId || '';
          await appendUsageLedger({
            status: 'completed',
            finalThreadId: observedThreadId,
          });
          const replyTextBase = planningMode ? decoratePlanReply(cleanReply, extractedPlan.plan || { status: 'ready', questions: [] }) : cleanReply;
          const recoveryNotice = resultRecoveredExitError
            ? buildCodexSessionResetNotice()
            : 'I reset the previous Codex thread automatically and continued this request in a fresh thread. Re-send any key context if you still need it.';
          const replyText = `${recoveryNotice}\n\n${replyTextBase}`.trim();
          if (replyText) {
            replyMessageIds = await sendReplyTextWithFallback(client, progressState.replyTargetMessageId, chatId, replyText, config.replyChunkLimit);
            if (replyMessageIds.length > 0) {
              progressState.replyTargetMessageId = replyMessageIds[replyMessageIds.length - 1];
            }
          } else if (attachmentPaths.length === 0) {
            replyMessageIds = await sendText(client, chatId, recoveryNotice);
          }
          if (planningMode) {
            await maybeSendPlanCard({
              client,
              chatId,
              replyTargetMessageId: progressState.replyTargetMessageId,
              key,
              state,
              stateFile,
              config,
            });
          }
          if (!planningMode && attachmentPaths.length > 0) {
            const attachmentResults = await sendOutboundAttachments(client, progressState.replyTargetMessageId, attachmentPaths, config);
            const failed = attachmentResults.filter((item) => !item.ok);
            if (failed.length > 0) {
              const failedLines = await Promise.all(failed.map((item) => formatOutboundAttachmentFailure(item)));
              await sendReplyTextWithFallback(
                client,
                progressState.replyTargetMessageId,
                chatId,
                `Attachment delivery failed:\n${failedLines.join('\n')}`,
                config.replyChunkLimit,
              );
            }
          }
          console.log(`message ${messageId} reply delivered after fresh-thread recovery`);
          return {
            threadId: retryResult.threadId || '',
            replyMessageIds,
            sourceMessageId: messageId,
          };
        } catch (retryError) {
          error = retryError;
        }
      }
      progressState.finished = true;
      await flushProgressUpdates();
      delete state.activeRuns[key];
      if (isUserStopError(error)) {
        const interruptedPlan = !planningMode && clearPlanOnSuccess && planFailureStatus
          ? getPlanSession(state, key)
          : null;
        if (interruptedPlan) {
          interruptedPlan.status = planFailureStatus;
          interruptedPlan.updatedAt = nowIso();
        }
        state.processedMessageIds[messageId] = nowIso();
        trimProcessed(state);
        await writeJson(stateFile, state);
        await appendUsageLedger({
          status: 'stopped',
          finalThreadId: observedThreadId || resumeThreadId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        if (interruptedPlan) {
          await patchStoredPlanCard({
            client,
            key,
            state,
            stateFile,
            config,
            statusText: 'Execution was stopped. Approve again to restart, revise in chat, or cancel this plan.',
          });
        }
        console.log(`message ${messageId} stopped by user: sessionKey=${key}`);
        return {
          threadId: observedThreadId || resumeThreadId || '',
          replyMessageIds,
          sourceMessageId: messageId,
          stopped: true,
        };
      }
      if (!planningMode && clearPlanOnSuccess && planFailureStatus) {
        const failedPlan = getPlanSession(state, key);
        if (failedPlan) {
          failedPlan.status = planFailureStatus;
          failedPlan.updatedAt = nowIso();
        }
      }
      state.processedMessageIds[messageId] = nowIso();
      trimProcessed(state);
      await writeJson(stateFile, state);
      await appendUsageLedger({
        status: 'failed',
        finalThreadId: observedThreadId || resumeThreadId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      console.error(`message ${messageId} failed: ${describeError(error)}`);
      try {
        await sendText(client, chatId, `Codex execution failed: ${error instanceof Error ? error.message : String(error)}`);
      } catch (notifyError) {
        console.error(`message ${messageId} failed to send error notice: ${describeError(notifyError)}`);
      }
      throw error;
    } finally {
      progressState.finished = true;
      clearStaleRunTimer();
      clearActiveRunController(key, messageId);
      await removeProcessingReaction(client, reactionState);
    }
  });
  queues.set(key, next.catch(() => {}));
  return next;
}

async function handlePlanCardAction({
  actionEvent,
  state,
  stateFile,
  config,
  client,
  queues,
  scheduleExecution = enqueueTurn,
}) {
  const action = String(actionEvent?.action?.value?.action || '').trim();
  const key = String(actionEvent?.action?.value?.session_key || '').trim();
  const planUpdatedAt = String(actionEvent?.action?.value?.plan_updated_at || '').trim();
  if (!action || !key) {
    return buildPlanCard({
      key: key || 'unknown',
      planSession: { status: 'error', latestPlanText: '' },
      config,
      statusText: 'The card action payload was incomplete.',
    });
  }
  const planSession = getPlanSession(state, key);
  if (!planSession) {
    return buildPlanCard({
      key,
      planSession: { status: 'canceled', latestPlanText: '' },
      config,
      statusText: 'This plan is no longer active.',
    });
  }
  if (config.cardActionRequireSameUser && actionEvent?.open_id && planSession.senderOpenId && actionEvent.open_id !== planSession.senderOpenId) {
    return buildPlanCard({
      key,
      planSession: { ...planSession, status: 'error' },
      config,
      statusText: 'Only the original requester can approve or cancel this plan.',
    });
  }
  if (planUpdatedAt && planSession.updatedAt && planUpdatedAt !== planSession.updatedAt) {
    return buildPlanCard({
      key,
      planSession: { ...planSession, status: 'stale' },
      config,
      detailText: 'Use the newest card or reply in chat to continue.',
    });
  }
  if (action === 'cancel_plan') {
    clearPlanSession(state, key);
    await writeJson(stateFile, state);
    return buildPlanCard({
      key,
      planSession: { ...planSession, status: 'canceled' },
      config,
    });
  }
  if (action === 'revise_plan') {
    planSession.status = 'awaiting_answers';
    planSession.updatedAt = nowIso();
    await writeJson(stateFile, state);
    return buildPlanCard({
      key,
      planSession,
      config,
      statusText: 'Reply in chat with your requested changes and I will refresh the plan.',
      detailText: 'This card is now waiting for your revision notes.',
    });
  }
  if (action !== 'approve_plan') {
    return buildPlanCard({
      key,
      planSession: { ...planSession, status: 'error' },
      config,
      statusText: `Unsupported card action: ${action}`,
    });
  }
  if (planSession.status === 'awaiting_answers') {
    return buildPlanCard({
      key,
      planSession,
      config,
      statusText: 'Answer the open questions first, then approve the updated plan.',
    });
  }
  if (state.activeRuns?.[key]?.status === 'running' || planSession.status === 'approval_started') {
    return buildPlanCard({
      key,
      planSession: { ...planSession, status: 'approval_started' },
      config,
    });
  }
  const updatedPlanSession = markPlanExecutionRequested(state, key, actionEvent.open_id || '');
  await writeJson(stateFile, state);
  const syntheticEvent = buildSyntheticEventFromPlanSession(
    updatedPlanSession,
    actionEvent.open_id || updatedPlanSession?.senderOpenId || '',
    updatedPlanSession?.lastMessageId || actionEvent.open_message_id || `card-${randomUUID()}`,
  );
  const classification = classifyMessage({
    chatType: updatedPlanSession?.chatType || 'p2p',
    text: updatedPlanSession?.originalRequest || '',
    attachments: [],
  });
  const groupContext = updatedPlanSession?.chatType === 'group'
    ? state.groupContexts?.[updatedPlanSession.chatId] || null
    : null;
  void scheduleExecution({
    key,
    event: syntheticEvent,
    sourceMessageId: syntheticEvent.message.message_id,
    replyTargetMessageId: updatedPlanSession?.lastMessageId || actionEvent.open_message_id || syntheticEvent.message.message_id,
    runText: buildPlanExecutionPrompt(updatedPlanSession),
    attachments: [],
    classification,
    groupContext,
    planningMode: false,
    clearPlanOnSuccess: true,
    originalRequest: updatedPlanSession?.originalRequest || '',
    planFailureStatus: 'awaiting_approval',
    config,
    state,
    stateFile,
    client,
    queues,
  }).catch((error) => {
    console.error(`card action execution failed for session=${key}: ${describeError(error)}`);
  });
  return buildPlanCard({
    key,
    planSession: updatedPlanSession,
    config,
  });
}

async function executePlanCardAction({
  actionEvent,
  state,
  stateFile,
  config,
  client,
  queues,
  repairActiveRuns = null,
  source = 'unknown',
}) {
  try {
    if (typeof repairActiveRuns === 'function') {
      await repairActiveRuns(source === 'unknown' ? 'card_action' : `card_action:${source}`);
    }
    const normalizedActionEvent = normalizeCardActionPayload(actionEvent);
    const actionSessionKey = String(normalizedActionEvent?.action?.value?.session_key || '').trim();
    const existingPlanSession = actionSessionKey ? getPlanSession(state, actionSessionKey) : null;
    const resultCard = await handlePlanCardAction({
      actionEvent: normalizedActionEvent,
      state,
      stateFile,
      config,
      client,
      queues,
    });
    const targetMessageId = String(
      normalizedActionEvent?.open_message_id
      || normalizedActionEvent?.context?.open_message_id
      || existingPlanSession?.cardMessageId
      || '',
    ).trim();
    if (source === 'long_connection') {
      if (targetMessageId && resultCard && typeof resultCard === 'object') {
        try {
          await patchInteractiveCardMessage(client, targetMessageId, resultCard);
          const key = String(normalizedActionEvent?.action?.value?.session_key || '').trim();
          const planSession = key ? getPlanSession(state, key) : null;
          if (planSession) {
            planSession.cardMessageId = targetMessageId;
            planSession.cardUpdatedAt = nowIso();
            await writeJson(stateFile, state);
          }
          console.log(`feishu card message patched via api message_id=${targetMessageId}`);
        } catch (patchError) {
          console.error(`feishu card message patch failed for message_id=${targetMessageId}: ${describeError(patchError)}`);
        }
      } else {
        console.warn(`feishu long connection card action missing patch target: message_id=${targetMessageId || '-'} summary=${summarizeCardActionPayload(normalizedActionEvent)}`);
      }
      // Persistent-connection card callbacks should also return the updated card
      // so Feishu applies the new state immediately on the callback response path.
      return resultCard;
    }
    return resultCard;
  } catch (error) {
    console.error(`card action failed via ${source}: ${describeError(error)}`);
    return buildPlanCard({
      key: 'unknown',
      planSession: { status: 'error', latestPlanText: '' },
      config,
      statusText: 'The card action failed. Check gateway logs.',
    });
  }
}

async function processEvent({ event, config, state, stateFile, client, botInfo, queues, inFlightMessageIds, repairActiveRuns = null }) {
  const message = event.message || {};
  const messageId = message.message_id;
  if (!messageId) {
    return;
  }
  if (state.processedMessageIds[messageId] || inFlightMessageIds.has(messageId)) {
    console.log(`message ${messageId} skipped: already processed or in flight`);
    return;
  }
  inFlightMessageIds.add(messageId);
  try {
    if (typeof repairActiveRuns === 'function') {
      await repairActiveRuns('message_receive');
    }
    if ((event.sender?.sender_type || '').toLowerCase() === 'app') {
      console.log(`message ${messageId} ignored: sender_type=app`);
      state.processedMessageIds[messageId] = nowIso();
      return;
    }
    if (!isAllowedEvent(event, config)) {
      console.log(`message ${messageId} ignored: sender not allowed`);
      state.processedMessageIds[messageId] = nowIso();
      await writeJson(stateFile, state);
      return;
    }
    if (message.chat_type === 'group' && config.requireMentionInGroups && !isBotMentioned(event, botInfo.botOpenId)) {
      console.log(`message ${messageId} ignored: missing mention in group`);
      state.processedMessageIds[messageId] = nowIso();
      await writeJson(stateFile, state);
      return;
    }

    const attachments = await resolveInboundAttachments(config, client, message);
    const rawText = loadMessageText(message);
    const text = normalizeMentions(rawText, message.mentions || [], botInfo.botOpenId) || (attachments.length > 0 ? '请处理我发来的附件。' : '');
    const command = parseSlashCommand(text);
    const key = sessionKeyOf(event, config);
    const commandName = command?.name || '';
    let planSession = getPlanSession(state, key);
    const effectiveText = command?.name === 'plan' || isDirectExecuteCommand(commandName) ? command.args : text;
    const classification = classifyMessage({ chatType: message.chat_type, text: effectiveText || text, attachments });
    const autoPlanDecision = shouldAutoPlanMessage({ event, command, classification, attachments, text: effectiveText || text, config });
    console.log(`message ${messageId} accepted: chat=${message.chat_id || '-'} type=${message.chat_type || '-'} intent=${classification.intent || 'general'} command=${command?.name || 'none'} attachments=${attachments.length}`);
    const groupContext = updateGroupContext(state, event, effectiveText || text, attachments, classification, config);
    const workflowControlCommand = commandName === 'plan'
      || isPlanApprovalCommand(commandName)
      || isPlanCancelCommand(commandName)
      || isExecutionStopCommand(commandName)
      || isDirectExecuteCommand(commandName);

    if (!effectiveText && attachments.length === 0 && !workflowControlCommand) {
      state.processedMessageIds[messageId] = nowIso();
      await sendText(client, message.chat_id, `暂不支持直接处理 ${message.message_type || 'unknown'} 类型消息。`);
      await writeJson(stateFile, state);
      return;
    }

    if (command?.name === 'plan' && !effectiveText && attachments.length === 0) {
      state.processedMessageIds[messageId] = nowIso();
      await sendText(client, message.chat_id, 'Usage: /plan <task description>', config.replyChunkLimit);
      await writeJson(stateFile, state);
      return;
    }

    if (isDirectExecuteCommand(commandName) && !effectiveText && attachments.length === 0) {
      state.processedMessageIds[messageId] = nowIso();
      await sendText(client, message.chat_id, 'Usage: /run <task description>', config.replyChunkLimit);
      await writeJson(stateFile, state);
      return;
    }

    if (isExecutionStopCommand(commandName)) {
      state.processedMessageIds[messageId] = nowIso();
      const stopState = requestActiveRunStop(key, `Stopped by ${senderOpenIdOf(event) || 'user'} via /stop.`);
      let replyText = 'No live task is running in this chat.';
      if (stopState === 'requested') {
        if (state.activeRuns?.[key]) {
          state.activeRuns[key].lastUpdateAt = nowIso();
          state.activeRuns[key].lastProgressText = 'Stop requested by user.';
          state.activeRuns[key].stopRequestedAt = nowIso();
        }
        replyText = 'Stopping the current execution in this chat. Later queued messages, if any, will still run.';
      } else if (stopState === 'already_requested') {
        replyText = 'Stop is already in progress for this chat.';
      }
      trimProcessed(state);
      await writeJson(stateFile, state);
      await sendText(client, message.chat_id, replyText, config.replyChunkLimit);
      return;
    }

    if (isPlanCancelCommand(commandName)) {
      state.processedMessageIds[messageId] = nowIso();
      if (planSession) {
        clearPlanSession(state, key);
        await sendText(client, message.chat_id, 'Cleared the pending plan for this chat.', config.replyChunkLimit);
      } else {
        await sendText(client, message.chat_id, 'No pending plan to cancel in this chat.', config.replyChunkLimit);
      }
      trimProcessed(state);
      await writeJson(stateFile, state);
      return;
    }

    if (attachments.length === 0 && !workflowControlCommand && await handleCommand({ event, command, state, config, client, botInfo })) {
      state.processedMessageIds[messageId] = nowIso();
      trimProcessed(state);
      await writeJson(stateFile, state);
      return;
    }

    let planningMode = false;
    let clearPlanOnSuccess = false;
    let runText = effectiveText || text;
    let planFailureStatus = '';

    if (commandName === 'plan') {
      planningMode = true;
      runText = effectiveText;
    } else if (isPlanApprovalCommand(commandName)) {
      if (!planSession) {
        state.processedMessageIds[messageId] = nowIso();
        await sendText(client, message.chat_id, 'No approved plan is waiting in this chat. Send a task first to start planning.', config.replyChunkLimit);
        trimProcessed(state);
        await writeJson(stateFile, state);
        return;
      }
      if (planSession.status === 'awaiting_answers') {
        state.processedMessageIds[messageId] = nowIso();
        await sendText(client, message.chat_id, `Please answer the open planning questions first:\n- ${(planSession.questions || []).join('\n- ')}`, config.replyChunkLimit);
        trimProcessed(state);
        await writeJson(stateFile, state);
        return;
      }
      planSession = markPlanExecutionRequested(state, key, senderOpenIdOf(event)) || planSession;
      planFailureStatus = 'awaiting_approval';
      runText = buildPlanExecutionPrompt(planSession, command.args);
      clearPlanOnSuccess = true;
    } else if (isDirectExecuteCommand(commandName)) {
      runText = effectiveText;
      clearPlanOnSuccess = true;
    } else if (planSession?.status === 'awaiting_answers') {
      planningMode = true;
      runText = buildPlanFollowupPrompt(planSession, text, 'answers');
    } else if (planSession?.status === 'awaiting_approval') {
      planningMode = true;
      runText = buildPlanFollowupPrompt(planSession, text, 'revision');
    } else if (autoPlanDecision) {
      planningMode = true;
      runText = effectiveText || text;
    } else {
      clearPlanOnSuccess = true;
    }

    if (planFailureStatus) {
      await writeJson(stateFile, state);
      await patchStoredPlanCard({
        client,
        key,
        state,
        stateFile,
        config,
      });
    }

    const originalRequest = buildOriginalRequest({
      planSession,
      commandName,
      autoPlanDecision,
      effectiveText,
      text,
    });

    await enqueueTurn({
      key,
      event,
      sourceMessageId: messageId,
      replyTargetMessageId: messageId,
      runText,
      attachments,
      classification,
      groupContext,
      planningMode,
      clearPlanOnSuccess,
      originalRequest,
      planFailureStatus,
      config,
      state,
      stateFile,
      client,
      queues,
    });
    return;

    const queue = queues.get(key) || Promise.resolve();
    const next = queue.then(async () => {
      const existing = state.chatSessions[key];
      const resumeThreadId = planSession?.threadId || existing?.threadId || '';
      const prompt = buildPrompt(event, runText, attachments, { classification, groupContext, planOnly: planningMode });
      console.log(`message ${messageId} starting codex turn: sessionKey=${key} existingThread=${resumeThreadId || '(new)'} mode=${planningMode ? 'plan' : 'execute'}`);
      let reactionState = null;
      const progressState = {
        announced: false,
        finished: false,
        lastSentAt: 0,
        lastProgressText: '',
        progressMessagesSent: 0,
        startedAt: nowIso(),
        replyTargetMessageId: messageId,
      };
      const persistActiveRun = async (extra = {}) => {
        state.activeRuns[key] = {
          status: 'running',
          mode: planningMode ? 'plan' : 'execute',
          startedAt: progressState.startedAt,
          lastUpdateAt: nowIso(),
          lastProgressText: progressState.lastProgressText || 'Accepted and waiting for progress events.',
          sourceMessageId: messageId,
          threadId: resumeThreadId,
          ...extra,
        };
        await writeJson(stateFile, state);
      };
      const sendProgressUpdate = async (update) => {
        if (!shouldSendProgressUpdate(config, update) || progressState.finished) {
          return;
        }
        const now = Date.now();
        const enoughTime = progressState.lastSentAt === 0
          ? (now - Date.parse(progressState.startedAt)) >= config.progressInitialDelayMs || update.kind === 'todo'
          : (now - progressState.lastSentAt) >= config.progressUpdateIntervalMs;
        const underLimit = progressState.progressMessagesSent < config.progressMaxMessages;
        if (!enoughTime || !underLimit || update.text === progressState.lastProgressText) {
          return;
        }
        progressState.announced = true;
        progressState.lastSentAt = now;
        progressState.lastProgressText = update.text;
        progressState.progressMessagesSent += 1;
        await persistActiveRun({ lastProgressText: update.text, todoItems: update.todoItems || state.activeRuns[key]?.todoItems || [] });
        const replyIds = await sendReplyTextWithFallback(client, progressState.replyTargetMessageId, message.chat_id, update.text, config.replyChunkLimit);
        if (replyIds.length > 0) {
          progressState.replyTargetMessageId = replyIds[replyIds.length - 1];
        }
      };
      await persistActiveRun({
        lastProgressText: planningMode ? 'Planning started.' : 'Task accepted. Waiting for progress events.',
        todoItems: [],
      });
      const progressTimer = null;
      try {
        if (shouldUseTypingIndicator(config)) {
          reactionState = await addProcessingReaction(client, messageId, config.typingEmoji || DEFAULT_TYPING_EMOJI);
        }
        const result = await runCodexTurn(config, resumeThreadId, prompt, {
          onEvent: (event) => {
            const update = extractProgressUpdate(event);
            if (!update) {
              return;
            }
            void sendProgressUpdate(update);
          },
        });
        console.log(`message ${messageId} codex completed: thread=${result.threadId || resumeThreadId || '(none)'}`);
        const attachmentPaths = extractAttachmentDirectives(result.reply || '');
        const strippedReply = stripAttachmentDirectives(result.reply || '');
        const extractedPlan = extractPlanDirective(strippedReply, config.planQuestionLimit);
        const cleanReply = planningMode ? extractedPlan.cleanText : strippedReply;
        state.chatSessions[key] = {
          threadId: result.threadId || resumeThreadId,
          chatId: message.chat_id,
          chatType: message.chat_type,
          senderOpenId: senderOpenIdOf(event),
          updatedAt: nowIso(),
          lastMessageId: messageId,
        };
        if (planningMode) {
          const planMeta = extractedPlan.plan || { status: 'ready', questions: [] };
          ensurePlanSessions(state)[key] = {
            status: planMeta.status === 'needs_input' ? 'awaiting_answers' : 'awaiting_approval',
            threadId: result.threadId || resumeThreadId,
            chatId: message.chat_id,
            chatType: message.chat_type,
            senderOpenId: senderOpenIdOf(event),
            sourceMessageId: planSession?.sourceMessageId || messageId,
            createdAt: planSession?.createdAt || nowIso(),
            updatedAt: nowIso(),
            originalRequest: planSession?.originalRequest || (commandName === 'plan' || shouldAutoPlanMessage({ event, command, classification, attachments, text: effectiveText || text, config }) ? (effectiveText || text) : (planSession?.originalRequest || effectiveText || text)),
            latestPlanText: cleanReply,
            questions: planMeta.status === 'needs_input' ? (planMeta.questions || []) : [],
            lastMessageId: messageId,
          };
        } else if (clearPlanOnSuccess) {
          clearPlanSession(state, key);
        }
        delete state.activeRuns[key];
        state.processedMessageIds[messageId] = nowIso();
        trimProcessed(state);
        await writeJson(stateFile, state);
        const replyText = planningMode ? decoratePlanReply(cleanReply, extractedPlan.plan || { status: 'ready', questions: [] }) : cleanReply;
        if (replyText) {
          const replyIds = await sendReplyTextWithFallback(client, progressState.replyTargetMessageId, message.chat_id, replyText, config.replyChunkLimit);
          if (replyIds.length > 0) {
            progressState.replyTargetMessageId = replyIds[replyIds.length - 1];
          }
        } else if (attachmentPaths.length === 0) {
          await sendText(client, message.chat_id, '(无回复)');
        }
        if (!planningMode && attachmentPaths.length > 0) {
          const attachmentResults = await sendOutboundAttachments(client, progressState.replyTargetMessageId, attachmentPaths, config);
          const failed = attachmentResults.filter((item) => !item.ok);
          if (failed.length > 0) {
            const failedLines = await Promise.all(failed.map((item) => formatOutboundAttachmentFailure(item)));
            await sendReplyTextWithFallback(
              client,
              progressState.replyTargetMessageId,
              message.chat_id,
              `Attachment delivery failed:\n${failedLines.join('\n')}`,
              config.replyChunkLimit,
            );
          }
        }
        console.log(`message ${messageId} reply delivered`);
      } catch (error) {
        delete state.activeRuns[key];
        state.processedMessageIds[messageId] = nowIso();
        trimProcessed(state);
        await writeJson(stateFile, state);
        console.error(`message ${messageId} failed: ${describeError(error)}`);
        try {
          await sendText(client, message.chat_id, `Codex 执行失败：${error instanceof Error ? error.message : String(error)}`);
        } catch (notifyError) {
          console.error(`message ${messageId} failed to send error notice: ${describeError(notifyError)}`);
        }
      } finally {
        progressState.finished = true;
        if (progressTimer) {
          clearTimeout(progressTimer);
        }
        await removeProcessingReaction(client, reactionState);
      }
    });
    queues.set(key, next.catch(() => {}));
    await next;
  } finally {
    inFlightMessageIds.delete(messageId);
  }
}

async function commandAuthTest(config) {
  const botInfo = await fetchBotInfo(config);
  console.log(JSON.stringify({ ok: true, ...botInfo, appId: config.appId }, null, 2));
}

async function commandAttachmentSmokeTest(config, options) {
  const chatId = String(options['chat-id'] || config.startupNotifyChatIds?.[0] || '').trim();
  if (!chatId) {
    throw new Error('Missing --chat-id, and startupNotifyChatIds is empty.');
  }

  const includeLarge = options.large !== false;
  const client = createClient(config);
  const tempDir = path.join(os.tmpdir(), `codex-feishu-smoke-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const artifacts = await createSmokeTestArtifacts(tempDir, config, {
      largeBytes: options['large-bytes'],
    });
    const attachments = [artifacts.textPath, artifacts.imagePath];
    if (includeLarge) {
      attachments.push(artifacts.largePath);
    }

    const introMessageIds = await sendText(
      client,
      chatId,
      [
        'Codex Feishu attachment smoke test starting.',
        `time: ${nowIso()}`,
        `attachments: ${attachments.map((filePath) => path.basename(filePath)).join(', ')}`,
        includeLarge ? `large_attachment_size: ${formatSize(artifacts.largeBytes)}` : 'large_attachment_size: skipped',
      ].join('\n'),
      config.replyChunkLimit,
    );
    const replyTargetMessageId = introMessageIds[introMessageIds.length - 1];
    const results = await sendOutboundAttachments(client, replyTargetMessageId, attachments, config);
    const failed = results.filter((item) => !item.ok);

    if (failed.length > 0) {
      const failureLines = await Promise.all(failed.map((item) => formatOutboundAttachmentFailure(item)));
      await sendText(client, chatId, `Attachment smoke test failed:\n${failureLines.join('\n')}`, config.replyChunkLimit);
      throw new Error(failureLines.join('; '));
    }

    await sendText(
      client,
      chatId,
      [
        'Attachment smoke test completed successfully.',
        ...results.map((item) => {
          if (item.delivery === 'split') {
            return `${path.basename(item.filePath)}: split into ${item.partCount} parts`;
          }
          if (item.delivery === 'file-fallback') {
            return `${path.basename(item.filePath)}: sent as file fallback`;
          }
          return `${path.basename(item.filePath)}: sent as ${item.delivery || 'attachment'}`;
        }),
      ].join('\n'),
      config.replyChunkLimit,
    );

    console.log(JSON.stringify({ ok: true, chatId, results }, null, 2));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function commandWatch(config) {
  const stateFile = config.stateFile || DEFAULT_STATE_PATH;
  const state = await ensureState(stateFile);
  const clearedActiveRuns = await clearTransientStateOnStartup(state, stateFile);
  await syncCardCallbackRuntimeOnStartup(config, state, stateFile);
  const botInfo = await fetchBotInfo(config);
  state.botInfo = { ...botInfo, checkedAt: nowIso(), appId: config.appId };
  await writeJson(stateFile, state);

  const client = createClient(config);
  const queues = new Map();
  const inFlightMessageIds = new Set();
  const keepAlive = setInterval(() => {}, 60_000);
  let activeRunRepairInFlight = null;
  const triggerActiveRunRepair = async (source = 'runtime_watchdog') => {
    if (activeRunRepairInFlight) {
      return activeRunRepairInFlight;
    }
    activeRunRepairInFlight = repairStaleActiveRuns(state, stateFile, source).catch((error) => {
      console.error(`active run repair failed (${source}): ${describeError(error)}`);
      return 0;
    }).finally(() => {
      activeRunRepairInFlight = null;
    });
    return activeRunRepairInFlight;
  };
  const activeRunRepairTimer = setInterval(() => {
    void triggerActiveRunRepair('watchdog_interval');
  }, ACTIVE_RUN_WATCH_INTERVAL_MS);
  let startupNotifyInFlight = null;
  let cardServer = null;
  let cardTunnel = null;

  if (typeof keepAlive.unref === 'function') {
    keepAlive.unref();
  }
  if (typeof activeRunRepairTimer.unref === 'function') {
    activeRunRepairTimer.unref();
  }

  const triggerStartupNotification = async () => {
    if (startupNotifyInFlight) {
      return startupNotifyInFlight;
    }
    startupNotifyInFlight = (async () => {
      try {
        await maybeSendStartupNotification({
          config,
          state,
          stateFile,
          client,
          botInfo,
          queues,
          startupContext: { clearedActiveRuns },
        });
      } catch (error) {
        console.error(`startup notification failed: ${describeError(error)}`);
      }
      try {
        await maybeSendStartupMorningBrief({
          config,
          state,
          stateFile,
          client,
        });
      } catch (error) {
        console.error(`startup morning brief failed: ${describeError(error)}`);
      }
    })().finally(() => {
      startupNotifyInFlight = null;
    });
    return startupNotifyInFlight;
  };

  const wsClient = createWsClient(config, {
    onReady: triggerStartupNotification,
  });

  const eventDispatcher = new Lark.EventDispatcher({
    verificationToken: config.verificationToken || undefined,
    encryptKey: config.encryptKey || undefined,
  }).register({
    'im.message.receive_v1': async (event) => {
      console.log(`feishu incoming message chat=${event.message?.chat_id || '-'} type=${event.message?.chat_type || '-'} id=${event.message?.message_id || '-'}`);
      try {
        await processEvent({ event, config, state, stateFile, client, botInfo, queues, inFlightMessageIds, repairActiveRuns: triggerActiveRunRepair });
      } catch (error) {
        console.error(`message ${event.message?.message_id || '-'} handler failed: ${describeError(error)}`);
      }
    },
  });

  const wsDispatcher = {
    invoke: async (data, params = {}) => {
      const normalizedData = normalizeCardActionPayload(data);
      const callbackEventType = getFeishuCallbackEventType(normalizedData);
      const shouldHandleCardAction = config.cardLongConnectionEnabled
        && (
          params?.messageType === WS_MESSAGE_TYPE_CARD
          || looksLikeCardActionPayload(normalizedData)
          || isKnownCardActionEventType(normalizedData)
        );
      if (shouldHandleCardAction) {
        console.log(`feishu card action received via long connection type=${params?.messageType || callbackEventType || 'unknown'} summary=${summarizeCardActionPayload(normalizedData)}`);
        return executePlanCardAction({
          actionEvent: normalizedData,
          state,
          stateFile,
          config,
          client,
          queues,
          repairActiveRuns: triggerActiveRunRepair,
          source: 'long_connection',
        });
      }
      return eventDispatcher.invoke(data, params);
    },
  };

  if (config.planCardsEnabled && !config.cardCallbackEnabled && !config.cardLongConnectionEnabled) {
    console.log('plan cards are enabled in display-only mode; configure a callback endpoint or enable long-connection card actions to turn buttons on');
  }
  if (config.cardCallbackEnabled) {
    if (!config.verificationToken) {
      console.warn('card callback is enabled without verificationToken; this only works if callback security verification is disabled in Feishu');
    }
    const localCallbackUrl = buildLocalCardCallbackUrl(config);
    const cardDispatcher = new Lark.CardActionHandler(
      {
        verificationToken: config.verificationToken || undefined,
        encryptKey: config.encryptKey || undefined,
      },
        async (actionEvent) => executePlanCardAction({
          actionEvent,
          state,
          stateFile,
          config,
          client,
          queues,
          repairActiveRuns: triggerActiveRunRepair,
          source: 'http_callback',
        }),
      );
    const callbackDispatcher = {
      encryptKey: config.encryptKey || undefined,
      verificationToken: config.verificationToken || undefined,
      invoke: async (data) => {
        if (isFeishuEventCallbackPayload(data)) {
          const eventType = data.header?.event_type || data.type || 'unknown';
          console.log(`feishu callback event received type=${eventType}`);
          return (await eventDispatcher.invoke(data)) ?? { code: 0 };
        }
        console.log('feishu card callback received');
        return cardDispatcher.invoke(data);
      },
    };
    cardServer = http.createServer();
    cardServer.on('request', Lark.adaptDefault(config.cardCallbackPath, callbackDispatcher, {
      autoChallenge: config.cardCallbackAutoChallenge,
    }));
    await new Promise((resolve, reject) => {
      cardServer.once('error', reject);
      cardServer.listen(config.cardCallbackPort, config.cardCallbackHost, () => resolve());
    });
    await updateCardCallbackRuntimeState(state, stateFile, {
      status: 'listening',
      localCallbackUrl,
      publicBaseUrl: '',
      publicCallbackUrl: '',
      tunnelPid: null,
      autoChallenge: config.cardCallbackAutoChallenge,
    });
    console.log(`card callback listening on ${localCallbackUrl}`);
    if (config.cardCallbackAutoChallenge) {
      console.log('card callback challenge handling is enabled');
    }
    if (config.cardCallbackPublicBaseUrl) {
      const publicCallbackUrl = buildCallbackUrlFromBase(config.cardCallbackPublicBaseUrl, config.cardCallbackPath);
      console.log(`card callback public url ${publicCallbackUrl}`);
      await updateCardCallbackRuntimeState(state, stateFile, {
        status: 'public_url_configured',
        localCallbackUrl,
        publicBaseUrl: config.cardCallbackPublicBaseUrl,
        publicCallbackUrl,
      });
    }
    if (config.cardCallbackTunnelEnabled) {
      cardTunnel = await startCardCallbackTunnel({ config, state, stateFile });
    }
    if (!config.cardCallbackPublicBaseUrl && !config.cardCallbackTunnelEnabled) {
      console.warn('card callback is listening locally, but no public callback URL is configured yet');
    }
  }

  const shutdown = async (reason) => {
    console.log(`feishu gateway stopping (${reason})`);
    clearInterval(keepAlive);
    clearInterval(activeRunRepairTimer);
    if (cardTunnel?.child && !cardTunnel.child.killed) {
      cardTunnel.child.kill();
    }
    if (cardServer) {
      await new Promise((resolve) => {
        cardServer.close(() => resolve());
      });
    }
    if (config.cardCallbackEnabled) {
      await updateCardCallbackRuntimeState(state, stateFile, {
        status: 'stopped',
        tunnelPid: null,
      });
    }
    await writeJson(stateFile, state);
    process.exit(0);
  };

  process.on('unhandledRejection', (error) => {
    console.error('unhandledRejection', error instanceof Error ? error.stack || error.message : String(error));
  });
  process.on('uncaughtException', (error) => {
    console.error('uncaughtException', error instanceof Error ? error.stack || error.message : String(error));
  });

  console.log(`feishu gateway starting for bot=${botInfo.botName || '(unknown)'} open_id=${botInfo.botOpenId || '(unknown)'}`);
  console.log(`workspace=${config.workspace}`);
  console.log(`state=${stateFile}`);
  console.log(`plan_cards=${config.planCardsEnabled ? 'enabled' : 'disabled'} card_callback_http=${config.cardCallbackEnabled ? 'enabled' : 'disabled'} card_callback_ws=${config.cardLongConnectionEnabled ? 'enabled' : 'disabled'}`);
  wsClient.start({ eventDispatcher: wsDispatcher });

  process.on('SIGINT', async () => { await shutdown('SIGINT'); });
  process.on('SIGTERM', async () => { await shutdown('SIGTERM'); });

  await new Promise(() => {});
}

async function loadConfig(options) {
  const configPath = options.config ? path.resolve(options.config) : DEFAULT_CONFIG_PATH;
  const fileConfig = await readJson(configPath, {});
  const merged = withDefaults(fileConfig, {
    appId: options['app-id'] || process.env.FEISHU_APP_ID || fileConfig.appId,
    appSecret: options['app-secret'] || process.env.FEISHU_APP_SECRET || fileConfig.appSecret,
    botName: options['bot-name'] || process.env.FEISHU_BOT_NAME || fileConfig.botName,
    workspace: options.workspace || process.env.CODEX_FEISHU_WORKSPACE || fileConfig.workspace,
    codexBin: options['codex-bin'] || process.env.CODEX_BIN || fileConfig.codexBin,
    codexSessionsRoot: options['codex-sessions-root'] || process.env.CODEX_SESSIONS_ROOT || fileConfig.codexSessionsRoot,
    stateFile: options['state-file'] || process.env.FEISHU_GATEWAY_STATE || fileConfig.stateFile,
    usageLedgerEnabled: options['usage-ledger-enabled'] ?? process.env.FEISHU_USAGE_LEDGER_ENABLED ?? fileConfig.usageLedgerEnabled,
    usageLedgerFile: options['usage-ledger-file'] || process.env.FEISHU_USAGE_LEDGER_FILE || fileConfig.usageLedgerFile,
    domain: options.domain || process.env.FEISHU_DOMAIN || fileConfig.domain,
    dmPolicy: options['dm-policy'] || fileConfig.dmPolicy,
    groupPolicy: options['group-policy'] || fileConfig.groupPolicy,
    requireMentionInGroups: options['require-mention-in-groups'] !== undefined ? options['require-mention-in-groups'] !== false : fileConfig.requireMentionInGroups,
    allowFrom: options['allow-from'] || fileConfig.allowFrom,
    groupAllowFrom: options['group-allow-from'] || fileConfig.groupAllowFrom,
    groupSessionScope: options['group-session-scope'] || fileConfig.groupSessionScope,
    groupAssistantMode: options['group-assistant-mode'] || fileConfig.groupAssistantMode,
    startupMorningBriefEnabled: options['startup-morning-brief-enabled'] ?? process.env.FEISHU_STARTUP_MORNING_BRIEF_ENABLED ?? fileConfig.startupMorningBriefEnabled,
    startupMorningBriefChatIds: options['startup-morning-brief-chat-ids'] || process.env.FEISHU_STARTUP_MORNING_BRIEF_CHAT_IDS || fileConfig.startupMorningBriefChatIds,
    startupMorningBriefMaxItems: options['startup-morning-brief-max-items'] || process.env.FEISHU_STARTUP_MORNING_BRIEF_MAX_ITEMS || fileConfig.startupMorningBriefMaxItems,
    startupMorningBriefMaxAgeDays: options['startup-morning-brief-max-age-days'] || process.env.FEISHU_STARTUP_MORNING_BRIEF_MAX_AGE_DAYS || fileConfig.startupMorningBriefMaxAgeDays,
    startupMorningBriefDeduplicateDaily: options['startup-morning-brief-deduplicate-daily'] ?? process.env.FEISHU_STARTUP_MORNING_BRIEF_DEDUPLICATE_DAILY ?? fileConfig.startupMorningBriefDeduplicateDaily,
    startupMorningBriefTimeZone: options['startup-morning-brief-time-zone'] || process.env.FEISHU_STARTUP_MORNING_BRIEF_TIME_ZONE || fileConfig.startupMorningBriefTimeZone,
    planCardsEnabled: options['plan-cards-enabled'] ?? process.env.FEISHU_PLAN_CARDS_ENABLED ?? fileConfig.planCardsEnabled,
    cardCallbackEnabled: options['card-callback-enabled'] ?? process.env.FEISHU_CARD_CALLBACK_ENABLED ?? fileConfig.cardCallbackEnabled,
    cardLongConnectionEnabled: options['card-long-connection-enabled'] ?? process.env.FEISHU_CARD_LONG_CONNECTION_ENABLED ?? fileConfig.cardLongConnectionEnabled,
    cardCallbackHost: options['card-callback-host'] || process.env.FEISHU_CARD_CALLBACK_HOST || fileConfig.cardCallbackHost,
    cardCallbackPort: options['card-callback-port'] || process.env.FEISHU_CARD_CALLBACK_PORT || fileConfig.cardCallbackPort,
    cardCallbackPath: options['card-callback-path'] || process.env.FEISHU_CARD_CALLBACK_PATH || fileConfig.cardCallbackPath,
    cardCallbackAutoChallenge: options['card-callback-auto-challenge'] ?? process.env.FEISHU_CARD_CALLBACK_AUTO_CHALLENGE ?? fileConfig.cardCallbackAutoChallenge,
    cardCallbackPublicBaseUrl: options['card-callback-public-base-url'] || process.env.FEISHU_CARD_CALLBACK_PUBLIC_BASE_URL || fileConfig.cardCallbackPublicBaseUrl,
    cardCallbackTunnelEnabled: options['card-callback-tunnel-enabled'] ?? process.env.FEISHU_CARD_CALLBACK_TUNNEL_ENABLED ?? fileConfig.cardCallbackTunnelEnabled,
    cardCallbackTunnelBin: options['card-callback-tunnel-bin'] || process.env.FEISHU_CARD_CALLBACK_TUNNEL_BIN || fileConfig.cardCallbackTunnelBin,
    verificationToken: options['verification-token'] || process.env.FEISHU_VERIFICATION_TOKEN || fileConfig.verificationToken,
    encryptKey: options['encrypt-key'] || process.env.FEISHU_ENCRYPT_KEY || fileConfig.encryptKey,
    cardActionRequireSameUser: options['card-action-require-same-user'] ?? process.env.FEISHU_CARD_ACTION_REQUIRE_SAME_USER ?? fileConfig.cardActionRequireSameUser,
    simpleTaskMaxChars: options['simple-task-max-chars'] || process.env.FEISHU_SIMPLE_TASK_MAX_CHARS || fileConfig.simpleTaskMaxChars,
    simpleTaskMaxLines: options['simple-task-max-lines'] || process.env.FEISHU_SIMPLE_TASK_MAX_LINES || fileConfig.simpleTaskMaxLines,
  });
  merged.configPath = configPath;
  if (!merged.appId || !merged.appSecret) {
    throw new Error(`Missing appId/appSecret. Provide them in ${configPath} or via CLI/env.`);
  }
  return merged;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const config = await loadConfig(options);
  if (command === 'auth-test') {
    await commandAuthTest(config);
    return;
  }
  if (command === 'attachment-smoke-test') {
    await commandAttachmentSmokeTest(config, options);
    return;
  }
  if (command === 'watch') {
    await commandWatch(config);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

export {
  buildCallbackUrlFromBase,
  buildCodexCliArgs,
  buildCodexSessionResetNotice,
  buildLocalCardCallbackUrl,
  buildPlanCard,
  buildPlanExecutionPrompt,
  buildSplitAttachmentNotice,
  decoratePlanReply,
  extractPublicHttpUrls,
  extractPlanDirective,
  extractAttachmentDirectives,
  formatOutboundAttachmentFailure,
  getFeishuFileSplitChunkBytes,
  getFeishuFileUploadMaxBytes,
  handlePlanCardAction,
  clearBoundCodexThread,
  isRecoverableCodexExitErrorMessage,
  isSimpleDirectExecuteCandidate,
  isOutboundAttachmentTooLarge,
  shouldAutoPlanMessage,
  shouldAutoResetCodexThreadAfterFailure,
  shouldTreatNonZeroCodexExitAsRecoveredReply,
  sendOutboundAttachment,
  sendOutboundAttachments,
  splitFileForUpload,
  stripAttachmentDirectives,
  withDefaults,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
