#!/usr/bin/env node
/**
 * 調査パイプラインの実行（毎朝 GitHub Actions から）
 *
 *   discover → fetch → extract → cluster → verify → score → diff
 *            → reaction → compose → qa → render
 *
 * 各工程は src/pipeline/ の独立モジュールで、単独でテストできる。
 * このファイルは配線とファイル入出力だけを持つ。
 *
 * 出力：
 *   data/runs/YYYY-MM-DD/search-log.jsonl   全クエリのログ
 *   data/runs/YYYY-MM-DD/fetched.jsonl      取得したページ
 *   data/runs/YYYY-MM-DD/extracted.jsonl    抽出結果
 *   data/runs/YYYY-MM-DD/clusters.json      事象統合結果
 *   data/runs/YYYY-MM-DD/qa-result.json     QA結果
 *   data/events/current.json                事象台帳（次回の前日状態になる）
 *   data/review_queue.json                  レビュー待ち
 *   public/reports/myna_news_YYYY-MM-DD.html 日別レポート
 *
 * QAでブロッキングエラーが出た場合、日別HTMLと台帳は書かず終了コード1で終わる。
 * 「テストせずに公開」を構造的に防ぐため。
 *
 * 環境変数：
 *   DRY_RUN=1          ファイルを書かずに結果だけ表示
 *   MAX_FETCH=n        取得するページ数の上限（既定80）
 *   RESEARCH_OUT_DIR   出力先の基点（既定は .）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { loadAppConfig, loadQueryCatalog, loadSourceRegistry, classifySource } from '../src/pipeline/config.mjs';
import { parseFeed } from '../src/pipeline/feed.mjs';
import { discover, discoverFetchable } from '../src/pipeline/discover.mjs';
import { fetchPages } from '../src/pipeline/fetch.mjs';
import { extractFromPage, isInScope } from '../src/pipeline/extract.mjs';
import { clusterEvents } from '../src/pipeline/cluster.mjs';
import { verifyCluster, needsReview } from '../src/pipeline/verify.mjs';
import { calculateImpactScore, calculateAttentionScore, severityFromImpact, recognizeBacklash } from '../src/pipeline/score.mjs';
import { indexPrevious, applyDiff, carryForward } from '../src/pipeline/diff.mjs';
import { loadManualVoices, attachReactions } from '../src/pipeline/reaction.mjs';
import { composeReport, bestTitle } from '../src/pipeline/compose.mjs';
import { runQa } from '../src/pipeline/qa.mjs';
import { renderDailyReport } from '../src/pipeline/render-report.mjs';

const OUT = process.env.RESEARCH_OUT_DIR ?? '.';
const DRY_RUN = process.env.DRY_RUN === '1';
const MAX_FETCH = Number(process.env.MAX_FETCH ?? 80);

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn('[警告]', ...args);

const JST_OFFSET = 9 * 3600000;
const jstDate = (date) => new Date(date.getTime() + JST_OFFSET).toISOString().slice(0, 10);

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function writeJson(path, value) {
  if (DRY_RUN) return;
  ensureDir(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(path, rows) {
  if (DRY_RUN) return;
  ensureDir(path);
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    warn(`${path} を読めません: ${error.message}`);
    return fallback;
  }
}

/* ------------------------------------------------------------------ 本体 */

