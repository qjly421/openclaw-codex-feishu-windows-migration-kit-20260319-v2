import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Lark from '@larksuiteoapi/node-sdk';

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowStamp(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => csvEscape(cell)).join(',')).join('\r\n');
}

function createClient(config) {
  return new Lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: config.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
  });
}

async function fetchChatInfo(client, chatId) {
  const response = await client.im.v1.chat.get({
    path: { chat_id: chatId },
  });
  if (response?.code && response.code !== 0) {
    throw new Error(`fetch chat info failed: ${JSON.stringify(response)}`);
  }
  return response?.data || {};
}

async function fetchAllChatMembers(client, chatId) {
  const items = [];
  let pageToken = '';
  while (true) {
    const response = await client.im.v1.chatMembers.get({
      path: { chat_id: chatId },
      params: {
        member_id_type: 'open_id',
        page_size: 100,
        page_token: pageToken || undefined,
      },
    });
    if (response?.code && response.code !== 0) {
      throw new Error(`fetch chat members failed: ${JSON.stringify(response)}`);
    }
    const data = response?.data || {};
    items.push(...(Array.isArray(data.items) ? data.items : []));
    if (!data.has_more || !data.page_token) {
      return {
        items,
        memberTotal: Number(data.member_total || items.length || 0),
      };
    }
    pageToken = data.page_token;
  }
}

const args = parseArgs(process.argv.slice(2));
const chatId = String(args['--chat-id'] || '').trim();
if (!chatId) {
  fail('Usage: node export_feishu_chat_members.mjs --chat-id <chat_id> [--config <path>] [--out <csv-path>]');
}

const configPath = path.resolve(
  String(args['--config'] || path.join(os.homedir(), '.codex-feishu-gateway', 'feishu_gateway.json')),
);
if (!fs.existsSync(configPath)) {
  fail(`Config file not found: ${configPath}`);
}

const config = readJson(configPath);
if (!config.appId || !config.appSecret) {
  fail(`Missing appId/appSecret in config: ${configPath}`);
}

const defaultOutDir = path.join(os.homedir(), '.codex-feishu-gateway', 'outbound');
const outPath = path.resolve(
  String(args['--out'] || path.join(defaultOutDir, `chat-members-${chatId}-${nowStamp()}.csv`)),
);

const client = createClient(config);
const exportedAt = new Date().toISOString();
const chatInfo = await fetchChatInfo(client, chatId).catch(() => ({}));
const chatName = String(chatInfo?.name || '').trim();
const memberData = await fetchAllChatMembers(client, chatId);

const sortedItems = [...memberData.items].sort((left, right) => {
  const leftName = String(left?.name || '').localeCompare(String(right?.name || ''), 'zh-Hans-CN');
  if (leftName !== 0) {
    return leftName;
  }
  return String(left?.member_id || '').localeCompare(String(right?.member_id || ''));
});

const csvRows = [
  ['chat_name', 'chat_id', 'member_name', 'open_id', 'member_id_type', 'tenant_key', 'exported_at'],
  ...sortedItems.map((item) => [
    chatName,
    chatId,
    item?.name || '',
    item?.member_id || '',
    item?.member_id_type || '',
    item?.tenant_key || '',
    exportedAt,
  ]),
];

ensureDir(path.dirname(outPath));
fs.writeFileSync(outPath, `\uFEFF${toCsv(csvRows)}\r\n`, 'utf8');

const result = {
  ok: true,
  chatId,
  chatName,
  memberCount: sortedItems.length,
  memberTotal: memberData.memberTotal,
  output: outPath,
  exportedAt,
};

console.log(JSON.stringify(result, null, 2));
