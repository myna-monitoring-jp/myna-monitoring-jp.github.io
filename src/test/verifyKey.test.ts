// @vitest-environment node
// 子プロセスを起動するため node 環境で実行する。
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * キー検証スクリプトのテスト。
 *
 * 確認したいのは「間違ったものを入れたときに、間違っていると分かるか」。
 * 実際に GitHub のアクセストークンが OPENAI_API_KEY として登録され、
 * 毎朝の生成が丸ごと失敗していたことに気づくのが遅れたため。
 *
 * 外部ネットワークには出ない（形式判定の段階で終了するキーだけを渡す）。
 */

const execFileAsync = promisify(execFile);

async function run(env: Record<string, string | undefined>) {
  try {
    const result = await execFileAsync(process.execPath, ['scripts/verify-openai-key.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, OPENAI_API_KEY: undefined, ...env },
      timeout: 30_000,
    });
    return { code: 0, out: `${result.stdout}${result.stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('OpenAIキーの検証', () => {
  it('未設定なら失敗し、登録場所を案内する', async () => {
    const { code, out } = await run({});
    expect(code).not.toBe(0);
    expect(out).toContain('設定されていません');
    expect(out).toContain('Secrets');
  });

  it('GitHubのアクセストークンを入れたら、それだと指摘する（実際に起きた誤り）', async () => {
    const { code, out } = await run({ OPENAI_API_KEY: 'ghp_exampleTokenValueNotReal0000000000' });
    expect(code).not.toBe(0);
    expect(out).toContain('GitHub のアクセストークン');
    expect(out).toContain('platform.openai.com');
  });

  it('新形式のGitHubトークンも見分ける', async () => {
    const { code, out } = await run({ OPENAI_API_KEY: 'github_pat_exampleValueNotReal0000' });
    expect(code).not.toBe(0);
    expect(out).toContain('GitHub のアクセストークン');
  });

  it('他サービスのキーも見分ける', async () => {
    const slack = await run({ OPENAI_API_KEY: 'xoxb-example-not-real' });
    expect(slack.out).toContain('Slack');
    const google = await run({ OPENAI_API_KEY: 'AIzaExampleNotReal0000' });
    expect(google.out).toContain('Google');
  });

  it('見覚えのない形式は接頭辞を示して止まる', async () => {
    const { code, out } = await run({ OPENAI_API_KEY: 'zzzzUnknownFormat' });
    expect(code).not.toBe(0);
    expect(out).toContain('見覚えのない接頭辞');
  });

  it('キーの中身をログに出さない', async () => {
    const secret = 'ghp_SUPERSECRETVALUE1234567890abcdef';
    const { out } = await run({ OPENAI_API_KEY: secret });
    expect(out).not.toContain(secret);
    expect(out).not.toContain('SUPERSECRETVALUE');
    // 長さと接頭辞4文字までは出してよい（切り分けに必要）
    expect(out).toContain(`${secret.length}文字`);
  });
});
