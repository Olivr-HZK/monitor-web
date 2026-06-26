const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../scripts/single_game_profile_core.js');

test('slugifyName creates stable ascii-ish slugs for game names', () => {
  assert.equal(core.slugifyName('Block Blast!'), 'block-blast');
  assert.equal(core.slugifyName('  Brain Games - Brainy Boxy  '), 'brain-games-brainy-boxy');
});

test('selectBestCandidate prefers exact game name with stronger reviews and game category', () => {
  const candidates = [
    { os: 'ios', appId: '111', name: 'Block Puzzle', publisher: 'Other', categories: ['Games'], ratingCount: 200000 },
    { os: 'ios', appId: '1617391485', name: 'Block Blast!', publisher: 'Hungry Studio', categories: ['Games', 'Puzzle'], ratingCount: 6151864 },
    { os: 'ios', appId: '222', name: 'Blast Block Adventure', publisher: 'Tiny', categories: ['Entertainment'], ratingCount: 9999999 },
  ];

  const best = core.selectBestCandidate('Block Blast', candidates);

  assert.equal(best.appId, '1617391485');
  assert.ok(best.score > 0.8);
  assert.equal(best.confidence, 'high');
});

test('buildIdentityFromCandidates merges ios and android candidates with confidence notes', () => {
  const identity = core.buildIdentityFromCandidates('Block Blast', {
    ios: [
      { os: 'ios', appId: '1617391485', name: 'Block Blast!', publisher: 'Hungry Studio', categories: ['Games'], ratingCount: 6151864 },
    ],
    android: [
      { os: 'android', appId: 'com.block.juggle', name: 'Block Blast!', publisher: 'HungryStudio', categories: ['Puzzle'], ratingCount: 4740191 },
    ],
  });

  assert.equal(identity.query, 'Block Blast');
  assert.equal(identity.canonicalName, 'Block Blast!');
  assert.deepEqual(identity.iosAppIds, ['1617391485']);
  assert.deepEqual(identity.androidAppIds, ['com.block.juggle']);
  assert.equal(identity.publisher, 'Hungry Studio');
  assert.equal(identity.confidence, 'high');
  assert.equal(identity.platforms.ios.source, 'candidate_search');
});

test('parseAppleSearchResults converts iTunes search JSON to scored candidates', () => {
  const candidates = core.parseAppleSearchResults({
    results: [
      {
        trackId: 1617391485,
        trackName: 'Block Blast!',
        sellerName: 'Hungry Studio',
        genres: ['Games', 'Puzzle'],
        userRatingCount: 6151864,
      },
    ],
  });

  assert.deepEqual(candidates, [
    {
      os: 'ios',
      appId: '1617391485',
      name: 'Block Blast!',
      publisher: 'Hungry Studio',
      categories: ['Games', 'Puzzle'],
      ratingCount: 6151864,
      source: 'apple_search',
    },
  ]);
});

test('parseGooglePlaySearchResults extracts package ids and names from search html', () => {
  const html = `
    <a href="/store/apps/details?id=com.block.juggle" aria-label="Block Blast!"></a>
    <div>HungryStudio</div>
    <a href="/store/apps/details?id=com.other.game"><span>Other Game</span></a>
  `;

  const candidates = core.parseGooglePlaySearchResults(html);

  assert.deepEqual(candidates.slice(0, 2), [
    {
      os: 'android',
      appId: 'com.block.juggle',
      name: 'Block Blast!',
      publisher: '',
      categories: ['Games'],
      ratingCount: 0,
      source: 'google_play_search',
    },
    {
      os: 'android',
      appId: 'com.other.game',
      name: 'Other Game',
      publisher: '',
      categories: ['Games'],
      ratingCount: 0,
      source: 'google_play_search',
    },
  ]);
});

test('parseLocalDbRows converts cached sqlite rows to resolver candidates', () => {
  const rows = [
    { app_id: '1617391485', os: 'ios', name: 'Block Blast!', publisher_name: 'Hungry Studio', categories: '["Games","Puzzle"]' },
    { app_id: 'com.block.juggle', os: 'android', app_name: 'Block Blast!', publisher_name: 'HungryStudio', categories: 'Puzzle' },
  ];

  const candidates = core.parseLocalDbRows(rows);

  assert.deepEqual(candidates, {
    ios: [
      {
        os: 'ios',
        appId: '1617391485',
        name: 'Block Blast!',
        publisher: 'Hungry Studio',
        categories: ['Games', 'Puzzle'],
        ratingCount: 0,
        source: 'local_db',
      },
    ],
    android: [
      {
        os: 'android',
        appId: 'com.block.juggle',
        name: 'Block Blast!',
        publisher: 'HungryStudio',
        categories: ['Puzzle'],
        ratingCount: 0,
        source: 'local_db',
      },
    ],
  });
});

