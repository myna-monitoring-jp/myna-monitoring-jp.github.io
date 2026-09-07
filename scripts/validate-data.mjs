#!/usr/bin/env node
/**
 * Dependency-free sanity check for data files, meant to run in the daily
 * pipeline before publishing.
 *
 * It enforces the rules that would otherwise only fail at render time:
 *   - required fields present
 *   - status vocabulary (no "WATCH" / "継続")
 *   - every source URL is an absolute http(s) URL
 *   - active_stable PR items declare `stableSubtype`
 *   - incident category is one of the three lanes
 *
 * Usage: node scripts/validate-data.mjs [dir]   (default: public/data)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STATUSES = new Set([
  'new',
  'attention',
  'follow_up',
  'resolved',
  'planned_outage',
  'quiet',
  'archived',
]);
const SEVERITIES = new Set(['high', 'medium', 'low']);
const INCIDENT_CATEGORIES = new Set([
  'local_government_insurer',
  'common_system',
  'medical_it_cyber',
]);
const PR_CLASSIFICATIONS = new Set(['reported_backlash', 'active_watch', 'active_stable']);
const SOURCE_TYPES = new Set(['primary', 'media', 'social', 'survey']);
const BANNED_WORDS = ['WATCH', '継続中の案件'];
const BRIEFING_CHANGES = new Set(['new', 'increased', 'decreased', 'flat', 'scheduled_end', 'resolved']);
const FACT_ASSESSMENTS = new Set([
  'fact',
  'misunderstanding',
  'overstatement',
  'legitimate_debate',
  'scope_separation',
  'unconfirmed',
]);

const errors = [];
const warnings = [];

const fail = (file, path, message) => errors.push(`${file} → ${path}: ${message}`);
const warn = (file, path, message) => warnings.push(`${file} → ${path}: ${message}`);

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function checkSources(file, path, sources) {
  if (!Array.isArray(sources)) {
    fail(file, path, 'sources は配列である必要があります。');
    return;
  }
  if (sources.length === 0) warn(file, path, '出典が1件も登録されていません。');
  sources.forEach((source, index) => {
    const at = `${path}.sources[${index}]`;
    if (!source || typeof source !== 'object') return fail(file, at, '出典の形式が不正です。');
    if (!SOURCE_TYPES.has(source.type)) fail(file, at, `type が不正です: ${source.type}`);
    if (!source.label) fail(file, at, 'label は必須です。');
    if (!isHttpUrl(source.url)) {
      fail(file, at, `url は絶対http(s) URLである必要があります: ${JSON.stringify(source.url)}`);
    }
  });
}

function checkBase(file, path, item) {
  if (!item.id) fail(file, path, 'id は必須です。');
  if (!item.title) fail(file, path, 'title は必須です。');
  if (!STATUSES.has(item.status)) fail(file, path, `status が不正です: ${item.status}`);
  if (!SEVERITIES.has(item.severity)) fail(file, path, `severity が不正です: ${item.severity}`);
  if (!item.lastMaterialUpdateAt) {
    fail(file, path, 'lastMaterialUpdateAt は必須です（7日ルールの基準）。');
  } else if (Number.isNaN(Date.parse(item.lastMaterialUpdateAt))) {
    fail(file, path, `lastMaterialUpdateAt が日時として解釈できません: ${item.lastMaterialUpdateAt}`);
  }
  checkSources(file, path, item.sources);

  const serialized = JSON.stringify(item);
  for (const word of BANNED_WORDS) {
    if (serialized.includes(word)) warn(file, path, `曖昧な表記「${word}」が含まれています。`);
  }
}

function checkFile(filePath) {
  const file = filePath;
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(file, '$', `JSONとして読み込めません: ${error.message}`);
    return;
  }

  if (data.dataset !== 'sample' && data.dataset !== 'live') {
    fail(file, '$.dataset', '"sample" または "live" を指定してください。');
  }
  if (!data.settings || typeof data.settings.dashboardQuietDays !== 'number') {
    fail(file, '$.settings.dashboardQuietDays', '数値で指定してください（初期値7）。');
  }
  if (!data.dataUpdate || !data.dataUpdate.state) {
    fail(file, '$.dataUpdate.state', 'ok / stale / failed / never_updated のいずれかを指定してください。');
  }

  const ids = new Set();
  const collect = (item, path) => {
    if (ids.has(item.id)) fail(file, path, `id が重複しています: ${item.id}`);
    ids.add(item.id);
  };

  (data.news ?? []).forEach((item, index) => {
    const path = `$.news[${index}]`;
    checkBase(file, path, item);
    collect(item, path);
  });

  (data.incidents ?? []).forEach((item, index) => {
    const path = `$.incidents[${index}]`;
    checkBase(file, path, item);
    collect(item, path);
    if (!INCIDENT_CATEGORIES.has(item.incidentCategory)) {
      fail(file, path, `incidentCategory が不正です: ${item.incidentCategory}`);
    }
    if (!item.entityName) fail(file, path, 'entityName は必須です。');
    if (item.affectedCount !== undefined && item.affectedCount !== null) {
      if (!Number.isInteger(item.affectedCount)) {
        fail(file, path, 'affectedCount は整数または null（未公表）で指定してください。');
      }
    }
  });

  (data.prItems ?? []).forEach((item, index) => {
    const path = `$.prItems[${index}]`;
    checkBase(file, path, item);
    collect(item, path);
    if (!PR_CLASSIFICATIONS.has(item.prClassification)) {
      fail(file, path, `prClassification が不正です: ${item.prClassification}`);
    }
    if (item.prClassification === 'active_stable' && !['quiet', 'positive'].includes(item.stableSubtype)) {
      fail(
        file,
        path,
        'active_stable には stableSubtype（quiet=反応未検知 / positive=好意的・効果あり）が必要です。',
      );
    }
  });

  if (data.briefing) checkBriefing(file, data.briefing);
}

/**
 * 朝の状況判断の検証。
 *
 * 生成物なので人手の校正が入らない。壊れたものを公開しないための最後の関門。
 * ここを通らなかった日はデプロイしない（ワークフローが止まる）。
 */
