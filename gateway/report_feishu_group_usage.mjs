import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[token] = true;
      continue;
    }
    args[token] = next;
    index += 1;
  }
  return args;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readFirstLine(filePath) {
  const handle = fs.openSync(filePath, 'r');
  const chunkSize = 4096;
  const buffer = Buffer.alloc(chunkSize);
  let collected = '';
  let position = 0;
  try {
    while (true) {
      const bytesRead = fs.readSync(handle, buffer, 0, chunkSize, position);
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
    fs.closeSync(handle);
  }
}

function walkJsonlFiles(rootDir) {
  const results = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function parseIso(value) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return timestamp;
}

function senderOpenIdFromSessionKey(sessionKey) {
  const marker = ':sender:';
  const index = String(sessionKey || '').indexOf(marker);
  if (index < 0) {
    return '';
  }
  return sessionKey.slice(index + marker.length);
}

function sessionKeyBelongsToChat(sessionKey, chatId) {
  const normalized = String(sessionKey || '');
  if (!normalized || !chatId) {
    return false;
  }
  return normalized === chatId || normalized.startsWith(`${chatId}:sender:`);
}

function summarizeCodexSession(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  let sessionId = '';
  let sessionStartedAt = '';
  let lastUsage = null;
  let requestCount = 0;
  let previousTotalTokens = null;
  let lastTokenTimestamp = '';

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === 'session_meta') {
      sessionId = entry.payload?.id || sessionId;
      sessionStartedAt = entry.payload?.timestamp || entry.timestamp || sessionStartedAt;
      continue;
    }
    if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count') {
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
    lastUsage = usage;
    lastTokenTimestamp = entry.timestamp || lastTokenTimestamp;
  }

  return {
    filePath,
    sessionId,
    sessionStartedAt,
    lastTokenTimestamp,
    requestCount,
    inputTokens: lastUsage?.input_tokens || 0,
    cachedInputTokens: lastUsage?.cached_input_tokens || 0,
    outputTokens: lastUsage?.output_tokens || 0,
    reasoningOutputTokens: lastUsage?.reasoning_output_tokens || 0,
    totalTokens: lastUsage?.total_tokens || 0,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatRow(row) {
  return [
    `sender=${row.senderOpenId || '-'}`,
    `key=${row.sessionKey}`,
    `thread=${row.threadId || '-'}`,
    `status=${row.status}`,
    `matched_by=${row.matchedBy}`,
    `total_tokens=${row.totalTokens}`,
    `requests=${row.requestCount}`,
    `input=${row.inputTokens}`,
    `cached_input=${row.cachedInputTokens}`,
    `output=${row.outputTokens}`,
  ].join(' ');
}

const args = parseArgs(process.argv.slice(2));
const chatId = String(args['--chat-id'] || '').trim();
if (!chatId) {
  fail('Usage: node report_feishu_group_usage.mjs --chat-id <chat_id> [--state-file <path>] [--sessions-root <path>] [--active-window-seconds <n>] [--json]');
}

const stateFile = path.resolve(
  String(args['--state-file'] || path.join(os.homedir(), '.codex-feishu-gateway', 'feishu_gateway_state.json')),
);
const sessionsRoot = path.resolve(
  String(args['--sessions-root'] || path.join(os.homedir(), '.codex', 'sessions')),
);
const activeWindowSeconds = Math.max(30, Number.parseInt(String(args['--active-window-seconds'] || '600'), 10) || 600);

if (!fs.existsSync(stateFile)) {
  fail(`State file not found: ${stateFile}`);
}
if (!fs.existsSync(sessionsRoot)) {
  fail(`Codex sessions directory not found: ${sessionsRoot}`);
}

const state = readJson(stateFile);
const groupChatSessions = Object.entries(state.chatSessions || {})
  .filter(([, value]) => value?.chatId === chatId)
  .map(([sessionKey, value]) => ({
    sessionKey,
    senderOpenId: value?.senderOpenId || senderOpenIdFromSessionKey(sessionKey),
    threadId: value?.threadId || '',
    status: 'completed',
    matchedBy: 'thread_id',
    startedAt: value?.updatedAt || '',
  }));

const groupActiveRuns = Object.entries(state.activeRuns || {})
  .filter(([sessionKey]) => sessionKeyBelongsToChat(sessionKey, chatId))
  .map(([sessionKey, value]) => ({
    sessionKey,
    senderOpenId: senderOpenIdFromSessionKey(sessionKey),
    threadId: value?.threadId || '',
    status: 'running',
    matchedBy: value?.threadId ? 'thread_id' : 'started_at_guess',
    startedAt: value?.startedAt || '',
  }));

if (groupChatSessions.length === 0 && groupActiveRuns.length === 0) {
  fail(`No chatSessions or activeRuns found for chat_id=${chatId}`);
}

const groupRows = new Map();
for (const entry of groupChatSessions) {
  groupRows.set(entry.sessionKey, entry);
}
for (const entry of groupActiveRuns) {
  const existing = groupRows.get(entry.sessionKey);
  if (existing) {
    groupRows.set(entry.sessionKey, {
      ...existing,
      status: 'running',
      startedAt: entry.startedAt || existing.startedAt,
      threadId: existing.threadId || entry.threadId,
      matchedBy: existing.threadId ? 'thread_id' : entry.matchedBy,
    });
    continue;
  }
  groupRows.set(entry.sessionKey, entry);
}

const neededThreadIds = new Set(
  Array.from(groupRows.values())
    .map((entry) => entry.threadId)
    .filter(Boolean),
);

const metadata = [];
for (const filePath of walkJsonlFiles(sessionsRoot)) {
  const firstLine = readFirstLine(filePath);
  if (!firstLine) {
    continue;
  }
  let entry;
  try {
    entry = JSON.parse(firstLine);
  } catch {
    continue;
  }
  if (entry.type !== 'session_meta') {
    continue;
  }
  metadata.push({
    filePath,
    sessionId: entry.payload?.id || '',
    startedAt: entry.payload?.timestamp || entry.timestamp || '',
    startedAtMs: parseIso(entry.payload?.timestamp || entry.timestamp || ''),
  });
}

const exactMatches = new Map();
for (const item of metadata) {
  if (neededThreadIds.has(item.sessionId)) {
    exactMatches.set(item.sessionId, item.filePath);
  }
}

const usedFilePaths = new Set(exactMatches.values());
for (const row of groupRows.values()) {
  if (row.threadId || !row.startedAt) {
    continue;
  }
  const targetMs = parseIso(row.startedAt);
  if (!targetMs) {
    continue;
  }
  let bestMatch = null;
  for (const item of metadata) {
    if (!item.startedAtMs || usedFilePaths.has(item.filePath)) {
      continue;
    }
    const diffMs = Math.abs(item.startedAtMs - targetMs);
    if (diffMs > activeWindowSeconds * 1000) {
      continue;
    }
    if (!bestMatch || diffMs < bestMatch.diffMs) {
      bestMatch = { ...item, diffMs };
    }
  }
  if (!bestMatch) {
    continue;
  }
  row.threadId = bestMatch.sessionId;
  row.matchedBy = 'started_at_guess';
  usedFilePaths.add(bestMatch.filePath);
}

const summaries = new Map();
for (const row of groupRows.values()) {
  if (!row.threadId) {
    continue;
  }
  const filePath = exactMatches.get(row.threadId)
    || metadata.find((item) => item.sessionId === row.threadId)?.filePath
    || '';
  if (!filePath || summaries.has(filePath)) {
    continue;
  }
  summaries.set(filePath, summarizeCodexSession(filePath));
}

const rows = Array.from(groupRows.values())
  .map((row) => {
    const summary = Array.from(summaries.values()).find((item) => item.sessionId === row.threadId);
    return {
      sessionKey: row.sessionKey,
      senderOpenId: row.senderOpenId,
      threadId: row.threadId,
      status: row.status,
      matchedBy: row.matchedBy,
      startedAt: row.startedAt,
      inputTokens: summary?.inputTokens || 0,
      cachedInputTokens: summary?.cachedInputTokens || 0,
      outputTokens: summary?.outputTokens || 0,
      reasoningOutputTokens: summary?.reasoningOutputTokens || 0,
      totalTokens: summary?.totalTokens || 0,
      requestCount: summary?.requestCount || 0,
      lastTokenTimestamp: summary?.lastTokenTimestamp || '',
      sessionFile: summary?.filePath || '',
    };
  })
  .sort((left, right) => right.totalTokens - left.totalTokens || left.sessionKey.localeCompare(right.sessionKey));

const senderTotals = new Map();
for (const row of rows) {
  const key = row.senderOpenId || '(unknown)';
  const existing = senderTotals.get(key) || {
    senderOpenId: key,
    threads: 0,
    totalTokens: 0,
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
  existing.threads += 1;
  existing.totalTokens += row.totalTokens;
  existing.requestCount += row.requestCount;
  existing.inputTokens += row.inputTokens;
  existing.cachedInputTokens += row.cachedInputTokens;
  existing.outputTokens += row.outputTokens;
  senderTotals.set(key, existing);
}

const groupTotals = rows.reduce((accumulator, row) => ({
  threads: accumulator.threads + 1,
  totalTokens: accumulator.totalTokens + row.totalTokens,
  requestCount: accumulator.requestCount + row.requestCount,
  inputTokens: accumulator.inputTokens + row.inputTokens,
  cachedInputTokens: accumulator.cachedInputTokens + row.cachedInputTokens,
  outputTokens: accumulator.outputTokens + row.outputTokens,
}), {
  threads: 0,
  totalTokens: 0,
  requestCount: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
});

if (args['--json']) {
  console.log(JSON.stringify({
    chatId,
    stateFile,
    sessionsRoot,
    activeWindowSeconds,
    groupTotals,
    senderTotals: Array.from(senderTotals.values()),
    rows,
  }, null, 2));
  process.exit(0);
}

const lines = [];
lines.push(`chat_id=${chatId}`);
lines.push(`group_threads=${groupTotals.threads}`);
lines.push(`group_total_tokens=${formatNumber(groupTotals.totalTokens)}`);
lines.push(`group_requests=${formatNumber(groupTotals.requestCount)}`);
lines.push(`group_input_tokens=${formatNumber(groupTotals.inputTokens)}`);
lines.push(`group_cached_input_tokens=${formatNumber(groupTotals.cachedInputTokens)}`);
lines.push(`group_output_tokens=${formatNumber(groupTotals.outputTokens)}`);
lines.push('senders:');
for (const sender of Array.from(senderTotals.values()).sort((left, right) => right.totalTokens - left.totalTokens)) {
  lines.push([
    `sender=${sender.senderOpenId}`,
    `threads=${sender.threads}`,
    `total_tokens=${formatNumber(sender.totalTokens)}`,
    `requests=${formatNumber(sender.requestCount)}`,
    `input=${formatNumber(sender.inputTokens)}`,
    `cached_input=${formatNumber(sender.cachedInputTokens)}`,
    `output=${formatNumber(sender.outputTokens)}`,
  ].join(' '));
}
lines.push('threads:');
for (const row of rows) {
  lines.push(formatRow({
    ...row,
    totalTokens: formatNumber(row.totalTokens),
    requestCount: formatNumber(row.requestCount),
    inputTokens: formatNumber(row.inputTokens),
    cachedInputTokens: formatNumber(row.cachedInputTokens),
    outputTokens: formatNumber(row.outputTokens),
  }));
}

console.log(lines.join('\n'));