test('mergeCandidateSources combines same app id and prefers local metadata publisher', () => {
  const candidates = core.mergeCandidateSources([
    {
      os: 'ios',
      appId: '1617391485',
      name: 'Block Blast!',
      publisher: 'ARETIS LIMITED',
      categories: [],
      ratingCount: 6151864,
      source: 'apple_search',
    },
    {
      os: 'ios',
      appId: '1617391485',
      name: 'Block Blast！',
      publisher: 'Hungry Studio',
      categories: ['6014', '7012'],
      ratingCount: 0,
      source: 'local_db',
    },
  ]);

  assert.deepEqual(candidates, [
    {
      os: 'ios',
      appId: '1617391485',
      name: 'Block Blast!',
      publisher: 'Hungry Studio',
      categories: ['6014', '7012'],
      ratingCount: 6151864,
      source: 'local_db+apple_search',
    },
  ]);
});

test('filterLocalRowsByQuery matches names with non-breaking spaces and punctuation', () => {
  const rows = [
    { app_id: '1617391485', os: 'ios', name: 'Block Blast！', publisher_name: 'Hungry Studio' },
    { app_id: '6478063606', os: 'ios', name: 'Color Block: Combo Blast', publisher_name: 'Other' },
  ];

  const filtered = core.filterLocalRowsByQuery('Block Blast', rows);

  assert.deepEqual(filtered, [rows[0]]);
});

test('localSearchTokens strips punctuation into SQL-friendly query terms', () => {
  assert.deepEqual(core.localSearchTokens('Block Blast!'), ['Block', 'Blast']);
  assert.deepEqual(core.localSearchTokens('  Brain Games - Brainy Boxy  '), ['Brain', 'Games', 'Brainy', 'Boxy']);
});

test('buildMetricTargets uses unified app id when available and platform ids otherwise', () => {
  assert.deepEqual(
    core.buildMetricTargets({
      unifiedAppId: 'u1',
      iosAppIds: ['111'],
      androidAppIds: ['com.example'],
    }),
    [{ os: 'unified', appIds: ['u1'] }]
  );

  assert.deepEqual(
    core.buildMetricTargets({
      unifiedAppId: null,
      iosAppIds: ['111'],
      androidAppIds: ['com.example'],
    }),
    [
      { os: 'ios', appIds: ['111'] },
      { os: 'android', appIds: ['com.example'] },
    ]
  );
});

test('latestRankFromCategoryHistory reads nested graphData from SensorTower category history', () => {
  const data = {
    '1617391485': {
      US: {
        '7012': {
          topfreeapplications: {
            graphData: [
              [1778025600, 2],
              [1778112000, 1],
            ],
          },
        },
      },
    },
  };

  const rank = core.latestRankFromCategoryHistory(data, {
    appId: '1617391485',
    country: 'US',
    category: '7012',
    chartType: 'topfreeapplications',
    endDate: '2026-05-07',
  });

  assert.equal(rank, 1);
});

test('parseSalesReportEstimates summarizes unified response rows', () => {
  const rows = core.parseSalesReportEstimates({
    unified: [
      { app_id: 'u1', country: 'WW', date: '2026-05-01', unified_units: 10, unified_revenue: 5 },
      { app_id: 'u1', country: 'WW', date: '2026-05-02', u: 20, r: 7 },
    ],
  });

  assert.deepEqual(rows, [
    { appId: 'u1', country: 'WW', date: '2026-05-01', downloads: 10, revenue: 5 },
    { appId: 'u1', country: 'WW', date: '2026-05-02', downloads: 20, revenue: 7 },
  ]);
  assert.deepEqual(core.summarizeSales(rows), { downloads: 30, revenue: 12, rpd: 0.4 });
});

test('defaultDateWindow returns last completed 30-day window for a fixed date', () => {
  const range = core.defaultDateWindow(new Date('2026-06-04T08:00:00Z'));

  assert.deepEqual(range, { startDate: '2026-05-05', endDate: '2026-06-03' });
});