async function main() {
  const now = new Date();
  const nowIso = now.toISOString();
  const reportDate = jstDate(now);
  const runDir = join(OUT, 'data', 'runs', reportDate);

  const config = loadAppConfig();
  const catalog = loadQueryCatalog();
  const registry = loadSourceRegistry();

  const previousPath = join(OUT, 'data', 'events', 'current.json');
  const previous = readJson(previousPath, { events: [] });
  const previousIndex = indexPrevious(previous);

  log('=== 調査パイプライン ===');
  log(`  基準日: ${reportDate}（JST）`);
  log(`  前日の事象台帳: ${previous.events?.length ?? 0}件`);

  /* --- discover --- */
  const searchLogPath = join(runDir, 'search-log.jsonl');
  if (!DRY_RUN) {
    ensureDir(searchLogPath);
    writeFileSync(searchLogPath, '', 'utf8');
  }

  const fetchText = async (url) => {
    const response = await fetch(url, {
      headers: { 'user-agent': config.fetch?.user_agent ?? 'myna-monitoring-portal/2.0', 'accept-language': 'ja' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  };

  const logSink = (entry) => {
    if (!DRY_RUN) appendFileSync(searchLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
  };

  /*
   * 発見は2系統に分ける。
   *  - 公式フィード・定点URL：実URLが得られるので本文を取得できる。事実確定の材料
   *  - ニュース検索：news.google.com は robots.txt 全面拒否で本文が取れない。
   *    発見と媒体数の把握のみに使う
   */
  const official = await discoverFetchable({ registry, catalog, now: nowIso, fetchText, parseFeed, logSink });
  const searched = await discover({ catalog, registry, previous, now: nowIso, fetchText, parseFeed, logSink });

  const allCandidates = [...official.candidates, ...searched.candidates];
  log(`\n[discover] クエリ ${official.queryLogs.length + searched.plannedQueryCount}本 / 候補 ${allCandidates.length}件`);
  log(`  本文取得できる候補（一次情報）: ${official.candidates.length}件`);
  log(`  発見のみの候補（報道）: ${searched.candidates.length}件`);
  for (const message of [...official.errors, ...searched.errors].slice(0, 6)) warn(`discover: ${message}`);

  const passCounts = [...official.queryLogs, ...searched.queryLogs].reduce((acc, entry) => {
    const key = entry.purpose.split(':')[0];
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  log(`  目的別: ${Object.entries(passCounts).map(([k, v]) => `${k}=${v}`).join(' / ')}`);

  /* --- fetch。ここが現行実装に無かった工程 --- */
  const fetchable = rankCandidates(allCandidates.filter((candidate) => candidate.fetchable)).slice(0, MAX_FETCH);
  const discoveryOnly = allCandidates.filter((candidate) => !candidate.fetchable);
  log(`\n[fetch] ${fetchable.length}件を取得（上限 ${MAX_FETCH}）`);

  const fetched = await fetchPages({
    candidates: fetchable,
    config,
    now: nowIso,
    onProgress: (done, total) => {
      if (done % 20 === 0 || done === total) log(`  ${done}/${total}`);
    },
  });

  /*
   * 発見のみの候補は取得しない。robots.txt で拒否されている先を叩かないため。
   * 「取得しなかった」ことを記録して、事実確定に使わせない。
   */
  const notFetched = discoveryOnly.map((candidate) => ({
    candidate,
    url: candidate.url,
    finalUrl: candidate.url,
    status: 'not_fetched',
    httpStatus: null,
    fetchedAt: nowIso,
    body: '',
    bodyUnavailable: 'discovery_only',
    title: candidate.title,
    publishedAt: candidate.publishedAt,
    updatedAt: null,
    canonicalUrl: candidate.url,
  }));

  const pages = [...fetched, ...notFetched];

  const fetchStats = pages.reduce((acc, page) => {
    const key = page.bodyUnavailable ?? page.status;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  log(`  結果: ${Object.entries(fetchStats).map(([k, v]) => `${k}=${v}`).join(' / ')}`);
  writeJsonl(join(runDir, 'fetched.jsonl'), pages.map(stripBody));

  /* --- extract --- */
  const extracted = pages.map((page) =>
    extractFromPage(page, {
      now: nowIso,
      registry,
      sourceInfo: classifySource(registry, page.candidate?.publisherUrl || page.finalUrl),
    }),
  );
  const usable = extracted.filter((record) => record.usableForFacts);
  log(`\n[extract] ${extracted.length}件 / うち本文確認できたもの ${usable.length}件`);
  writeJsonl(join(runDir, 'extracted.jsonl'), extracted);

  /*
   * 関連判定。query_catalog の広報クエリは主体（厚労省・デジタル庁・政府広報）で
   * 引くため、献血キャンペーンや腰痛予防キャンペーンのようなマイナ無関係の広報も
   * 釣れる。実際に混入したので門を置く。落としたものも extracted.jsonl に残る。
   */
  const inScope = extracted.filter((record) => isInScope(record));
  log(`  対象外として除外: ${extracted.length - inScope.length}件`);

  /* --- cluster --- */
  const allClusters = clusterEvents(inScope, { registry });

  /*
   * 事象種別を判定できなかったものは台帳へ入れない。
   *
   * 見出しだけで種別が分からないものは「事象」ではなく材料である。
   * これを台帳に入れると、情報量のない項目が並んで報告の質が見分けられなくなる。
   * 記録は data/runs/<日付>/extracted.jsonl に残るので、取りこぼしの検証はできる。
   */
  const clusters = allClusters.filter((cluster) => cluster.eventClass !== 'other');
  const unclassified = allClusters.length - clusters.length;

  log(`\n[cluster] ${inScope.length}記事 → ${allClusters.length}事象`);
  log(`  種別を判定できず台帳へ入れなかったもの: ${unclassified}件（材料として run ログに残る）`);
  const syndicated = allClusters.reduce((sum, cluster) => sum + (cluster.syndicatedCount ?? 0), 0);
  log(`  転載として除外: ${syndicated}件`);

  /* --- verify → score → diff --- */
  /*
   * 表題をここで確定させる。
   * スコア算定は表題と本文を見るが、本文が取れない候補では表題が唯一の材料になる。
   * compose まで title を付けていなかったため、スコアが常に0になっていた。
   */
  let events = clusters.map((cluster) => verifyCluster({ ...cluster, title: bestTitle(cluster) }, { config }));

  events = events.map((event) => {
    const impact = calculateImpactScore(event, { config });
    const withImpact = { ...event, ...impact, severity: severityFromImpact(impact.impactScore) };
    const attention = calculateAttentionScore(withImpact, { config, previous: previousIndex });
    const withScores = { ...withImpact, ...attention };
    return { ...withScores, ...recognizeBacklash(withScores) };
  });

  events = events.map((event) => applyDiff(event, previousIndex, { nowIso, config }));

  /* --- reaction。自動取得はできないので手動投入を読む --- */
  const manual = loadManualVoices(join(OUT, 'data', 'manual', 'public-voices.json'));
  for (const message of manual.warnings) warn(`reaction: ${message}`);
  events = attachReactions(events, { voices: manual.voices, surveys: manual.surveys, config });
  log(`\n[reaction] 手動投入 反応 ${manual.voices.length}件 / 調査 ${manual.surveys.length}件`);

  /* --- レビュー判定 --- */
  const reviewQueue = [];
  events = events.map((event) => {
    const reasons = needsReview(event, { config });
    if (reasons.length === 0) return { ...event, reviewStatus: 'unreviewed' };
    reviewQueue.push({ eventId: event.canonicalKey, title: event.title, reasons, queuedAt: nowIso });
    return { ...event, reviewStatus: 'review_required', reviewReasons: reasons };
  });
  log(`[review] レビュー待ち ${reviewQueue.length}件`);

  /* --- 前日にあって今日出なかった事象を引き継ぐ --- */
  const todayKeys = new Set(events.map((event) => event.canonicalKey));
  const carried = carryForward(previousIndex, todayKeys, { nowIso, config })
    // 引き継ぎ側も同じ基準で絞る。過去の台帳に種別不明が残っていても持ち込まない
    .filter((event) => event.eventClass && event.eventClass !== 'other');
  log(`[diff] 本日検索に出なかった前日事象 ${carried.length}件を引き継ぎ`);

  writeJson(join(runDir, 'clusters.json'), { clusters: clusters.length, events: events.length });

  /* --- compose --- */
  const run = {
    runId: `run-${reportDate}-${now.getTime().toString(36)}`,
    startedAt: nowIso,
    completedAt: null,
    timezone: 'Asia/Tokyo',
    primaryWindowStart: new Date(now.getTime() - 24 * 3600000).toISOString(),
    primaryWindowEnd: nowIso,
    queries: [...official.queryLogs, ...searched.queryLogs],
    providerVersions: { search: 'google_news_rss', extract: 'deterministic' },
    lastSuccessfulRunAt: previous.run?.startedAt ?? null,
    qa: { passed: false, blockingErrors: [], warnings: [] },
  };

  const composed = composeReport({
    clusters: [...events, ...carried.map(reviveCarried)],
    run,
    reportDate,
    nowIso,
    config,
  });

  log(`\n[compose] 掲載対象 ${composed.report.negativeEventIds.length + composed.report.positiveEventIds.length + composed.report.prEventIds.length}件`);
  log(`  ネガティブ ${composed.report.negativeEventIds.length} / ポジティブ ${composed.report.positiveEventIds.length} / 広報 ${composed.report.prEventIds.length}`);

  /* --- render → qa。HTMLを作ってから検査する --- */
  const html = renderDailyReport({ ...composed, siteUrl: config.publish?.site_url });
  const qa = runQa({ ...composed, config, html });
  run.qa = qa;
  run.completedAt = new Date().toISOString();

  log(`\n[qa] ${qa.passed ? '合格' : '不合格'}`);
  for (const message of qa.blockingErrors) console.error(`  [公開停止] ${message}`);
  for (const message of qa.warnings.slice(0, 10)) warn(`  ${message}`);
  writeJson(join(runDir, 'qa-result.json'), qa);

  if (!qa.passed && config.publish?.block_on_qa_error !== false) {
    console.error('\nQAでブロッキングエラーが出たため、レポートと台帳を書かずに終了します。');
    process.exit(1);
  }

  /* --- 出力 --- */
  const reportPath = join(OUT, config.publish?.report_dir ?? 'public/reports', `myna_news_${reportDate}.html`);
  if (!DRY_RUN) {
    ensureDir(reportPath);
    writeFileSync(reportPath, html, 'utf8');
  }
  writeJson(previousPath, { run, events: composed.events, report: composed.report });
  writeJson(join(OUT, 'data', 'review_queue.json'), { generatedAt: nowIso, items: reviewQueue });
  writeJson(join(OUT, 'data', 'reports', `${reportDate}.json`), composed);

  log(`\n=== 完了 ===`);
  log(`  日別レポート: ${reportPath}`);
  log(`  事象台帳: ${previousPath}`);
  log(`  検索ログ: ${searchLogPath}`);
  if (DRY_RUN) log('  （DRY_RUN のためファイルは書いていません）');
}

/* ---------------------------------------------------------------- 補助 */

/**
 * 取得の優先順位。
 * 一次情報（Tier 0）を最優先にする。報道より公式を先に取ることで、
 * 事実確定に使える材料から埋まる。
 */
function rankCandidates(candidates) {
  const weight = (candidate) => {
    if (candidate.tier === 0) return 0;
    if (candidate.discoveredBy?.pass === 'follow_up_close') return 1;
    if (candidate.tier === 1) return 2;
    if (candidate.tier === 2) return 3;
    return 4;
  };
  return [...candidates].sort((a, b) => {
    const diff = weight(a) - weight(b);
    if (diff !== 0) return diff;
    return String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''));
  });
}

/** 保存時に本文を落とす。runログが肥大するのを防ぐ。 */
function stripBody(page) {
  const { body, candidate, ...rest } = page;
  return {
    ...rest,
    bodyLength: body?.length ?? 0,
    discoveredBy: candidate?.discoveredBy ?? null,
    candidateTitle: candidate?.title ?? '',
  };
}

/** 引き継いだ事象を compose が扱える形に戻す。 */
function reviveCarried(event) {
  return {
    ...event,
    records: (event.sources ?? []).map((source) => ({
      title: source.label,
      publisher: source.publisher,
      url: source.url,
      finalUrl: source.url,
      canonicalUrl: source.url,
      tier: source.tier,
      sourceType: source.type,
      official: source.type === 'primary',
      usableForFacts: false,
      unusableReason: 'carried_over',
      excerpt: '',
      counts: [],
      recoveryStatus: event.recoveryStatus ?? 'unknown',
      publishedAt: source.publishedAt ?? null,
      updatedAt: source.updatedAt ?? null,
    })),
    materialChanges: [],
  };
}

main().catch((error) => {
  console.error(`調査パイプラインが失敗しました: ${error.stack ?? error.message}`);
  process.exit(1);
});