function checkBriefing(file, briefing) {
  const base = '$.briefing';

  if (!briefing.confirmedAt) fail(file, `${base}.confirmedAt`, '確認時点は必須です。');
  if (!briefing.generatedBy) {
    fail(file, `${base}.generatedBy`, '何が生成したかを画面に出すため、モデル名は必須です。');
  }

  // 空の枠を画面に出さないため、主要な節は中身があることを求める
  for (const key of ['metrics', 'overview', 'judgments', 'diffs', 'watchlist', 'caveats']) {
    if (!Array.isArray(briefing[key]) || briefing[key].length === 0) {
      fail(file, `${base}.${key}`, '1件以上必要です（空の節を画面に出さないため）。');
    }
  }

  // 代表性の留保は要件。落ちていたら公開しない
  if (Array.isArray(briefing.caveats) && !briefing.caveats.some((c) => /代表|一般化|範囲/.test(String(c)))) {
    fail(file, `${base}.caveats`, '代表性の留保（SNS等は全国世論を代表しない旨）を必ず含めてください。');
  }

  (briefing.diffs ?? []).forEach((diff, index) => {
    const path = `${base}.diffs[${index}]`;
    if (!BRIEFING_CHANGES.has(diff.change)) fail(file, path, `change が不正です: ${diff.change}`);
    if (!diff.theme) fail(file, path, 'theme は必須です。');
    if (!diff.judgment) fail(file, path, 'judgment（その更新をどう読むか）は必須です。');
  });

  (briefing.metrics ?? []).forEach((metric, index) => {
    const path = `${base}.metrics[${index}]`;
    if (!metric.label || !metric.value) fail(file, path, 'label と value は必須です。');
    for (const word of BANNED_WORDS) {
      if (String(metric.value) === word) fail(file, path, `禁止語をラベルに使っています: ${word}`);
    }
  });

  // 出典は表示時にそのままリンクになる。リンク契約を満たせないURLは公開しない
  checkSources(file, `${base}`, briefing.sources ?? []);

  /*
   * 書き起こし。ここが報告の中身なので検査を厚くする。
   * 出典の無い書き起こしは公開しない（裏の取れていない記事を報告として
   * 出す方が、載せないより有害）。
   */
  (briefing.newsItems ?? []).forEach((item, index) => {
    const path = `${base}.newsItems[${index}]`;
    if (!item.headline) fail(file, path, 'headline は必須です。');
    if (!Array.isArray(item.body) || item.body.length === 0) {
      fail(file, path, 'body（ニュース自体の本文）は1件以上必要です。');
    }
    if (!SEVERITIES.has(item.severity)) fail(file, path, `severity が不正です: ${item.severity}`);
    if (item.tone !== 'negative' && item.tone !== 'positive') {
      fail(file, path, `tone は negative / positive のいずれかです: ${item.tone}`);
    }
    const sources = item.sources ?? [];
    if (sources.length === 0) {
      fail(file, path, '出典が1件も無い書き起こしは公開できません。');
    }
    checkSources(file, path, sources);

    // 声が無いのに観測済みと言わせない
    if (item.voiceObserved === true && !String(item.publicVoice ?? '').trim()) {
      fail(file, path, 'voiceObserved が true なのに publicVoice が空です。');
    }

    (item.claims ?? []).forEach((claim, claimIndex) => {
      const claimPath = `${path}.claims[${claimIndex}]`;
      if (!claim.claim) fail(file, claimPath, 'claim は必須です。');
      if (!FACT_ASSESSMENTS.has(claim.assessment)) {
        fail(file, claimPath, `assessment が不正です: ${claim.assessment}`);
      }
    });

    // Google News のリダイレクトURLは一次情報に到達しないため出典にしない
    for (const source of sources) {
      if (String(source.url ?? '').includes('news.google.com')) {
        fail(file, path, 'Google News のリダイレクトURLは出典に使えません（元の媒体のURLを書いてください）。');
      }
    }
  });

  (briefing.prItems ?? []).forEach((item, index) => {
    const path = `${base}.prItems[${index}]`;
    if (!item.headline) fail(file, path, 'headline は必須です。');
    if (!item.origin) fail(file, path, 'origin（①起点）は必須です。');
    if (!SEVERITIES.has(item.heatLevel)) fail(file, path, `heatLevel が不正です: ${item.heatLevel}`);
    /*
     * 広報案件は出典が無くても正しい場合がある。
     * 「行政広報の新規大型炎上は確認なし」のように、掲載物が存在しないことを
     * 記録する項目には開くべきURLが無い。空を警告にしない。
     */
    if ((item.sources ?? []).length > 0) checkSources(file, path, item.sources);
  });
}

const targetDir = resolve(process.argv[2] ?? 'public/data');
if (!existsSync(targetDir)) {
  console.error(`ディレクトリが見つかりません: ${targetDir}`);
  process.exit(1);
}

const files = [];
const current = join(targetDir, 'current.json');
if (existsSync(current)) files.push(current);
const archiveDir = join(targetDir, 'archive');
if (existsSync(archiveDir)) {
  for (const name of readdirSync(archiveDir)) {
    if (name.endsWith('.json')) files.push(join(archiveDir, name));
  }
}

if (files.length === 0) {
  console.error(`検証対象のJSONが見つかりません: ${targetDir}`);
  process.exit(1);
}

files.forEach(checkFile);

for (const message of warnings) console.warn(`[警告] ${message}`);
for (const message of errors) console.error(`[エラー] ${message}`);

console.log(
  `\n検証したファイル: ${files.length}件／エラー ${errors.length}件／警告 ${warnings.length}件`,
);
process.exit(errors.length > 0 ? 1 : 0);
