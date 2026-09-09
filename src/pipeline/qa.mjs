/**
 * qa：公開前ゲート
 *
 * 仕様§17 / `docs/spec/QA_CHECKLIST.md` の自動化できる項目。
 *
 * `blockingErrors` が1件でもあれば公開しない。
 * 「テストせずに公開」を構造的に防ぐのがこの工程の役目。
 */

/** 日本語の曜日。日付と曜日の一致を検査するため。 */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function weekdayOf(isoDate) {
  const time = Date.parse(`${isoDate}T00:00:00+09:00`);
  if (!Number.isFinite(time)) return null;
  /*
   * JSTの日付に対する曜日を出す。
   * +09:00 で作った時刻に getUTCDay を当てると前日の曜日になる。
   */
  return WEEKDAYS[new Date(time + 9 * 3600000).getUTCDay()];
}

/**
 * レポート全体を検査する。
 *
 * @returns {{passed: boolean, blockingErrors: string[], warnings: string[]}}
 */
export function runQa({ report, events, run, config, html = '' }) {
  /** @type {string[]} */
  const blockingErrors = [];
  /** @type {string[]} */
  const warnings = [];
  const threshold = config?.research?.primary_source_required_impact ?? 60;
  const nowMs = Date.parse(run.startedAt);

  /* --- 日付 --- */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.reportDate)) {
    blockingErrors.push(`reportDate の形式が不正です: ${report.reportDate}`);
  } else if (!weekdayOf(report.reportDate)) {
    blockingErrors.push(`reportDate が日付として解釈できません: ${report.reportDate}`);
  }

  const windowHours = (Date.parse(run.primaryWindowEnd) - Date.parse(run.primaryWindowStart)) / 3600000;
  if (!Number.isFinite(windowHours) || Math.abs(windowHours - 24) > 0.5) {
    blockingErrors.push(`主対象期間が24時間ではありません: ${windowHours}時間`);
  }

  /* --- 事象ごと --- */
  for (const event of events) {
    const at = `events[${event.id}]`;

    // 未来日付
    for (const key of ['occurredAt', 'publishedAt', 'detectedAt', 'lastMaterialUpdateAt']) {
      const value = event[key];
      if (!value) continue;
      const time = Date.parse(value);
      if (!Number.isFinite(time)) {
        blockingErrors.push(`${at}.${key} が日時として解釈できません: ${value}`);
      } else if (time > nowMs + 3600000) {
        blockingErrors.push(`${at}.${key} が未来の日付です: ${value}`);
      }
    }

    // 発生日が公開日より後になっていないか
    if (event.occurredAt && event.publishedAt && Date.parse(event.occurredAt) > Date.parse(event.publishedAt) + 86400000) {
      warnings.push(`${at}: 発生日が公開日より後です。抽出誤りの可能性があります。`);
    }

    // 重要度が高いのに一次情報も「未確認」表示も無い
    if ((event.impactScore ?? 0) >= threshold && !event.primarySourceConfirmed) {
      const declared = (event.unknowns ?? []).some((note) => /一次情報/.test(note));
      if (!declared) {
        blockingErrors.push(`${at}: 影響度${event.impactScore}なのに一次情報も未確認表示もありません。`);
      } else if (event.reviewStatus !== 'review_required') {
        blockingErrors.push(`${at}: 一次情報が無い重要案件がレビュー待ちになっていません。`);
      }
    }

    // 出典が1件も無い
    if (!Array.isArray(event.sources) || event.sources.length === 0) {
      blockingErrors.push(`${at}: 出典が1件もありません。`);
    }

    // 計画停止を障害と書いていないか
    if (event.eventClass === 'planned_maintenance' && /障害|不具合/.test(event.title ?? '')) {
      blockingErrors.push(`${at}: 計画停止を障害と表現しています。`);
    }

    // 登録率と利用率の混同
    const text = `${event.title ?? ''} ${event.summary ?? ''}`;
    if (/登録率/.test(text) && /利用率/.test(text)) {
      warnings.push(`${at}: 登録率と利用率が同じ文に出ています。区別を確認してください。`);
    }

    // SNSを全国世論として書いていないか
    if (/世論|国民の多く|大多数/.test(text) && (event.surveys ?? []).length === 0) {
      const onlySocial = (event.publicVoices ?? []).length > 0;
      if (onlySocial) {
        blockingErrors.push(`${at}: 代表性のある調査が無いのに世論として表現しています。`);
      }
    }

    // SNS反応に取得日時があるか
    for (const [index, voice] of (event.publicVoices ?? []).entries()) {
      if (!voice.observedAt) {
        blockingErrors.push(`${at}.publicVoices[${index}]: 取得日時がありません。`);
      }
      if (voice.representativeOfPopulation !== false) {
        blockingErrors.push(`${at}.publicVoices[${index}]: representativeOfPopulation は false でなければなりません。`);
      }
    }

    // 既存批判を新規広報の炎上として計上していないか
    if (event.eventClass === 'public_communication' && event.backlashRecognized) {
      if ((event.campaignReactionCount ?? 0) === 0 && (event.existingCriticismCount ?? 0) > 0) {
        blockingErrors.push(`${at}: 既存批判のみで炎上認定しています。広報起点の反応がありません。`);
      }
    }

    // 数値に対象範囲がついているか
    if (typeof event.affectedCount === 'number' && !event.affectedCountNote) {
      warnings.push(`${at}: 影響人数に範囲・分母・基準の説明がありません。`);
    }

    // 「確認されていない」を「ない」に強めていないか
    if (/漏えいはない|流出はない|問題はない/.test(text)) {
      blockingErrors.push(`${at}: 公式の否定表現を断定に強めています。`);
    }
  }

  /* --- 検索ログ --- */
  if (!Array.isArray(run.queries) || run.queries.length === 0) {
    blockingErrors.push('検索ログが空です。何を探したか記録されていません。');
  } else {
    const purposes = new Set(run.queries.map((query) => query.purpose));
    // 24h / 72h / 前日クローズ の3系統は必須（仕様§23）
    if (![...purposes].some((p) => p.includes('24h'))) warnings.push('直近24時間の検索が記録されていません。');
    if (![...purposes].some((p) => p.includes('72h'))) warnings.push('72時間バックフィルの検索が記録されていません。');
    if (![...purposes].some((p) => p.startsWith('follow_up'))) {
      warnings.push('前日案件のクローズ確認が記録されていません（前日案件が無い場合は正常）。');
    }
    /*
     * 発見系の検索が何本通ったか。
     * 既知案件の追跡（deep_dive / reaction / follow_up / primary_source_lookup）へ
     * 予算が偏ると「更新の確認しかしていない」報告になる。
     * 2026-09-09 の実行は286本のうち213本（74%）が既知案件向けだった。
     */
    const discovery = run.queries.filter((query) =>
      /^(open_discovery|broad_discovery|announcements|local_government|online_eligibility|portal_and_app|card_and_certificate|public_money_account|medical_it_cyber|public_relations)/.test(
        query.purpose,
      ),
    );
    if (discovery.length === 0) {
      blockingErrors.push('新規発見のための検索が1本も記録されていません。既知案件の更新確認しかしていません。');
    } else if (discovery.length < run.queries.length * 0.2) {
      warnings.push(
        `新規発見の検索が${discovery.length}本／全${run.queries.length}本で、既知案件の追跡に偏っています。`,
      );
    }
    // 到達できなかった検索の割合。「出なかった」と「見に行けなかった」は別
    const failed = run.queries.filter((query) => query.error);
    if (failed.length >= run.queries.length * 0.5) {
      warnings.push(
        `${failed.length}本／全${run.queries.length}本の検索が情報源に到達できていません。取りこぼしの可能性が高い状態です。`,
      );
    }
  }

  /* --- HTML --- */
  if (html) blockingErrors.push(...checkHtml(html));

  return { passed: blockingErrors.length === 0, blockingErrors, warnings };
}

