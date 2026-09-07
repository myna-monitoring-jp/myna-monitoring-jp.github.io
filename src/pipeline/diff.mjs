/**
 * diff：前日差分と状態遷移
 *
 * 仕様§8 / §10。前日の事象台帳と比較して差分ラベルを機械判定する。
 *
 * 重要な制約：
 *  - 「公式終了発表がない」だけを理由に障害継続と断定しない（仕様§22-4）。
 *    予定終了時刻を過ぎた場合は「予定時刻経過」「延長告知未確認」と表現する
 *  - 既存批判と新規広報起点の反応を混ぜない（仕様§12.4）
 *  - 重要更新があった場合だけ `lastMaterialUpdateAt` を進める。
 *    ここがずれると7日ルールの起算点が壊れる
 */

/** 差分ラベル。event_schema.json の `deltaStatus` enum に一致させる。 */
export const DELTA = {
  NEW: 'new',
  EXPANDED: 'expanded',
  MATERIAL_UPDATE: 'material_update',
  IMPROVING: 'improving',
  RESOLVED: 'resolved',
  UNCHANGED: 'unchanged',
  REIGNITED: 'reignited',
  CORRECTION: 'correction',
  BACKFILL: 'backfill',
};

/** 前日台帳を canonicalKey で引ける形にする。 */
export function indexPrevious(previous) {
  const byKey = new Map();
  const byId = new Map();
  for (const event of previous?.events ?? []) {
    if (event.canonicalKey) byKey.set(event.canonicalKey, event);
    if (event.id) byId.set(event.id, event);
  }
  return { byKey, byId, events: previous?.events ?? [] };
}

/**
 * 重要更新かどうか（仕様§8「重要更新の定義」）。
 *
 * 表記ゆれの修正や、同じ媒体の記事が増えただけでは重要更新にしない。
 */
export function detectMaterialChanges(event, before) {
  /** @type {{field: string, before: unknown, after: unknown, reason: string}[]} */
  const changes = [];

  if (!before) return changes;

  // 新しい独立媒体が増えた（同一媒体の追記は含めない）
  if ((event.independentMediaCount ?? 0) > (before.independentMediaCount ?? 0)) {
    changes.push({
      field: 'independentMediaCount',
      before: before.independentMediaCount ?? 0,
      after: event.independentMediaCount ?? 0,
      reason: '独立した追加報道',
    });
  }

  // 一次情報が新たに確認できた
  if (event.primarySourceConfirmed && !before.primarySourceConfirmed) {
    changes.push({
      field: 'primarySourceConfirmed',
      before: false,
      after: true,
      reason: '一次情報を確認',
    });
  }

  // 影響人数が判明・変更された
  if (event.affectedCount !== before.affectedCount) {
    changes.push({
      field: 'affectedCount',
      before: before.affectedCount ?? null,
      after: event.affectedCount ?? null,
      reason: before.affectedCount === null ? '影響人数が判明' : '影響人数が変更',
    });
  }

  // 復旧状態が進んだ
  if (event.recoveryStatus !== before.recoveryStatus) {
    changes.push({
      field: 'recoveryStatus',
      before: before.recoveryStatus,
      after: event.recoveryStatus,
      reason: '復旧状態の更新',
    });
  }

  // 影響度が有意に動いた（小さな揺れは無視する）
  if (Math.abs((event.impactScore ?? 0) - (before.impactScore ?? 0)) >= 10) {
    changes.push({
      field: 'impactScore',
      before: before.impactScore ?? 0,
      after: event.impactScore ?? 0,
      reason: '影響範囲の評価が変化',
    });
  }

  // 炎上認定が変わった
  if (Boolean(event.backlashRecognized) !== Boolean(before.backlashRecognized)) {
    changes.push({
      field: 'backlashRecognized',
      before: Boolean(before.backlashRecognized),
      after: Boolean(event.backlashRecognized),
      reason: event.backlashRecognized ? '炎上認定' : '炎上認定を取り下げ',
    });
  }

  return changes;
}

/**
 * 差分ラベルを決める。
 *
 * @param nowIso 実行時刻
 * @param primaryWindowHours 主対象期間（既定24時間）。これより古い初検知は backfill
 */
export function classifyDelta(event, before, { nowIso, primaryWindowHours = 24 }) {
  if (!before) {
    /*
     * 初検知。ただし公開日が主対象期間より古い場合は「追補」として区別する。
     * 1年前の記事を「本日発生」として扱わないための境界（仕様§1.3）。
     */
    const reference = event.publishedAt ?? event.occurredAt;
    if (reference) {
      const ageHours = (Date.parse(nowIso) - Date.parse(reference)) / 3600000;
      if (Number.isFinite(ageHours) && ageHours > primaryWindowHours) return DELTA.BACKFILL;
    }
    return DELTA.NEW;
  }

  const changes = detectMaterialChanges(event, before);

  // 復旧が確認できた
  if (event.recoveryStatus === 'recovered_confirmed' && before.recoveryStatus !== 'recovered_confirmed') {
    return DELTA.RESOLVED;
  }
  // 部分復旧・影響縮小
  if (event.recoveryStatus === 'partially_recovered' && before.recoveryStatus === 'ongoing_stated') {
    return DELTA.IMPROVING;
  }
  // 沈静化していたものに新しい動きが出た
  if ((before.status === 'quiet' || before.status === 'archived') && changes.length > 0) {
    return DELTA.REIGNITED;
  }
  // 公式が前報を訂正した、または原因が変わった
  if (changes.some((change) => change.field === 'affectedCount' && before.affectedCount !== null)) {
    return DELTA.CORRECTION;
  }
  // 報道・反応・対象が拡大
  if (
    (event.independentMediaCount ?? 0) > (before.independentMediaCount ?? 0) ||
    (event.attentionScore ?? 0) - (before.attentionScore ?? 0) >= 15
  ) {
    return DELTA.EXPANDED;
  }
  if (changes.length > 0) return DELTA.MATERIAL_UPDATE;
  return DELTA.UNCHANGED;
}