test('buildProfile combines sales, dau, and rankings into a standard payload', () => {
  const profile = core.buildProfile({
    now: '2026-06-04T08:00:00.000Z',
    identity: {
      query: 'Block Blast',
      canonicalName: 'Block Blast!',
      publisher: 'Hungry Studio',
      unifiedAppId: null,
      iosAppIds: ['1617391485'],
      androidAppIds: ['com.block.juggle'],
      confidence: 'high',
    },
    period: { startDate: '2026-05-04', endDate: '2026-06-02', country: 'WW' },
    salesRows: [
      { date: '2026-05-04', downloads: 100, revenue: 20 },
      { date: '2026-05-05', downloads: 300, revenue: 40 },
    ],
    activeUserRows: [
      { date: '2026-05-04', activeUsers: 1000 },
      { date: '2026-05-05', activeUsers: 3000 },
    ],
    rankings: [{ os: 'ios', device: 'iphone', categoryName: 'Games', latestRank: 2 }],
    apiCalls: [{ name: 'sales_report_estimates' }],
    warnings: [],
  });

  assert.equal(profile.summary.downloads, 400);
  assert.equal(profile.summary.revenue, 60);
  assert.equal(profile.summary.rpd, 0.15);
  assert.equal(profile.summary.averageDau, 2000);
  assert.equal(profile.summary.arpdau, 0.03);
  assert.equal(profile.rankings[0].latestRank, 2);
});

test('renderMarkdownProfile includes identity, metrics, rankings, warnings, and API count', () => {
  const markdown = core.renderMarkdownProfile({
    generatedAt: '2026-06-04T08:00:00.000Z',
    identity: {
      query: 'Block Blast',
      canonicalName: 'Block Blast!',
      publisher: 'Hungry Studio',
      unifiedAppId: '622390aa2e0fa027dbdc26b8',
      iosAppIds: ['1617391485'],
      androidAppIds: ['com.block.juggle'],
      confidence: 'high',
    },
    period: { startDate: '2026-05-04', endDate: '2026-06-02', country: 'WW' },
    summary: { downloads: 1000, revenue: 250, rpd: 0.25, averageDau: 200, arpdau: 1.25, timeSpentSeconds: null },
    rankings: [{ os: 'ios', device: 'iphone', categoryName: 'Games/Puzzle', chartType: 'topfreeapplications', latestRank: 1 }],
    apiCalls: [{ name: 'sales_report_estimates' }, { name: 'active_users' }],
    warnings: ['website visits endpoint unavailable'],
  });

  assert.match(markdown, /# Block Blast!/);
  assert.match(markdown, /下载量: 1,000/);
  assert.match(markdown, /平均 DAU: 200/);
  assert.match(markdown, /Games\/Puzzle/);
  assert.match(markdown, /API 调用数: 2/);
  assert.match(markdown, /website visits endpoint unavailable/);
});

test('selectFeishuWebhookEnv prefers game-god-specific webhook keys', () => {
  assert.deepEqual(
    core.selectFeishuWebhookEnv({
      FEISHU_WEBHOOK_URL: 'generic',
      FEISHU_WEBHOOK_URL_GAME_GOD: 'game-god-alt',
      FEISHU_GAME_GOD_WEBHOOK_URL: 'game-god',
    }),
    { key: 'FEISHU_GAME_GOD_WEBHOOK_URL', value: 'game-god' }
  );

  assert.deepEqual(
    core.selectFeishuWebhookEnv({
      FEISHU_WEBHOOK_URL: 'generic',
    }),
    { key: 'FEISHU_WEBHOOK_URL', value: 'generic' }
  );
});

test('buildFeishuProfileCard creates a concise Game God interactive card', () => {
  const card = core.buildFeishuProfileCard({
    identity: {
      canonicalName: 'Block Blast!',
      iosAppIds: ['1617391485'],
      androidAppIds: ['com.block.juggle'],
    },
    period: { startDate: '2026-05-04', endDate: '2026-06-02', country: 'WW' },
    summary: {
      downloads: 20311739,
      revenue: 1770652,
      rpd: 0.0872,
      averageDau: 35231652,
      arpdau: 0.0503,
    },
    rankings: [{ os: 'ios', device: 'iphone', categoryName: 'Games/Puzzle', chartType: 'topfreeapplications', latestRank: 1 }],
    warnings: ['website visits endpoint unavailable'],
  });

  assert.equal(card.msg_type, 'interactive');
  assert.equal(card.card.header.title.content, '游戏之神｜Block Blast!');
  const content = card.card.elements[0].content;
  assert.match(content, /下载量: 20,311,739/);
  assert.match(content, /收入: \$1,770,652/);
  assert.match(content, /iOS: 1617391485/);
  assert.match(content, /Games\/Puzzle/);
  assert.match(content, /website visits endpoint unavailable/);
});
