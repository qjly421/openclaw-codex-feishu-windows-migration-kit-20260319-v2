import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTimeSeriesMorningBriefText,
  parseArxivAbstractPageMetadata,
  parseArxivRss,
  scoreTimeSeriesPaper,
  selectTimeSeriesMorningBriefItems,
} from '../timeseries_morning_brief.mjs';

test('parseArxivRss extracts arXiv fields from RSS items', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
      <item>
        <title>MICA: Multivariate Infini Compressive Attention for Time Series Forecasting</title>
        <link>https://arxiv.org/abs/2604.06158v1</link>
        <description>arXiv:2604.06158v1 Announce Type: new Abstract: We study multivariate time series forecasting with long-horizon structure.</description>
        <dc:creator>Jane Doe</dc:creator>
        <pubDate>Thu, 09 Apr 2026 00:00:00 -0400</pubDate>
      </item>
    </channel>
  </rss>`;

  const items = parseArxivRss(xml, 'cs.LG');

  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'cs.LG');
  assert.equal(items[0].title, 'MICA: Multivariate Infini Compressive Attention for Time Series Forecasting');
  assert.equal(items[0].link, 'https://arxiv.org/abs/2604.06158');
  assert.equal(items[0].announceType, 'new');
  assert.match(items[0].abstract, /time series forecasting/i);
});

test('scoreTimeSeriesPaper strongly prefers time-series forecasting papers', () => {
  const good = scoreTimeSeriesPaper({
    title: 'Bi-level Heterogeneous Learning for Time Series Foundation Models',
    abstract: 'We study time series foundation models for forecasting under federated heterogeneity.',
    announceType: 'new',
  });
  const bad = scoreTimeSeriesPaper({
    title: 'Development of ML model for sign language detection system',
    abstract: 'This work uses multivariate signals for sign language recognition.',
    announceType: 'new',
  });

  assert.equal(good.relevant, true);
  assert.ok(good.score >= 10);
  assert.ok(bad.score < good.score);
});

test('parseArxivAbstractPageMetadata extracts journal info and year when present', () => {
  const html = `
    <html>
      <head>
        <meta name="citation_date" content="2026/04/10">
      </head>
      <body>
        <div class="dateline">[Submitted on 9 Apr 2026]</div>
        <table>
          <tr>
            <td class="tablecell comments">Journal reference:</td>
            <td class="tablecell comments mathjax">NeurIPS 2025</td>
          </tr>
          <tr>
            <td class="tablecell comments">DOI:</td>
            <td class="tablecell comments mathjax">10.1234/example</td>
          </tr>
        </table>
      </body>
    </html>`;

  const metadata = parseArxivAbstractPageMetadata(html, {
    publishedAt: '2026-04-10T00:00:00.000Z',
  });

  assert.equal(metadata.venue, 'NeurIPS 2025');
  assert.equal(metadata.year, '2025');
  assert.equal(metadata.doi, '10.1234/example');
});

test('selectTimeSeriesMorningBriefItems deduplicates feeds and keeps strongest items', () => {
  const items = [
    {
      source: 'cs.LG',
      title: 'Amortized Filtering and Smoothing with Conditional Normalizing Flows',
      link: 'https://arxiv.org/abs/2604.05111',
      abstract: 'We study filtering and smoothing for temporal state estimation with normalizing flows.',
      announceType: 'new',
      publishedAt: '2026-04-09T04:00:00.000Z',
    },
    {
      source: 'stat.ML',
      title: 'Amortized Filtering and Smoothing with Conditional Normalizing Flows',
      link: 'https://arxiv.org/abs/2604.05111',
      abstract: 'We study filtering and smoothing for temporal state estimation with normalizing flows.',
      announceType: 'new',
      publishedAt: '2026-04-09T04:00:00.000Z',
    },
    {
      source: 'cs.LG',
      title: 'MICA: Multivariate Infini Compressive Attention for Time Series Forecasting',
      link: 'https://arxiv.org/abs/2604.06158',
      abstract: 'A multivariate time series forecasting model for long-horizon settings.',
      announceType: 'new',
      publishedAt: '2026-04-09T04:00:00.000Z',
    },
    {
      source: 'eess.SP',
      title: 'General-purpose representation learning for wireless receivers',
      link: 'https://arxiv.org/abs/2604.09999',
      abstract: 'A general ML method for communication systems.',
      announceType: 'new',
      publishedAt: '2026-04-09T04:00:00.000Z',
    },
  ];

  const selected = selectTimeSeriesMorningBriefItems(items, {
    maxItems: 3,
    now: '2026-04-09T08:00:00.000Z',
  });

  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map((item) => item.link), [
    'https://arxiv.org/abs/2604.06158',
    'https://arxiv.org/abs/2604.05111',
  ]);
});

test('buildTimeSeriesMorningBriefText renders publication metadata', () => {
  const text = buildTimeSeriesMorningBriefText({
    dateKey: '2026-04-09',
    feeds: [{ category: 'cs.LG' }, { category: 'stat.ML' }],
    errors: [],
    items: [
      {
        title: 'MICA: Multivariate Infini Compressive Attention for Time Series Forecasting',
        note: 'Focuses on multivariate long-horizon forecasting.',
        venue: 'arXiv preprint',
        year: '2026',
        link: 'https://arxiv.org/abs/2604.06158',
        topicLabels: ['multivariate forecasting'],
      },
    ],
  });

  assert.match(text, /2026-04-09/);
  assert.match(text, /cs\.LG \/ stat\.ML/);
  assert.match(text, /arXiv preprint/);
  assert.match(text, /2026/);
  assert.match(text, /multivariate forecasting/);
});
