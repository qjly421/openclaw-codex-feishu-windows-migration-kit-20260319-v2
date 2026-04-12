#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_TIME_SERIES_MORNING_BRIEF_FEEDS = [
  { category: 'cs.LG', url: 'https://rss.arxiv.org/rss/cs.LG' },
  { category: 'stat.ML', url: 'https://rss.arxiv.org/rss/stat.ML' },
  { category: 'eess.SP', url: 'https://rss.arxiv.org/rss/eess.SP' },
];

const DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE = 'Asia/Shanghai';
const DEFAULT_TIME_SERIES_MORNING_BRIEF_MAX_ITEMS = 4;
const DEFAULT_TIME_SERIES_MORNING_BRIEF_MAX_AGE_DAYS = 7;
const DEFAULT_TIME_SERIES_MORNING_BRIEF_PRIMARY_MIN_SCORE = 8;
const DEFAULT_TIME_SERIES_MORNING_BRIEF_SECONDARY_MIN_SCORE = 6;
const DEFAULT_TIME_SERIES_MORNING_BRIEF_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT = 'codex-feishu/1.0 (+time-series morning brief)';
const DEFAULT_CODE_INDEX_API_TIMEOUT_MS = 5_000;

const CODE_REPOSITORY_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'gitee.com',
  'bitbucket.org',
  'codeberg.org',
  'git.sr.ht',
]);

const CORE_TIME_SERIES_PATTERNS = [
  /time series/i,
  /temporal/i,
  /multivariate/i,
  /long[- ]horizon/i,
  /sequence model/i,
  /state space/i,
  /state-space/i,
];

const FORECASTING_PATTERNS = [
  /forecast/i,
  /forecasting/i,
  /predictive forecasting/i,
  /time[- ]ahead/i,
  /nowcast/i,
];

const STATE_ESTIMATION_PATTERNS = [
  /filtering/i,
  /smoothing/i,
  /kalman/i,
  /hidden markov/i,
  /latent dynamics/i,
];

const FOUNDATION_PATTERNS = [
  /foundation model/i,
  /time series foundation/i,
  /\btsfm\b/i,
  /pretrain/i,
  /federated/i,
];

const APPLICATION_PATTERNS = [
  /price/i,
  /commodity/i,
  /demand/i,
  /load/i,
  /energy/i,
  /weather/i,
  /temperature/i,
  /traffic/i,
  /mobility/i,
  /sales/i,
  /financial/i,
  /market/i,
  /reactor/i,
];

const QUALITY_PATTERNS = [
  /benchmark/i,
  /dataset/i,
  /probabilistic/i,
  /uncertainty/i,
  /normalizing flow/i,
  /transformer/i,
  /attention/i,
  /graph neural/i,
  /digital twin/i,
];

const NEGATIVE_PATTERNS = [
  /sign language/i,
  /vision-language/i,
  /large language model/i,
  /\bllm\b/i,
  /text-to-image/i,
  /image generation/i,
  /speech recognition/i,
];

const TOPIC_RULES = [
  { label: '时序基础模型', patterns: FOUNDATION_PATTERNS },
  { label: '概率滤波/平滑', patterns: STATE_ESTIMATION_PATTERNS },
  { label: '多变量长序列预测', patterns: [/multivariate/i, /long[- ]horizon/i, /attention/i, /transformer/i] },
  { label: '天气/环境预测', patterns: [/weather/i, /temperature/i, /surface temperature/i] },
  { label: '价格/需求预测', patterns: [/price/i, /commodity/i, /demand/i, /load/i, /market/i, /sales/i] },
  { label: '工业控制预测', patterns: [/reactor/i, /digital twin/i, /control-oriented/i] },
  { label: '数据生成/模拟', patterns: [/synthetic/i, /generation/i, /simulat/i] },
  { label: '基准/数据集', patterns: [/benchmark/i, /dataset/i] },
];

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&apos;/g, '\'');
}

function stripHtml(value) {
  return decodeXmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block, tagName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)</${escapedTag}>`, 'i'));
  return stripHtml(match?.[1] || '');
}

function extractMetaContent(html, name) {
  const escapedName = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html || '').match(new RegExp(`<meta\\s+name="${escapedName}"\\s+content="([^"]*)"`, 'i'));
  return stripHtml(match?.[1] || '');
}

function extractYear(value) {
  const matches = String(value || '').match(/(?:19|20)\d{2}/g);
  if (!matches || matches.length === 0) {
    return '';
  }
  return matches[matches.length - 1];
}

