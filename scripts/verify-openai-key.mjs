#!/usr/bin/env node
/**
 * OPENAI_API_KEY の検証だけを行う。
 *
 * 目的：キーを差し替えたときに、パイプライン全体（数分・課金あり）を回さずに
 * 「そのキーで動くか」だけを確かめる。モデル一覧の取得はトークンを消費しない。
 *
 * 過去に、GitHub のアクセストークン（ghp_...）が OPENAI_API_KEY として
 * 登録され、毎朝の生成が丸ごと失敗していたことに気づくのが遅れた。
 * その再発を防ぐための確認手段。
 *
 * キーそのものは一切出力しない。接頭辞の種類だけを報告する。
 */

const MODELS_URL = 'https://api.openai.com/v1/models';
const TARGET_MODEL = process.env.BRIEFING_MODEL || 'gpt-6-astra';

/** 接頭辞から、そもそも別サービスのキーが入っていないかを見る。 */
function describeKeyShape(key) {
  if (key.startsWith('sk-')) return { ok: true, note: 'OpenAI のキー形式（sk-）です。' };
  if (key.startsWith('ghp_') || key.startsWith('github_pat_')) {
    return { ok: false, note: 'これは GitHub のアクセストークンです。OpenAI のキーではありません。' };
  }
  if (key.startsWith('xoxb-') || key.startsWith('xoxp-')) {
    return { ok: false, note: 'これは Slack のトークンです。' };
  }
  if (key.startsWith('AIza')) return { ok: false, note: 'これは Google API のキーです。' };
  return { ok: false, note: `見覚えのない接頭辞です（先頭4文字: ${key.slice(0, 4)}）。` };
}

async function main() {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    console.error('✗ OPENAI_API_KEY が設定されていません。');
    console.error('  GitHub → Settings → Secrets and variables → Actions で登録してください。');
    process.exit(1);
  }

  console.log(`キーの長さ: ${key.length}文字`);
  const shape = describeKeyShape(key);
  console.log(`${shape.ok ? '✓' : '✗'} 形式: ${shape.note}`);
  if (!shape.ok) {
    console.error('');
    console.error('OpenAI のキーは platform.openai.com で取得します。');
    console.error('ChatGPT Enterprise の契約とは別組織・別課金です。');
    process.exit(1);
  }

  let response;
  try {
    response = await fetch(MODELS_URL, { headers: { authorization: `Bearer ${key}` } });
  } catch (error) {
    console.error(`✗ 接続できませんでした: ${error.message}`);
    process.exit(1);
  }

  const body = await response.text();

  if (response.status === 401) {
    console.error('✗ 401 Unauthorized: キーが無効か、失効しています。');
    process.exit(1);
  }
  if (response.status === 429) {
    console.error('✗ 429: キーは有効ですが、利用枠がありません。');
    console.error('  組織の支払方法の登録、またはプロジェクトの上限設定を確認してください。');
    process.exit(1);
  }
  if (!response.ok) {
    // エラー本文にキーは含まれないが、長い応答は切る
    console.error(`✗ HTTP ${response.status}: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  console.log('✓ 認証できました。');

  let ids = [];
  try {
    ids = (JSON.parse(body).data ?? []).map((model) => model.id);
  } catch {
    console.warn('[警告] モデル一覧を解釈できませんでしたが、認証自体は成功しています。');
  }

  console.log(`  利用できるモデル: ${ids.length}件`);

  if (ids.length > 0) {
    if (ids.includes(TARGET_MODEL)) {
      console.log(`✓ 使用予定のモデル ${TARGET_MODEL} が利用できます。`);
    } else {
      // 使えるモデルはプロジェクト設定で制限できるため、ここは警告に留める
      console.warn(`[警告] ${TARGET_MODEL} が一覧にありません。`);
      console.warn('  プロジェクトのモデル制限を確認するか、BRIEFING_MODEL を変更してください。');
      const candidates = ids.filter((id) => id.startsWith('gpt-')).slice(0, 8);
      if (candidates.length > 0) console.warn(`  利用できる候補: ${candidates.join(', ')}`);
    }
  }

  console.log('');
  console.log('この確認ではトークンを消費していません。');
}

main().catch((error) => {
  console.error(`✗ 想定外の失敗: ${error.message}`);
  process.exit(1);
});