/**
 * 生成したHTMLを検査する。
 *
 * ここを自動化していないと、リンクが押せない状態で公開されうる。
 * 過去にモック側で実際に起きた（透明オーバーレイでボタンが塞がれていた）。
 */
export function checkHtml(html) {
  /** @type {string[]} */
  const errors = [];
  const source = String(html);

  // 外部リンクの契約
  for (const match of source.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = match[1];
    const href = attrs.match(/href=["']([^"']*)["']/i)?.[1];

    if (href === undefined) {
      errors.push('href を持たない <a> があります。');
      continue;
    }
    if (href === '' || href === '#' || /^javascript:/i.test(href)) {
      errors.push(`空・#・javascript: のリンクがあります: ${JSON.stringify(href)}`);
      continue;
    }
    if (/^https?:\/\//i.test(href)) {
      if (!/target=["']_blank["']/i.test(attrs)) {
        errors.push(`外部リンクに target="_blank" がありません: ${href}`);
      }
      if (!/rel=["'][^"']*noopener[^"']*["']/i.test(attrs) || !/noreferrer/i.test(attrs)) {
        errors.push(`外部リンクに rel="noopener noreferrer" がありません: ${href}`);
      }
    }
  }

  // カード全体を覆う透明リンクの禁止
  if (/position\s*:\s*absolute[^}]*inset\s*:\s*0/i.test(source)) {
    errors.push('カード全体を覆う絶対配置のオーバーレイがあります。リンクを塞ぐ可能性があります。');
  }
  if (/pointer-events\s*:\s*none/i.test(source)) {
    // ボタン側に付いていると押せなくなる。装飾用は aria-hidden で分けているので警告ではなくエラー
    errors.push('pointer-events: none が含まれています。リンクが押せなくなる可能性があります。');
  }

  // 文字コード
  if (!/<meta[^>]+charset=["']?utf-8/i.test(source)) {
    errors.push('charset=UTF-8 の宣言がありません。');
  }

  // ID重複
  const ids = [...source.matchAll(/\sid=["']([^"']+)["']/gi)].map((m) => m[1]);
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicated.length > 0) errors.push(`id が重複しています: ${[...new Set(duplicated)].join(', ')}`);

  return errors;
}