function extractDescriptorTableFields(html) {
  const cells = Array.from(String(html || '').matchAll(/<td class="tablecell[^"]*">([\s\S]*?)<\/td>/gi))
    .map((match) => stripHtml(match[1]))
    .filter((cell) => cell && cell !== '\u00a0');
  const fields = {};
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (!/:\s*$/.test(cell)) {
      continue;
    }
    const key = cell.replace(/:\s*$/, '').trim().toLowerCase();
    const values = [];
    let cursor = index + 1;
    while (cursor < cells.length && !/:\s*$/.test(cells[cursor])) {
      values.push(cells[cursor]);
      cursor += 1;
    }
    fields[key] = values.join(' ').replace(/\s+/g, ' ').trim();
    index = cursor - 1;
  }
  return fields;
}

function parseArxivAbstractPageMetadata(html, item = {}) {
  const fields = extractDescriptorTableFields(html);
  const submittedText = stripHtml(String(html || '').match(/<div class="dateline">\s*\[([\s\S]*?)\]<\/div>/i)?.[1] || '');
  const citationDate = extractMetaContent(html, 'citation_date');
  const citationOnlineDate = extractMetaContent(html, 'citation_online_date');
  const journalReference = fields['journal reference'] || '';
  const year = extractYear(journalReference)
    || extractYear(citationDate)
    || extractYear(submittedText)
    || extractYear(item.publishedAt)
    || '';
  const venue = journalReference || 'arXiv 预印本';
  return {
    submittedText,
    citationDate,
    citationOnlineDate,
    journalReference,
    venue,
    year,
    doi: fields.doi || '',
  };
}

function normalizeArxivLink(link, fallbackDescription = '') {
  const normalized = String(link || '').trim();
  if (/https?:\/\/arxiv\.org\/abs\//i.test(normalized)) {
    return normalized.replace(/v\d+$/i, '');
  }
  const match = `${normalized} ${fallbackDescription}`.match(/arXiv:(\d{4}\.\d{4,5})(?:v\d+)?/i);
  if (match?.[1]) {
    return `https://arxiv.org/abs/${match[1]}`;
  }
  return normalized;
}

function extractArxivId(value) {
  return String(value || '').match(/(?:arXiv:|arxiv\.org\/abs\/)(\d{4}\.\d{4,5})(?:v\d+)?/i)?.[1] || '';
}

function buildTimeSeriesMorningBriefItemKey(item = {}) {
  const arxivId = extractArxivId(item.arxivId || item.link || item.title);
  if (arxivId) {
    return `arxiv:${arxivId}`;
  }
  const normalizedLink = normalizeArxivLink(item.link || '');
  if (normalizedLink) {
    return `link:${normalizedLink}`;
  }
  const title = String(item.title || '').trim().toLowerCase();
  if (title) {
    return `title:${title}`;
  }
  return '';
}

function normalizeUrl(value, baseUrl = 'https://arxiv.org') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const normalized = new URL(raw, baseUrl);
    if (!/^https?:$/i.test(normalized.protocol)) {
      return '';
    }
    return normalized.toString();
  } catch {
    return '';
  }
}

function extractAnchorLinks(html, baseUrl = 'https://arxiv.org') {
  const links = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = normalizeUrl(match[1] || match[2] || match[3] || '', baseUrl);
    if (!url) {
      continue;
    }
    links.push({
      url,
      text: stripHtml(match[4] || ''),
    });
  }
  return links;
}

function isLikelyCodeRepositoryUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!CODE_REPOSITORY_HOSTS.has(host)) {
      return false;
    }
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (host === 'git.sr.ht') {
      return pathParts.length >= 2 && /^~/.test(pathParts[0] || '');
    }
    return pathParts.length >= 2;
  } catch {
    return false;
  }
}

function extractPaperCodeInfoFromHtml(html, baseUrl = 'https://arxiv.org') {
  const repositoryUrls = Array.from(new Set(
    extractAnchorLinks(html, baseUrl)
      .map((link) => link.url)
      .filter((url) => isLikelyCodeRepositoryUrl(url)),
  ));
  if (repositoryUrls.length === 0) {
    return null;
  }
  return {
    hasCode: true,
    source: 'paper-page',
    primaryUrl: repositoryUrls[0],
    repositoryUrls,
  };
}