/**
 * 状態を決める（仕様§10）。
 *
 * `WATCH` `継続` は使わない。
 */
export function classifyStatus(event, before, { nowIso, config }) {
  const quietDays = config?.dashboard?.quiet_days ?? 7;
  const newHours = config?.dashboard?.new_item_hours ?? 48;

  if (event.pinned) {
    // pinned は沈静化させないが、状態自体は素直に判定する
  }

  if (event.eventClass === 'planned_maintenance') return 'planned';
  if (event.recoveryStatus === 'recovered_confirmed') return 'resolved';
  if (event.recoveryStatus === 'partially_recovered') return 'improving';

  const lastMaterial = event.lastMaterialUpdateAt ?? event.detectedAt;
  const daysSince = (Date.parse(nowIso) - Date.parse(lastMaterial)) / 86400000;

  // 沈静化：最終重要更新から所定日数、新しい動きがない
  if (Number.isFinite(daysSince) && daysSince >= quietDays) return 'quiet';

  // 要注視：影響・報道・反応が拡大中、または即時確認が必要
  if (event.deltaStatus === DELTA.EXPANDED || event.deltaStatus === DELTA.REIGNITED) return 'attention';
  if ((event.impactScore ?? 0) >= 60) return 'attention';
  if (event.backlashRecognized) return 'attention';

  // 新着：初検知から一定時間以内
  const detectedHours = (Date.parse(nowIso) - Date.parse(event.detectedAt)) / 3600000;
  if (!before && Number.isFinite(detectedHours) && detectedHours <= newHours) return 'new';

  return 'follow_up';
}

/**
 * 事象へ差分・状態・訂正履歴を付ける。
 *
 * `lastMaterialUpdateAt` は重要更新があった日時だけ進める。
 * 毎日進めてしまうと7日ルールが永久に発火しない。
 */
/**
 * @param {any} event
 * @param {any} previousIndex
 * @param {{nowIso: string, config: any}} options
 * @returns {any & {materialChanges: {field: string, before: unknown, after: unknown, reason: string}[]}}
 */
export function applyDiff(event, previousIndex, { nowIso, config }) {
  const before = previousIndex.byKey.get(event.canonicalKey) ?? null;
  const primaryWindowHours = config?.extract?.primary_window_hours ?? 24;

  const deltaStatus = classifyDelta(event, before, { nowIso, primaryWindowHours });
  const changes = detectMaterialChanges(event, before);

  const hadMaterialChange =
    !before ||
    changes.length > 0 ||
    [DELTA.RESOLVED, DELTA.IMPROVING, DELTA.EXPANDED, DELTA.REIGNITED, DELTA.CORRECTION].includes(deltaStatus);

  const lastMaterialUpdateAt = hadMaterialChange
    ? nowIso
    : (before?.lastMaterialUpdateAt ?? event.detectedAt ?? nowIso);

  /*
   * 訂正履歴。前報の値が変わったものだけを残す。
   * 新規に判明した値（null → 値）は訂正ではないので理由を分ける。
   */
  const corrections = [
    ...(before?.corrections ?? []),
    ...changes
      .filter((change) => change.before !== null && change.before !== undefined && change.before !== false)
      .filter((change) => change.field === 'affectedCount' || change.field === 'recoveryStatus')
      .map((change) => ({
        correctedAt: nowIso,
        field: change.field,
        before: change.before,
        after: change.after,
        reason: change.reason,
      })),
  ];

  const withDelta = { ...event, deltaStatus, lastMaterialUpdateAt, materialChanges: changes, corrections };

  return {
    ...withDelta,
    status: classifyStatus(withDelta, before, { nowIso, config }),
    // 前日から引き継ぐもの
    id: before?.id ?? event.id,
    pinned: before?.pinned ?? false,
    firstDetectedAt: before?.firstDetectedAt ?? event.detectedAt,
  };
}

/**
 * 前日にあって今日の検索に出てこなかった事象を引き継ぐ。
 *
 * 検索に出ないことは「解消した」ではない。状態は据え置き、
 * 7日ルールに任せて自然に沈静化させる。
 */
export function carryForward(previousIndex, todayKeys, { nowIso, config }) {
  const quietDays = config?.dashboard?.quiet_days ?? 7;
  const retentionDays = config?.retention?.archive_days ?? 400;

  return previousIndex.events
    .filter((event) => !todayKeys.has(event.canonicalKey))
    .map((event) => {
      const lastMaterial = event.lastMaterialUpdateAt ?? event.detectedAt;
      const daysSince = (Date.parse(nowIso) - Date.parse(lastMaterial)) / 86400000;
      return {
        ...event,
        deltaStatus: DELTA.UNCHANGED,
        // 検索に出なかっただけで解消扱いにしない
        status: Number.isFinite(daysSince) && daysSince >= quietDays && !event.pinned ? 'quiet' : event.status,
      };
    })
    .filter((event) => {
      const lastMaterial = event.lastMaterialUpdateAt ?? event.detectedAt;
      const daysSince = (Date.parse(nowIso) - Date.parse(lastMaterial)) / 86400000;
      // 保持期間を過ぎたものは台帳から落とす（アーカイブJSONには残る）
      return !Number.isFinite(daysSince) || daysSince < retentionDays;
    });
}
