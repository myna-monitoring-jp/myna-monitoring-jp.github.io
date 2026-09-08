/**
 * アプリストアの評価の定点観測
 *
 * 取るのは**数値だけ**。レビュー本文は取らない。
 *
 * 理由：個々のレビューを引用すると、非代表サンプルを「国民の声」として
 * 扱うことになる（仕様§11の絶対ルール）。評価値と件数は観測できる事実なので
 * 定点観測し、前日との差分を出す。
 *
 * レビューフィード（`/rss/customerreviews/`）は0件返却で実質廃止されているが、
 * アプリページ自体は robots.txt 許可・HTTP 200 で取得できる（2026-09-08 実測）。
 *
 * 評価件数はページ内の表示箇所によって数件ずれることがある。
 * 取れた値のうち最小と最大を保持し、幅で記録する（推測で1つに丸めない）。
 */

/**
 * ページから評価値と件数を取る。取れなければ null。
 *
 * 注意：アプリページには「似たようなアプリ」の JSON-LD も埋まっており、
 * `reviewCount` を全部集めると別アプリの件数まで混ざる
 * （実際に 1〜7,271件 という無意味な幅になった）。
 * したがって**優先順位の高い抽出方法で1つでも取れたら、そこで打ち切る**。
 * 複数の値が出るのは同じ抽出方法の中だけに限る。
 */
export function extractAppRating(html) {
  const source = String(html ?? '');

  /* --- 評価値。表示テキスト（このアプリ自身）を優先する --- */
  const ratingStrategies = [
    // 「2.3 …（タグ）… out of 5」。間に閉じタグが挟まるので緩く見る
    /([0-9](?:\.[0-9])?)\s*<\/[a-z]+>[\s\S]{0,60}?(?:out of 5|5点満点)/gi,
    /([0-9](?:\.[0-9])?)\s*(?:点|\/\s*5)\s*(?:中|、|の評価)/gi,
    /"ratingValue"\s*:\s*"?([0-9.]+)"?/gi,
  ];
  const ratings = firstNonEmpty(source, ratingStrategies, (value) => value >= 0 && value <= 5);

  /*
   * 評価件数。ローカライズされた表示（「535件の評価」）が
   * このアプリ自身の値なので最優先。JSON-LD は最後の手段で、
   * その場合は最初の1件だけを使う（後続は別アプリの値）。
   */
  const countStrategies = [
    /([0-9][0-9,]{0,8})\s*件の評価/g,
    /([0-9][0-9,]{0,8})\s*Ratings?\b/gi,
    /"(?:reviewCount|ratingCount)"\s*:\s*"?([0-9][0-9,]{0,8})/gi,
  ];
  const counts = firstNonEmpty(
    source,
    countStrategies,
    (value) => value > 0 && value < 100_000_000,
    // JSON-LD に落ちた場合は先頭1件だけ
    (strategyIndex, values) => (strategyIndex === 2 ? values.slice(0, 1) : values),
  );

  if (ratings.length === 0 && counts.length === 0) return null;

  const unique = [...new Set(counts)].sort((a, b) => a - b);

  return {
    rating: ratings[0] ?? null,
    // 同じ抽出方法の中で差が出た場合だけ幅になる（表示箇所による数件のずれ）
    reviewCountMin: unique[0] ?? null,
    reviewCountMax: unique[unique.length - 1] ?? null,
  };
}

/** 優先順位順に試し、最初に値が取れた方法の結果だけを返す。 */
function firstNonEmpty(source, strategies, isValid, postProcess) {
  for (const [index, pattern] of strategies.entries()) {
    const values = [...source.matchAll(pattern)]
      .map((match) => Number(String(match[1]).replace(/,/g, '')))
      .filter((value) => Number.isFinite(value) && isValid(value));
    if (values.length > 0) return postProcess ? postProcess(index, values) : values;
  }
  return [];
}

/** 幅のある件数を人が読む形にする。 */
export function formatReviewCount(min, max) {
  if (min === null || min === undefined) return '取得できず';
  if (max === null || max === undefined || min === max) return `${min.toLocaleString('ja-JP')}件`;
  return `${min.toLocaleString('ja-JP')}〜${max.toLocaleString('ja-JP')}件`;
}

/**
 * アプリストアの評価を事象として組む。
 *
 * 前日の台帳から同じ canonicalKey を引いて差分を出す。
 * 「件数が増えた」ことは観測できるが、**増加理由は断定しない**
 * （CM批判が原因とは限らない。仕様§22-7）。
 */