function parseArxivDescription(description) {
  const cleanDescription = stripHtml(description);
  const announceType = cleanDescription.match(/Announce Type:\s*([^\n]+?)(?:\s+Abstract:|$)/i)?.[1]?.trim() || '';
  const arxivId = cleanDescription.match(/arXiv:(\d{4}\.\d{4,5})(?:v\d+)?/i)?.[1] || '';
  const abstract = cleanDescription.match(/Abstract:\s*([\s\S]*)$/i)?.[1]?.trim() || cleanDescription;
  return {
    announceType,
    arxivId,
    abstract,
  };
}

function parseRssDate(value) {
  const parsedMs = Date.parse(String(value || '').trim());
  if (!Number.isFinite(parsedMs)) {
    return '';
  }
  return new Date(parsedMs).toISOString();
}

function fetchTimeoutMs(options = {}) {
  return Number(options.fetchTimeoutMs) || DEFAULT_TIME_SERIES_MORNING_BRIEF_FETCH_TIMEOUT_MS;
}

async function fetchText(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node runtime.');
  }

  const controller = new AbortController();
  const timeoutMs = fetchTimeoutMs(options);
  const timeout = setTimeout(() => controller.abort(new Error(`fetch timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        'Accept': 'text/html, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node runtime.');
  }

  const controller = new AbortController();
  const timeoutMs = Number(options.apiTimeoutMs) || DEFAULT_CODE_INDEX_API_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(new Error(`fetch timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8',
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCatalyzeXCodeInfo(arxivId, options = {}) {
  const normalizedArxivId = String(arxivId || '').trim();
  if (!normalizedArxivId) {
    return null;
  }
  try {
    const payload = await fetchJson(
      `https://www.catalyzex.com/api/code?src=arxiv&paper_arxiv_id=${encodeURIComponent(normalizedArxivId)}`,
      options,
    );
    const primaryUrl = normalizeUrl(payload?.code_url || '');
    const overviewUrl = normalizeUrl(payload?.cx_url || '');
    if (!primaryUrl && !overviewUrl) {
      return null;
    }
    const repositoryUrls = Array.from(new Set([primaryUrl].filter(Boolean)));
    return {
      hasCode: true,
      source: 'catalyzex',
      primaryUrl: primaryUrl || overviewUrl,
      repositoryUrls,
      overviewUrl,
      implementationCount: Math.max(0, Number(payload?.count) || 0),
    };
  } catch {
    return null;
  }
}

function mergeCodeInfo(primary, secondary) {
  if (!primary && !secondary) {
    return {
      hasCode: false,
      source: 'none',
      primaryUrl: '',
      repositoryUrls: [],
      overviewUrl: '',
      implementationCount: 0,
    };
  }
  const merged = {
    ...(secondary || {}),
    ...(primary || {}),
  };
  merged.repositoryUrls = Array.from(new Set([
    ...((primary?.repositoryUrls) || []),
    ...((secondary?.repositoryUrls) || []),
  ].filter(Boolean)));
  merged.hasCode = merged.repositoryUrls.length > 0 || Boolean(merged.primaryUrl);
  merged.primaryUrl = merged.primaryUrl || merged.repositoryUrls[0] || '';
  merged.overviewUrl = merged.overviewUrl || '';
  merged.implementationCount = Math.max(
    Number(primary?.implementationCount) || 0,
    Number(secondary?.implementationCount) || 0,
  );
  return merged;
}

function testAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function collectTopicLabels(text) {
  const labels = [];
  for (const rule of TOPIC_RULES) {
    if (testAny(text, rule.patterns)) {
      labels.push(rule.label);
    }
  }
  return labels;
}

function pickNote(text) {
  if (/weather|temperature|surface temperature/i.test(text)) {
    return '偏天气预测，强调和数值预报或环境变量结合。';
  }
  if (/price|commodity|market/i.test(text)) {
    return '偏价格预测，带真实市场场景，适合业务侧参考。';
  }
  if (/demand|load|energy|sales/i.test(text)) {
    return '偏需求或负荷预测，贴近真实时序业务。';
  }
  if (/reactor|digital twin|control-oriented/i.test(text)) {
    return '偏工业过程预测，适合控制和数字孪生场景。';
  }
  if (testAny(text, STATE_ESTIMATION_PATTERNS)) {
    return '偏概率滤波/平滑，适合在线状态估计与不确定性建模。';
  }
  if (testAny(text, FOUNDATION_PATTERNS)) {
    return '偏时序基础模型，关注跨端或异构训练落地。';
  }
  if (/synthetic|generation/i.test(text)) {
    return '偏金融时序生成/模拟，适合数据增强或压力测试。';
  }
  if (/multivariate|long[- ]horizon|attention|transformer/i.test(text)) {
    return '偏多变量长序列建模，像是结构或注意力改造。';
  }
  if (/benchmark|dataset/i.test(text)) {
    return '带基准或数据集，适合快速复现实验。';
  }
  return '与时序预测直接相关，值得过一下摘要。';
}

function scoreTimeSeriesPaper(item) {
  const text = `${item.title || ''}\n${item.abstract || ''}`.toLowerCase();
  const title = String(item.title || '').toLowerCase();

  let score = 0;
  const reasons = [];

  const coreHit = testAny(text, CORE_TIME_SERIES_PATTERNS);
  const forecastingHit = testAny(text, FORECASTING_PATTERNS);
  const stateEstimationHit = testAny(text, STATE_ESTIMATION_PATTERNS);
  const foundationHit = testAny(text, FOUNDATION_PATTERNS);
  const applicationHit = testAny(text, APPLICATION_PATTERNS);
  const qualityHit = testAny(text, QUALITY_PATTERNS);
  const negativeHit = testAny(text, NEGATIVE_PATTERNS);
  const predictiveHit = /predict/i.test(text);
  const generativeOnlyHit = /synthetic|generation/i.test(text) && !forecastingHit && !stateEstimationHit;
  const classificationOnlyHit = /classification/i.test(text) && !forecastingHit && !stateEstimationHit;

  if (coreHit) {
    score += 6;
    reasons.push('core');
  }
  if (forecastingHit) {
    score += 4;
    reasons.push('forecasting');
  }
  if (stateEstimationHit) {
    score += 4;
    reasons.push('state-estimation');
  }
  if (foundationHit) {
    score += 3;
    reasons.push('foundation');
  }
  if (applicationHit) {
    score += 2;
    reasons.push('application');
  }
  if (qualityHit) {
    score += 1;
    reasons.push('quality');
  }
  if (forecastingHit && applicationHit) {
    score += 2;
    reasons.push('forecast-application');
  }
  if (forecastingHit && /benchmark|dataset/i.test(text)) {
    score += 2;
    reasons.push('forecast-benchmark');
  }
  if (testAny(title, CORE_TIME_SERIES_PATTERNS) || testAny(title, FORECASTING_PATTERNS)) {
    score += 2;
    reasons.push('title');
  }
  if (String(item.announceType || '').toLowerCase() === 'new') {
    score += 2;
    reasons.push('new');
  }
  if (negativeHit) {
    score -= 5;
    reasons.push('negative');
  }
  if (generativeOnlyHit) {
    score -= 4;
    reasons.push('generative-only');
  }
  if (classificationOnlyHit) {
    score -= 4;
    reasons.push('classification-only');
  }

  const relevant = !negativeHit && (
    (forecastingHit || stateEstimationHit || foundationHit || predictiveHit)
    && !generativeOnlyHit
    && !classificationOnlyHit
    && (
      coreHit
      || applicationHit
      || foundationHit
      || stateEstimationHit
    )
  ) && (
    forecastingHit
    || stateEstimationHit
    || (coreHit && foundationHit)
    || (coreHit && applicationHit && predictiveHit)
  );
  return { score, reasons, relevant };
}

function compareItems(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  const timeA = Date.parse(a.publishedAt || '') || 0;
  const timeB = Date.parse(b.publishedAt || '') || 0;
  if (timeB !== timeA) {
    return timeB - timeA;
  }
  return String(a.title || '').localeCompare(String(b.title || ''));
}

function enrichPaper(item) {
  const text = `${item.title || ''}\n${item.abstract || ''}`;
  const scoring = scoreTimeSeriesPaper(item);
  return {
    ...item,
    itemKey: buildTimeSeriesMorningBriefItemKey(item),
    ...scoring,
    note: pickNote(text),
    topicLabels: collectTopicLabels(text),
  };
}

async function enrichPaperPublicationMetadata(item, options = {}) {
  const fallbackYear = extractYear(item.publishedAt) || '';
  const normalizedArxivId = item.arxivId || extractArxivId(item.link);
  const catalyzeXCodeInfoPromise = fetchCatalyzeXCodeInfo(normalizedArxivId, options);
  let html = '';

  try {
    html = await fetchText(item.link, options);
  } catch {
    html = '';
  }

  const metadata = html
    ? parseArxivAbstractPageMetadata(html, item)
    : {
        venue: 'arXiv 预印本',
        journalReference: '',
        citationDate: '',
        citationOnlineDate: '',
        submittedText: '',
        doi: '',
        year: fallbackYear,
      };

  const codeInfo = mergeCodeInfo(
    await catalyzeXCodeInfoPromise,
    extractPaperCodeInfoFromHtml(html, item.link),
  );

  return {
    ...item,
    arxivId: normalizedArxivId,
    ...metadata,
    venue: metadata.venue || 'arXiv 预印本',
    year: metadata.year || fallbackYear,
    codeInfo,
  };
}

function dateKeyInTimeZone(date = new Date(), timeZone = DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parseArxivRss(xml, source = '') {
  const items = [];
  for (const match of String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const rawDescription = extractTag(block, 'description');
    const parsedDescription = parseArxivDescription(rawDescription);
    items.push({
      source,
      title: extractTag(block, 'title'),
      link: normalizeArxivLink(extractTag(block, 'link'), rawDescription),
      authors: extractTag(block, 'dc:creator'),
      publishedAt: parseRssDate(extractTag(block, 'pubDate')),
      announceType: parsedDescription.announceType,
      arxivId: parsedDescription.arxivId,
      abstract: parsedDescription.abstract,
    });
  }
  return items.filter((item) => item.title && item.link);
}

function selectTimeSeriesMorningBriefItems(items, options = {}) {
  const nowMs = new Date(options.now || Date.now()).getTime();
  const maxAgeDays = Number(options.maxAgeDays) || DEFAULT_TIME_SERIES_MORNING_BRIEF_MAX_AGE_DAYS;
  const primaryMinScore = Number(options.primaryMinScore) || DEFAULT_TIME_SERIES_MORNING_BRIEF_PRIMARY_MIN_SCORE;
  const secondaryMinScore = Number(options.secondaryMinScore) || DEFAULT_TIME_SERIES_MORNING_BRIEF_SECONDARY_MIN_SCORE;
  const maxItems = Math.max(1, Number(options.maxItems) || DEFAULT_TIME_SERIES_MORNING_BRIEF_MAX_ITEMS);
  const excludedItemKeys = new Set(
    (Array.isArray(options.excludeItemKeys) ? options.excludeItemKeys : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );

  const deduped = new Map();
  for (const item of items.map(enrichPaper)) {
    if (!item.relevant) {
      continue;
    }
    if (item.itemKey && excludedItemKeys.has(item.itemKey)) {
      continue;
    }
    const publishedMs = Date.parse(item.publishedAt || '') || 0;
    if (publishedMs > 0 && nowMs - publishedMs > (maxAgeDays * DAY_MS)) {
      continue;
    }
    const dedupeKey = item.itemKey || item.link || item.arxivId || item.title;
    const existing = deduped.get(dedupeKey);
    if (!existing || compareItems(item, existing) < 0) {
      deduped.set(dedupeKey, item);
    }
  }

  const ranked = Array.from(deduped.values()).sort(compareItems);
  const selected = ranked.filter((item) => item.score >= primaryMinScore).slice(0, maxItems);
  if (selected.length >= Math.min(2, maxItems)) {
    return selected;
  }

  const backup = ranked.filter((item) => item.score >= secondaryMinScore && !selected.some((picked) => picked.link === item.link));
  return [...selected, ...backup].slice(0, maxItems);
}

function buildOverallObservation(items) {
  const counts = new Map();
  for (const item of items) {
    for (const label of item.topicLabels || []) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const labels = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([label]) => label);
  if (labels.length === 0) {
    return '';
  }
  return `今天更偏向${labels.join('、')}。`;
}

function formatCodeAvailabilityText(codeInfo) {
  if (!codeInfo?.hasCode) {
    return '代码: 暂未查到开源仓库';
  }
  if (codeInfo.source === 'catalyzex' && Number(codeInfo.implementationCount) > 1) {
    return `代码: 已发现开源实现（CatalyzeX，${codeInfo.implementationCount} 个实现）`;
  }
  if (codeInfo.source === 'catalyzex') {
    return '代码: 已发现开源实现（CatalyzeX）';
  }
  if (codeInfo.source === 'paper-page') {
    return '代码: 论文页已挂出仓库链接';
  }
  return '代码: 已发现开源实现';
}

function buildTimeSeriesMorningBriefText({ dateKey, items, feeds, errors = [], maxAgeDays, hasExcludedItems = false }) {
  const feedLabels = (feeds || []).map((feed) => feed.category).filter(Boolean);
  const lines = [`时序预测科研早报 | ${dateKey}`];

  if (feedLabels.length > 0) {
    lines.push(`来源: ${feedLabels.join(' / ')}`);
  }

  if (items.length === 0) {
    const lookbackDays = Math.max(1, Number(maxAgeDays) || DEFAULT_TIME_SERIES_MORNING_BRIEF_MAX_AGE_DAYS);
    if (hasExcludedItems) {
      lines.push(`近 ${lookbackDays} 天里没有筛到这个群尚未发送的高置信度时序预测论文。`);
    } else if (lookbackDays > 1) {
      lines.push(`近 ${lookbackDays} 天里没有筛到高置信度的时序预测论文。`);
    } else {
      lines.push('今天 arXiv 新增里没有筛到高置信度的时序预测论文。');
    }
  } else {
    items.forEach((item, index) => {
      lines.push('');
      lines.push(`${index + 1}. ${item.title}`);
      lines.push(`关注点: ${item.note}`);
      lines.push(`期刊/会议: ${item.venue || 'arXiv 预印本'} | 年份: ${item.year || '未知'}`);
      lines.push(formatCodeAvailabilityText(item.codeInfo));
      if (item.codeInfo?.primaryUrl) {
        lines.push(item.codeInfo.primaryUrl);
      }
      lines.push(item.link);
    });
    const observation = buildOverallObservation(items);
    if (observation) {
      lines.push('');
      lines.push(`观察: ${observation}`);
    }
  }

  if (errors.length > 0) {
    lines.push('');
    lines.push(`注: 部分分区抓取失败: ${errors.map((item) => item.category).join(', ')}`);
  }

  return lines.join('\n').trim();
}

async function fetchFeedXml(feed, options = {}) {
  return fetchText(feed.url, options);
}

async function buildTimeSeriesMorningBrief(options = {}) {
  const feeds = Array.isArray(options.feeds) && options.feeds.length > 0
    ? options.feeds
    : DEFAULT_TIME_SERIES_MORNING_BRIEF_FEEDS;

  const fetchResults = await Promise.allSettled(feeds.map(async (feed) => ({
    ...feed,
    xml: await fetchFeedXml(feed, options),
  })));

  const parsedFeeds = [];
  const errors = [];
  for (const [index, result] of fetchResults.entries()) {
    if (result.status === 'fulfilled') {
      parsedFeeds.push(result.value);
      continue;
    }
    const failedFeed = feeds[index] || {};
    errors.push({
      category: failedFeed.category || '(unknown)',
      url: failedFeed.url || '',
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }

  const parsedItems = parsedFeeds.flatMap((feed) => parseArxivRss(feed.xml, feed.category));
  const rankedItems = selectTimeSeriesMorningBriefItems(parsedItems, options);
  const items = await Promise.all(rankedItems.map((item) => enrichPaperPublicationMetadata(item, options)));
  const dateKey = dateKeyInTimeZone(options.now ? new Date(options.now) : new Date(), options.timeZone || DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE);
  const text = buildTimeSeriesMorningBriefText({
    dateKey,
    items,
    feeds,
    errors,
    maxAgeDays: options.maxAgeDays,
    hasExcludedItems: Array.isArray(options.excludeItemKeys) && options.excludeItemKeys.length > 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    dateKey,
    items,
    feeds,
    errors,
    text,
  };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
      continue;
    }
    options[key] = true;
  }
  return options;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await buildTimeSeriesMorningBrief({
    maxItems: options['max-items'],
    maxAgeDays: options['max-age-days'],
    timeZone: options['time-zone'],
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.text);
}

export {
  DEFAULT_TIME_SERIES_MORNING_BRIEF_FEEDS,
  DEFAULT_TIME_SERIES_MORNING_BRIEF_TIME_ZONE,
  buildTimeSeriesMorningBrief,
  buildTimeSeriesMorningBriefText,
  dateKeyInTimeZone,
  parseArxivDescription,
  parseArxivAbstractPageMetadata,
  parseArxivRss,
  scoreTimeSeriesPaper,
  selectTimeSeriesMorningBriefItems,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
