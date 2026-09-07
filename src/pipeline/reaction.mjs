/**
 * reaction：国民・現場の声
 *
 * 仕様§11 / §3.6。
 *
 * **自動取得はしない。** 2026-09-03 の実測で、使える手段が無いことを確認した。
 *   - App Store のレビューフィードは0件返却（実質廃止）
 *   - X・Yahoo!コメントに無料のAPIがない
 * 詳細は docs/CURRENT_STATE_AUDIT.md §5。
 *
 * したがってこの工程は「人が置いたものを読む」だけにする。
 * 見つからない声を生成しないことが最優先の約束（仕様§11 絶対ルール）。
 *
 * 置き場所：`data/manual/public-voices.json`
 * 無ければ「新規の有意な反応は確認できず」と表示する。
 */

import { readFileSync, existsSync } from 'node:fs';

/** 反応の立場。event_schema.json の `stance` enum に一致させる。 */
export const STANCES = new Set([
  'support',
  'expectation',
  'convenience',
  'concern',
  'dissatisfaction',
  'legitimate_objection',
  'misunderstanding',
  'overstatement',
  'field_report',
  'mixed',
]);

const PLATFORMS = new Set([
  'x',
  'yahoo_comments',
  'yahoo_realtime',
  'app_store',
  'google_play',
  'professional_comment',
  'survey',
]);

/**
 * 手動投入の反応を読む。
 *
 * 形式が壊れている項目は落として警告に回す。
 * 数値が無いものは null のまま残す（推測で埋めない）。
 */
export function loadManualVoices(path = 'data/manual/public-voices.json') {
  if (!existsSync(path)) return { voices: [], surveys: [], warnings: [] };

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { voices: [], surveys: [], warnings: [`${path} を読めません: ${error.message}`] };
  }

  const warnings = [];

  const voices = (Array.isArray(raw.voices) ? raw.voices : []).flatMap((entry, index) => {
    if (!entry?.summary || !entry?.observedAt) {
      warnings.push(`voices[${index}]: summary と observedAt は必須です。`);
      return [];
    }
    if (!PLATFORMS.has(entry.platform)) {
      warnings.push(`voices[${index}]: platform が不正です（${entry.platform}）。`);
      return [];
    }
    if (entry.stance && !STANCES.has(entry.stance)) {
      warnings.push(`voices[${index}]: stance が不正です（${entry.stance}）。`);
      return [];
    }
    return [
      {
        id: entry.id ?? `voice-${index + 1}`,
        platform: entry.platform,
        url: entry.url ?? null,
        postedAt: entry.postedAt ?? null,
        // 取得日時は必須。いつ時点の数値かが分からない反応は使えない（仕様§11）
        observedAt: entry.observedAt,
        summary: String(entry.summary).trim(),
        stance: entry.stance ?? 'mixed',
        replyCount: numberOrNull(entry.replyCount),
        repostCount: numberOrNull(entry.repostCount),
        quoteCount: numberOrNull(entry.quoteCount),
        likeCount: numberOrNull(entry.likeCount),
        viewCount: numberOrNull(entry.viewCount),
        commentCount: numberOrNull(entry.commentCount),
        // 広報の公開前後を区別する（仕様§12.4）
        beforeCampaign: typeof entry.beforeCampaign === 'boolean' ? entry.beforeCampaign : null,
        directReactionToCampaign:
          typeof entry.directReactionToCampaign === 'boolean' ? entry.directReactionToCampaign : null,
        // SNSは常に非代表。スキーマ上も const false
        representativeOfPopulation: false,
        eventKey: entry.eventKey ?? null,
      },
    ];
  });

  const surveys = (Array.isArray(raw.surveys) ? raw.surveys : []).flatMap((entry, index) => {
    const required = ['organization', 'fieldworkStart', 'fieldworkEnd', 'method', 'sampleSize', 'question'];
    const missing = required.filter((key) => !entry?.[key]);
    if (missing.length > 0) {
      warnings.push(`surveys[${index}]: ${missing.join(', ')} が必要です。`);
      return [];
    }
    if (!Array.isArray(entry.results) || entry.results.length === 0) {
      warnings.push(`surveys[${index}]: results が必要です。`);
      return [];
    }
    return [{ ...entry, eventKey: entry.eventKey ?? null }];
  });

  return { voices, surveys, warnings };
}

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * 事象へ反応を割り当てる。
 *
 * `eventKey` が canonicalKey に一致するものだけを付ける。
 * 曖昧一致で別事象の声を付けると、実在しない反応を作るのと同じことになる。
 */
export function attachReactions(events, { voices, surveys, config }) {
  const maxPerEvent = 5;

  return events.map((event) => {
    const eventVoices = voices.filter((voice) => voice.eventKey === event.canonicalKey).slice(0, maxPerEvent);
    const eventSurveys = surveys.filter((survey) => survey.eventKey === event.canonicalKey);

    /*
     * 広報案件では、既存批判と広告公開後の反応を別に数える（仕様§12.4）。
     * 既存投稿の反応数を新規広告の炎上規模として使わないため。
     */
    const existingCriticism = eventVoices.filter((voice) => voice.beforeCampaign === true);
    const campaignReaction = eventVoices.filter((voice) => voice.directReactionToCampaign === true);

    return {
      ...event,
      publicVoices: eventVoices,
      surveys: eventSurveys,
      existingCriticismCount: existingCriticism.length,
      campaignReactionCount: campaignReaction.length,
      // 反応が無いことを「無かった」と断定しない。確認できなかったと表示する
      voiceObserved: eventVoices.length > 0,
    };
  });
}

/** 反応が無い場合の定型文。仕様§15.3。 */
export const NO_REACTION_TEXT = '直近24時間で、新規の有意な反応は確認できませんでした。';

/** 一次情報が無い場合の定型文。仕様§15.3。 */
export const NO_PRIMARY_SOURCE_TEXT = '一次情報は確認できず、現時点では報道ベースです。';
