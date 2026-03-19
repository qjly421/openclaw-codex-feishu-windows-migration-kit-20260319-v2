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

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function zeroTotals() {
  return {
    turns: 0,
    totalTokens: 0,
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
}

function addDelta(target, delta) {
  target.turns += 1;
  target.totalTokens += Number(delta?.totalTokens || 0);
  target.requestCount += Number(delta?.requestCount || 0);
  target.inputTokens += Number(delta?.inputTokens || 0);
  target.cachedInputTokens += Number(delta?.cachedInputTokens || 0);
  target.outputTokens += Number(delta?.outputTokens || 0);
}

const args = parseArgs(process.argv.slice(2));
const ledgerFile = path.resolve(String(args['--ledger-file'] || path.join(os.homedir(), '.codex-feishu-gateway', 'feishu_usage_ledger.jsonl')));
const chatIdFilter = String(args['--chat-id'] || '').trim();

if (!fs.existsSync(ledgerFile)) {
  console.error(`Ledger file not found: ${ledgerFile}`);
  process.exit(1);
}

const groupTotals = new Map();
const senderTotals = new Map();
const pairTotals = new Map();
let overall = zeroTotals();

const lines = fs.readFileSync(ledgerFile, 'utf8').split(/\r?\n/).filter(Boolean);
for (const line of lines) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  const chatId = String(entry.chatId || '').trim();
  const senderOpenId = String(entry.senderOpenId || '').trim();
  if (chatIdFilter && chatId !== chatIdFilter) {
    continue;
  }
  const delta = entry.deltaUsage || {};

  overall = { ...overall };
  addDelta(overall, delta);

  const groupKey = chatId || '(unknown)';
  if (!groupTotals.has(groupKey)) {
    groupTotals.set(groupKey, { chatId: groupKey, ...zeroTotals() });
  }
  addDelta(groupTotals.get(groupKey), delta);

  const senderKey = senderOpenId || '(unknown)';
  if (!senderTotals.has(senderKey)) {
    senderTotals.set(senderKey, { senderOpenId: senderKey, ...zeroTotals() });
  }
  addDelta(senderTotals.get(senderKey), delta);

  const pairKey = `${groupKey}__${senderKey}`;
  if (!pairTotals.has(pairKey)) {
    pairTotals.set(pairKey, { chatId: groupKey, senderOpenId: senderKey, ...zeroTotals() });
  }
  addDelta(pairTotals.get(pairKey), delta);
}

const output = [];
output.push(`ledger_file=${ledgerFile}`);
if (chatIdFilter) {
  output.push(`chat_id=${chatIdFilter}`);
}
output.push(`total_turns=${formatNumber(overall.turns)}`);
output.push(`total_tokens=${formatNumber(overall.totalTokens)}`);
output.push(`total_requests=${formatNumber(overall.requestCount)}`);
output.push(`groups=${groupTotals.size}`);
output.push(`senders=${senderTotals.size}`);
output.push('group_totals:');
for (const item of Array.from(groupTotals.values()).sort((left, right) => right.totalTokens - left.totalTokens)) {
  output.push(`chat_id=${item.chatId} turns=${formatNumber(item.turns)} total_tokens=${formatNumber(item.totalTokens)} requests=${formatNumber(item.requestCount)} input=${formatNumber(item.inputTokens)} cached_input=${formatNumber(item.cachedInputTokens)} output=${formatNumber(item.outputTokens)}`);
}
output.push('sender_totals:');
for (const item of Array.from(senderTotals.values()).sort((left, right) => right.totalTokens - left.totalTokens)) {
  output.push(`sender=${item.senderOpenId} turns=${formatNumber(item.turns)} total_tokens=${formatNumber(item.totalTokens)} requests=${formatNumber(item.requestCount)} input=${formatNumber(item.inputTokens)} cached_input=${formatNumber(item.cachedInputTokens)} output=${formatNumber(item.outputTokens)}`);
}
output.push('group_sender_totals:');
for (const item of Array.from(pairTotals.values()).sort((left, right) => right.totalTokens - left.totalTokens)) {
  output.push(`chat_id=${item.chatId} sender=${item.senderOpenId} turns=${formatNumber(item.turns)} total_tokens=${formatNumber(item.totalTokens)} requests=${formatNumber(item.requestCount)} input=${formatNumber(item.inputTokens)} cached_input=${formatNumber(item.cachedInputTokens)} output=${formatNumber(item.outputTokens)}`);
}

console.log(output.join('\n'));