export async function collectAppStoreMetrics({ registry, now, fetchText, previousIndex }) {
  const results = [];
  const errors = [];
  const nowIso = new Date(now).toISOString();

  for (const app of registry.app_store_metrics ?? []) {
    let observed;
    try {
      observed = extractAppRating(await fetchText(app.url));
    } catch (error) {
      errors.push(`${app.label}（${app.url}）: ${error.message}`);
      continue;
    }
    if (!observed) {
      errors.push(`${app.label}: 評価値・評価件数を抽出できませんでした。`);
      continue;
    }

    const canonicalKey = `appstore|${app.id}`;
    const before = previousIndex?.byKey?.get(canonicalKey) ?? null;
    const beforeCount = before?.metrics?.find((metric) => metric.key === 'reviewCountMax')?.value ?? null;
    const beforeRating = before?.metrics?.find((metric) => metric.key === 'rating')?.value ?? null;

    const countText = formatReviewCount(observed.reviewCountMin, observed.reviewCountMax);
    const parts = [
      `${app.label}のアプリストア評価は${observed.rating ?? '取得できず'}／5、評価件数は${countText}です（${nowIso.slice(0, 10)}時点）。`,
    ];

    if (typeof beforeCount === 'number' && typeof observed.reviewCountMax === 'number') {
      const diff = observed.reviewCountMax - beforeCount;
      if (diff !== 0) {
        parts.push(
          `前日確認値${beforeCount.toLocaleString('ja-JP')}件から${diff > 0 ? '+' : ''}${diff.toLocaleString('ja-JP')}件。`,
        );
        // 増加理由を断定しない。CM・広報への批判と結びつける根拠は無い
        parts.push('件数の増減理由は特定していません。特定の広報やCMへの反応とは結び付けていません。');
      } else {
        parts.push('前日から評価件数の変化はありません。');
      }
    }
    if (typeof beforeRating === 'number' && observed.rating !== null && beforeRating !== observed.rating) {
      parts.push(`評価値は${beforeRating}から${observed.rating}へ変化しました。`);
    } else if (observed.rating !== null) {
      parts.push('評価値は横ばいです。');
    }

    results.push({
      canonicalKey,
      entity: app.publisher ?? 'Apple App Store',
      // 障害でも広報でもない。利用者体験の観測なので運用負荷として扱う
      eventClass: 'operational_load',
      domain: 'myna_app',
      systemLayer: app.system_layer ?? null,
      title: `${app.label}のアプリストア評価：${observed.rating ?? '不明'}／5・${countText}`,
      occurredAt: null,
      publishedAt: nowIso,
      updatedAt: null,
      detectedAt: nowIso,
      recoveryStatus: 'unknown',
      // 数値は metrics として持つ。取得時点を必ず付ける
      observedMetrics: [
        {
          key: 'rating',
          label: '評価値',
          value: observed.rating,
          unit: '／5',
          scope: app.label,
          denominator: null,
          observedAt: nowIso,
          sourceId: null,
          qualifier: 'exact',
        },
        {
          key: 'reviewCountMin',
          label: '評価件数（下限）',
          value: observed.reviewCountMin,
          unit: '件',
          scope: app.label,
          denominator: null,
          observedAt: nowIso,
          sourceId: null,
          qualifier: 'exact',
        },
        {
          key: 'reviewCountMax',
          label: '評価件数（上限）',
          value: observed.reviewCountMax,
          unit: '件',
          scope: app.label,
          denominator: null,
          observedAt: nowIso,
          sourceId: null,
          qualifier: 'exact',
        },
      ].filter((metric) => metric.value !== null),
      summaryOverride: parts.join(''),
      unknownsExtra: [
        'アプリストアの評価は利用者の自発的な投稿であり、全国世論を代表しません。',
        observed.reviewCountMin !== observed.reviewCountMax
          ? 'ページ内の表示箇所によって評価件数に差があるため、幅で記録しています。'
          : null,
      ].filter(Boolean),
      records: [
        {
          title: `${app.label} アプリページ`,
          publisher: app.publisher ?? 'Apple App Store',
          url: app.url,
          finalUrl: app.url,
          canonicalUrl: app.url,
          publisherUrl: app.url,
          tier: 3,
          sourceType: 'app_store',
          official: false,
          // 数値は取れたが本文（レビュー）は事実確定に使わない
          usableForFacts: false,
          unusableReason: 'metrics_only',
          excerpt: '',
          counts: [],
          officialDenials: [],
          recoveryStatus: 'unknown',
          publishedAt: nowIso,
          updatedAt: null,
        },
      ],
    });
  }

  return { events: results, errors };
}
