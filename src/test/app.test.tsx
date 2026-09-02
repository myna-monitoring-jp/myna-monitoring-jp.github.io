import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '@/App';
import { NOW, daysAgo, makeDataset, makeFullDataset, makeIncident, makeNews, makePR } from '@/test/fixtures';
import { stubClipboard, stubExecCommand } from '@/test/clipboard';
import { STATUS_META, STATUS_ORDER } from '@/lib/statusLabels';
import type { MonitoringDataset } from '@/types/monitoring';

function renderApp(dataset: MonitoringDataset, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App initialDataset={dataset} now={NOW} />
    </MemoryRouter>,
  );
}

/** 必須テスト 4: 3カテゴリー切替 */
describe('不具合の3カテゴリー切替', () => {
  it('3つのタブがあり、既定は自治体・保険者', () => {
    renderApp(makeFullDataset(), '/incidents');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /自治体・保険者/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('incident-panel')).toHaveAttribute(
      'data-category',
      'local_government_insurer',
    );
  });

  it('共通システムタブに切り替えると該当案件だけを表示する', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/incidents');

    await user.click(screen.getByRole('tab', { name: /オン資・マイナポータル等/ }));

    expect(screen.getByTestId('incident-panel')).toHaveAttribute('data-category', 'common_system');
    const rows = screen.getAllByTestId('incident-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-item-id', 'incident-system');
  });

  it('医療IT・サイバータブに切り替えられる', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/incidents');

    await user.click(screen.getByRole('tab', { name: /医療IT・サイバー/ }));

    const rows = screen.getAllByTestId('incident-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-item-id', 'incident-cyber');
  });

  it('URLのcategoryパラメータで直接そのタブを開ける（共有可能な深いリンク）', () => {
    renderApp(makeFullDataset(), '/incidents?category=medical_it_cyber');
    expect(screen.getByRole('tab', { name: /医療IT・サイバー/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('不正なcategory値は既定タブにフォールバックする', () => {
    renderApp(makeFullDataset(), '/incidents?category=nonexistent');
    expect(screen.getByTestId('incident-panel')).toHaveAttribute(
      'data-category',
      'local_government_insurer',
    );
  });

  it('カテゴリーをまたいだ案件が混ざらない', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/incidents');

    expect(screen.getByText('テスト市')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /医療IT・サイバー/ }));
    expect(screen.queryByText('テスト市')).not.toBeInTheDocument();
  });
});

/** 必須テスト 5: 広報3分類 */
describe('広報の3分類', () => {
  it('3つの列が並び、それぞれに正しい案件が入る', () => {
    renderApp(makeFullDataset(), '/pr');

    const columns = screen.getAllByTestId('pr-column');
    expect(columns).toHaveLength(3);
    expect(columns.map((c) => c.dataset.classification)).toEqual([
      'reported_backlash',
      'active_watch',
      'active_stable',
    ]);

    expect(within(columns[0]).getByText(/炎上したタイアップ/)).toBeInTheDocument();
    expect(within(columns[1]).getByText(/掲載中の広告/)).toBeInTheDocument();
    expect(within(columns[2]).getByText(/反応のない広報/)).toBeInTheDocument();
    expect(within(columns[2]).getByText(/好評な広報/)).toBeInTheDocument();
  });

  it('「反応未検知」と「ポジティブ」をバッジで区別する', () => {
    renderApp(makeFullDataset(), '/pr');

    const quiet = screen.getByText(/反応のない広報/).closest('[data-testid="pr-item"]')!;
    const positive = screen.getByText(/好評な広報/).closest('[data-testid="pr-item"]')!;

    expect(quiet).toHaveAttribute('data-stable-subtype', 'quiet');
    expect(within(quiet as HTMLElement).getByText('反応未検知')).toBeInTheDocument();

    expect(positive).toHaveAttribute('data-stable-subtype', 'positive');
    expect(within(positive as HTMLElement).getByText('好意的反応・効果を確認')).toBeInTheDocument();
  });

  it('分類フィルターで1列に絞り込める', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/pr');

    await user.selectOptions(screen.getByLabelText('広報分類で絞り込む'), 'reported_backlash');

    const columns = screen.getAllByTestId('pr-column');
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveAttribute('data-classification', 'reported_backlash');
  });

  it('「安定の内訳」でポジティブだけを表示できる', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/pr');

    await user.selectOptions(screen.getByLabelText('安定案件の内訳で絞り込む'), 'positive');

    const items = screen.getAllByTestId('pr-item');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute('data-stable-subtype', 'positive');
  });

  it('URLパラメータで特定の分類を共有できる', () => {
    renderApp(makeFullDataset(), '/pr?classification=active_watch');
    const columns = screen.getAllByTestId('pr-column');
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveAttribute('data-classification', 'active_watch');
  });
});

/** 必須テスト 3（画面側）: 状態フィルター */
describe('状態フィルターの画面動作', () => {
  it('要注視だけを表示できる', async () => {
    const user = userEvent.setup();
    const dataset = makeDataset({
      news: [
        makeNews({ id: 'a', title: '要注視の記事', status: 'attention' }),
        makeNews({ id: 'b', title: '解消済の記事', status: 'resolved' }),
      ],
    });
    renderApp(dataset, '/news');

    expect(screen.getAllByTestId('news-card')).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText('状態で絞り込む'), 'attention');

    const cards = screen.getAllByTestId('news-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute('data-item-id', 'a');
    expect(screen.getByTestId('result-count')).toHaveTextContent('1件');
  });

  it('絞り込み解除で全件に戻る', async () => {
    const user = userEvent.setup();
    const dataset = makeDataset({
      news: [
        makeNews({ id: 'a', status: 'attention' }),
        makeNews({ id: 'b', status: 'resolved' }),
      ],
    });
    renderApp(dataset, '/news');

    await user.selectOptions(screen.getByLabelText('状態で絞り込む'), 'attention');
    expect(screen.getAllByTestId('news-card')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '絞り込みを解除' }));
    expect(screen.getAllByTestId('news-card')).toHaveLength(2);
  });

  it('一致しない場合は空表示になる', async () => {
    const user = userEvent.setup();
    renderApp(makeDataset({ news: [makeNews({ status: 'new' })] }), '/news');

    await user.selectOptions(screen.getByLabelText('状態で絞り込む'), 'resolved');

    expect(screen.queryAllByTestId('news-card')).toHaveLength(0);
    expect(screen.getByText(/条件に一致するニュースはありません/)).toBeInTheDocument();
  });
});

/** 必須テスト 1・2（画面側）: 7日ルール と pinned */
describe('ダッシュボードの掲載ルール（画面）', () => {
  it('7日超の案件はダッシュボードから消え、アーカイブに残る', () => {
    const dataset = makeDataset({
      news: [
        makeNews({ id: 'fresh', title: '掲載中ニュース', lastMaterialUpdateAt: daysAgo(1) }),
        makeNews({ id: 'stale', title: '沈静化ニュース', lastMaterialUpdateAt: daysAgo(20) }),
      ],
    });

    const { unmount } = renderApp(dataset, '/');
    expect(screen.getByText('掲載中ニュース')).toBeInTheDocument();
    expect(screen.queryByText('沈静化ニュース')).not.toBeInTheDocument();
    unmount();

    renderApp(dataset, '/archive');
    const tile = screen.getAllByTestId('archive-tile')[0];
    expect(tile).toHaveTextContent('沈静化ニュース');
    expect(within(tile).getByTestId('archive-flow')).toHaveTextContent('沈静化');
  });

  it('pinned な古い案件はダッシュボードに残る', () => {
    renderApp(makeFullDataset(), '/');
    expect(screen.getByText('ピン留めされた古いニュース')).toBeInTheDocument();
  });

  it('詳細ページには7日超の案件も表示される', () => {
    renderApp(makeFullDataset(), '/news');
    expect(screen.getByText('沈静化したニュース')).toBeInTheDocument();
  });

  it('詳細ページで非表示理由を文章で説明する', () => {
    renderApp(makeFullDataset(), '/news');
    expect(screen.getAllByTestId('visibility-note')[0]).toHaveTextContent(/基準7日/);
  });
});

/** 必須テスト 9: 空データ時表示 */
describe('空データ時の表示', () => {
  const empty = makeDataset({ dataset: 'live', dataUpdate: { state: 'ok' } });

  it('ダッシュボードが空でも案内文を出す', () => {
    renderApp(empty, '/');
    expect(screen.getByText(/ダッシュボード掲載中のトップニュースはありません/)).toBeInTheDocument();
    expect(screen.getByText(/ダッシュボード掲載中の広報案件はありません/)).toBeInTheDocument();
    expect(screen.getByText('直近24時間：新規調査を確認できず')).toBeInTheDocument();
  });

  it('KPIは0件と表示する', () => {
    renderApp(empty, '/');
    expect(screen.getAllByText('0件').length).toBeGreaterThan(0);
  });

  it('不具合一覧が空でも表を壊さない', () => {
    renderApp(empty, '/incidents');
    expect(screen.getByText(/条件に一致する案件はありません/)).toBeInTheDocument();
  });

  it('広報3列は空でも列構造を保つ', () => {
    renderApp(empty, '/pr');
    expect(screen.getAllByTestId('pr-column')).toHaveLength(3);
    expect(screen.getAllByText('該当する案件はありません。')).toHaveLength(3);
  });

  it('アーカイブが空でも案内文を出す', () => {
    renderApp(empty, '/archive');
    expect(screen.getByText(/該当する案件はありません/)).toBeInTheDocument();
    expect(screen.getByText('記録された炎上タイムラインはありません。')).toBeInTheDocument();
    expect(screen.getByText('記録された訂正はありません。')).toBeInTheDocument();
  });
});

/** 必須テスト 10: 訂正履歴表示 */
describe('訂正履歴', () => {
  it('アーカイブに訂正履歴の表を出す', () => {
    renderApp(makeFullDataset(), '/archive');

    const table = screen.getByTestId('corrections-table');
    expect(within(table).getByText('重複計上を訂正。')).toBeInTheDocument();
    expect(within(table).getByText('200人')).toBeInTheDocument();
    expect(within(table).getByText('100人')).toBeInTheDocument();
    expect(within(table).getByText('テスト担当')).toBeInTheDocument();
  });

  it('対象案件のタイトルを解決して表示する', () => {
    renderApp(makeFullDataset(), '/archive');
    expect(within(screen.getByTestId('corrections-table')).getByText('テスト不具合')).toBeInTheDocument();
  });

  it('カード内の訂正履歴も表示する', () => {
    const dataset = makeDataset({
      news: [
        makeNews({
          id: 'n',
          corrections: [
            { correctedAt: '2026-08-31T10:00:00+09:00', reason: 'カード内の訂正理由。' },
          ],
        }),
      ],
    });
    renderApp(dataset, '/news');
    expect(screen.getByText(/カード内の訂正理由。/)).toBeInTheDocument();
  });

  it('カードとデータセット両方の訂正を集約する', () => {
    const dataset = makeDataset({
      corrections: [{ correctedAt: '2026-08-30T10:00:00+09:00', reason: 'データセット全体の訂正。' }],
      news: [
        makeNews({
          id: 'n',
          corrections: [{ correctedAt: '2026-08-31T10:00:00+09:00', reason: '案件個別の訂正。' }],
        }),
      ],
    });
    renderApp(dataset, '/archive');
    const rows = screen.getAllByTestId('correction-row');
    expect(rows).toHaveLength(2);
    // 新しい順
    expect(rows[0]).toHaveTextContent('案件個別の訂正。');
  });
});

/** 必須テスト 7: URLコピー（画面側） */
describe('共有アクション', () => {
  it('共有URLコピーでクリップボードに現在URLを書き込む', async () => {
    // userEvent.setup() installs its own clipboard stub, so override it afterwards.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    renderApp(makeFullDataset(), '/');
    await user.click(screen.getByRole('button', { name: '共有URLをコピー' }));

    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(screen.getByTestId('toast')).toHaveTextContent('共有URLをコピーしました');
  });

  it('Teams投稿文コピーでサマリを書き込む', async () => {
    // userEvent.setup() installs its own clipboard stub, so override it afterwards.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    renderApp(makeFullDataset(), '/');
    await user.click(screen.getByRole('button', { name: 'Teams投稿文をコピー' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('2026/09/01');
    expect(text).toContain('詳細（ダッシュボード）：');
    expect(screen.getByTestId('toast')).toHaveTextContent('自動投稿は行いません');
  });

  it('クリップボードが拒否された場合、共有URLを選択可能なパネルに表示する', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    stubExecCommand(false);

    renderApp(makeFullDataset(), '/');
    await user.click(screen.getByRole('button', { name: '共有URLをコピー' }));

    const panel = screen.getByTestId('copy-panel');
    expect(panel).toHaveAttribute('role', 'dialog');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('copy-text')).toHaveValue(window.location.href);
    expect(panel).toHaveTextContent('選択してコピー');
  });

  it('クリップボードが拒否された場合、Teams投稿文をパネルに表示する', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    stubExecCommand(false);

    renderApp(makeFullDataset(), '/');
    await user.click(screen.getByRole('button', { name: 'Teams投稿文をコピー' }));

    const text = screen.getByTestId('copy-text') as HTMLTextAreaElement;
    expect(text.value).toContain('2026/09/01');
    expect(text.value).toContain('詳細（ダッシュボード）：');
    expect(text).toHaveAttribute('readonly');
    expect(screen.getByTestId('copy-panel')).toHaveTextContent('自動投稿は行いません');
  });

  it('パネルのテキストは開いた時点で全選択されている（Ctrl+Cで即コピーできる）', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    stubExecCommand(false);

    renderApp(makeFullDataset(), '/');
    await user.click(screen.getByRole('button', { name: '共有URLをコピー' }));

    const text = screen.getByTestId('copy-text') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(text);
    expect(text.selectionStart).toBe(0);
    expect(text.selectionEnd).toBe(text.value.length);
  });

  it('パネルは閉じるボタン・Escape・背景クリックで閉じられる', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    stubExecCommand(false);
    renderApp(makeFullDataset(), '/');

    const open = () => user.click(screen.getByRole('button', { name: '共有URLをコピー' }));

    await open();
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByTestId('copy-panel')).not.toBeInTheDocument();

    await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('copy-panel')).not.toBeInTheDocument();

    await open();
    await user.click(screen.getByTestId('copy-overlay'));
    expect(screen.queryByTestId('copy-panel')).not.toBeInTheDocument();
  });

  it('コピー成功時はパネルを出さない', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    renderApp(makeFullDataset(), '/');
    await user.click(screen.getByRole('button', { name: '共有URLをコピー' }));

    expect(screen.queryByTestId('copy-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('toast')).toHaveTextContent('共有URLをコピーしました');
  });
});

describe('データ更新失敗時の表示', () => {
  it('最終正常更新時刻を出す', () => {
    const dataset = makeDataset({
      dataset: 'live',
      dataUpdate: {
        state: 'failed',
        lastSuccessfulUpdateAt: '2026-08-31T11:20:00+09:00',
        message: '取得処理がタイムアウトしました。',
      },
    });
    renderApp(dataset, '/');

    const banner = screen.getByTestId('banner-error');
    expect(banner).toHaveTextContent('データ更新に失敗しています');
    expect(banner).toHaveTextContent('2026/08/31 11:20 JST');
  });

  it('サンプルデータ利用中はバナーで明示する', () => {
    renderApp(makeFullDataset(), '/');
    expect(screen.getByTestId('banner-sample')).toHaveTextContent('サンプルデータを表示しています');
  });

  it('本番データではサンプルバナーを出さない', () => {
    renderApp(makeDataset({ dataset: 'live' }), '/');
    expect(screen.queryByTestId('banner-sample')).not.toBeInTheDocument();
  });
});

describe('国民の声と広報上のリスクの分離', () => {
  it('観測された反応がない場合は「新規の有意な反応は確認できず」を表示する', () => {
    renderApp(makeDataset({ news: [makeNews({ publicVoices: [] })] }), '/news');
    expect(screen.getByTestId('no-reaction')).toHaveTextContent('新規の有意な反応は確認できず');
  });

  it('予測される批判は国民の声ではなく広報上のリスクに出す', () => {
    renderApp(makeFullDataset(), '/news');
    const risks = screen.getByTestId('communication-risks');
    expect(risks).toHaveTextContent('切り抜かれる可能性');
    expect(risks).toHaveTextContent('実際に観測された反応ではありません');
  });

  it('SNSが全国世論でない旨の注記を常に出す', () => {
    renderApp(makeFullDataset(), '/');
    expect(
      screen.getAllByText(/SNSは全国世論を代表するものではありません/).length,
    ).toBeGreaterThan(0);
  });
});

describe('状態ラベル', () => {
  it('ボタンではなくspanで、フォーカスもクリックもできない', () => {
    renderApp(makeFullDataset(), '/');
    const badges = screen.getAllByTestId('status-badge');
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.tagName).toBe('SPAN');
      expect(badge).not.toHaveAttribute('href');
      expect(badge).not.toHaveAttribute('onclick');
      expect(badge).not.toHaveAttribute('tabindex');
      expect(badge.closest('a')).toBeNull();
      expect(badge.closest('button')).toBeNull();
    }
  });

  it('凡例に7状態すべての説明がある', () => {
    renderApp(makeFullDataset(), '/');
    const legend = screen.getByLabelText('状態ラベルの説明');
    for (const label of ['新着', '要注視', '続報待ち', '解消済', '計画停止', '沈静化', 'アーカイブ']) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
  });

  it('状態ラベルは定義済みの7語彙だけを使い、「WATCH」「継続」を使わない', () => {
    const { container } = renderApp(makeFullDataset(), '/');

    const allowed = new Set(STATUS_ORDER.map((status) => STATUS_META[status].label));
    for (const badge of screen.getAllByTestId('status-badge')) {
      const label = (badge.textContent ?? '').replace(/^.*状態：/, '').trim();
      expect(allowed).toContain(label);
      expect(label).not.toBe('WATCH');
      expect(label).not.toBe('継続');
    }

    // 「WATCH」は画面のどこにも出さない。
    expect(container.textContent).not.toContain('WATCH');
    // 「継続」は状態ラベルとしても、タグ・見出しとしても使わない。
    for (const element of container.querySelectorAll('.tag, h1, h2, h3, h4')) {
      expect(element.textContent ?? '').not.toContain('継続');
    }
  });
});

describe('要注視の最上段表示', () => {
  const dataset = makeDataset({
    news: [
      makeNews({ id: 'n1', title: '新着の記事', status: 'new' }),
      makeNews({ id: 'a1', title: '要注視の記事A', status: 'attention' }),
      makeNews({ id: 'f1', title: '続報待ちの記事', status: 'follow_up' }),
      makeNews({ id: 'a2', title: '要注視の記事B', status: 'attention' }),
    ],
  });

  it('要注視だけを最上段の1段に切り出す', () => {
    renderApp(dataset, '/news');

    const band = screen.getByTestId('attention-band');
    expect(band).toHaveTextContent('要注視（2件）');

    const row = screen.getByTestId('attention-row');
    const cards = within(row).getAllByTestId('news-card');
    expect(cards.map((c) => c.dataset.itemId)).toEqual(['a1', 'a2']);
  });

  it('要注視の段はグリッドではなく1段レイアウトになる', () => {
    renderApp(dataset, '/news');
    expect(screen.getByTestId('attention-row')).toHaveClass('row-single');
  });

  it('要注視の段はその他の案件より前に描画される', () => {
    const { container } = renderApp(dataset, '/news');
    const band = screen.getByTestId('attention-band');
    const others = container.querySelector('.grid-2')!;
    expect(band.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('要注視の案件はその他の段に重複して出ない', () => {
    renderApp(dataset, '/news');
    const all = screen.getAllByTestId('news-card');
    expect(all).toHaveLength(4);
    expect(all.filter((c) => c.dataset.itemId === 'a1')).toHaveLength(1);
  });

  it('要注視が無ければ最上段の段自体を出さない', () => {
    renderApp(makeDataset({ news: [makeNews({ status: 'new' })] }), '/news');
    expect(screen.queryByTestId('attention-band')).not.toBeInTheDocument();
  });

  it('ダッシュボードでも要注視が先頭に並ぶ', () => {
    renderApp(dataset, '/');
    const cards = screen.getAllByTestId('news-card');
    expect(cards[0].dataset.itemId).toMatch(/^a/);
    expect(cards[1].dataset.itemId).toMatch(/^a/);
  });
});

describe('アーカイブのタイル表示', () => {
  it('JSONへのリンクを出さない', () => {
    const { container } = renderApp(makeFullDataset(), '/archive');

    expect(screen.queryByText('日別レポート')).not.toBeInTheDocument();
    for (const anchor of container.querySelectorAll('a')) {
      expect(anchor.getAttribute('href') ?? '').not.toMatch(/\.json/);
    }
    expect(container.textContent).not.toContain('日次データを開く');
  });

  it('アーカイブ案件をタイルで並べ、発覚から沈静化の流れを1行で出す', () => {
    const dataset = makeDataset({
      incidents: [
        makeIncident({
          id: 'archived-incident',
          title: '沈静化した不具合',
          status: 'follow_up',
          occurredAt: '2026-08-01T00:00:00+09:00',
          recoveryAt: '2026-08-07T00:00:00+09:00',
          lastMaterialUpdateAt: daysAgo(9),
        }),
      ],
    });
    renderApp(dataset, '/archive');

    const tiles = screen.getAllByTestId('archive-tile');
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveTextContent('沈静化した不具合');

    const flow = within(tiles[0]).getByTestId('archive-flow');
    expect(flow).toHaveTextContent('8/1 発覚');
    expect(flow).toHaveTextContent('8/7 復旧');
    expect(flow).toHaveTextContent('9日間更新なしで沈静化');
  });

  it('タイルに出典リンクを出す（新しいタブ属性つき）', () => {
    renderApp(makeFullDataset(), '/archive');
    const tile = screen.getAllByTestId('archive-tile')[0];
    const link = within(tile).getAllByTestId('external-link')[0];
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('系統名と状態バッジをタイルに出す', () => {
    const dataset = makeDataset({
      incidents: [
        makeIncident({
          id: 'i',
          incidentCategory: 'medical_it_cyber',
          status: 'follow_up',
          lastMaterialUpdateAt: daysAgo(10),
        }),
      ],
    });
    renderApp(dataset, '/archive');
    const tile = screen.getAllByTestId('archive-tile')[0];
    expect(tile).toHaveTextContent('医療IT・サイバー');
    expect(within(tile).getByTestId('status-badge')).toHaveAttribute('data-status', 'quiet');
  });

  it('アーカイブ案件が無ければ案内文を出す', () => {
    renderApp(makeDataset({ news: [makeNews({ lastMaterialUpdateAt: daysAgo(0) })] }), '/archive');
    expect(screen.queryAllByTestId('archive-tile')).toHaveLength(0);
    expect(screen.getByText(/該当する案件はありません/)).toBeInTheDocument();
  });

  it('アーカイブ内検索で絞り込める', async () => {
    const user = userEvent.setup();
    const dataset = makeDataset({
      news: [
        makeNews({ id: 'a', title: '堺市の案件', lastMaterialUpdateAt: daysAgo(10) }),
        makeNews({ id: 'b', title: '弘前市の案件', lastMaterialUpdateAt: daysAgo(10) }),
      ],
    });
    renderApp(dataset, '/archive');
    expect(screen.getAllByTestId('archive-tile')).toHaveLength(2);

    await user.type(screen.getByLabelText('アーカイブ内検索'), '堺市');

    const tiles = screen.getAllByTestId('archive-tile');
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveAttribute('data-item-id', 'a');
  });
});

describe('解説記事・二次情報の欄', () => {
  const commentaryDataset = makeDataset({
    news: [
      makeNews({ id: 'main', title: '本来のニュース', category: 'policy' }),
      makeNews({
        id: 'c-neg',
        title: 'マイナポータル連携はやめた方がいい',
        category: 'commentary',
        polarity: 'negative',
        reviewState: 'unreviewed',
      }),
      makeNews({
        id: 'c-neu',
        title: '資格確認書の交付ルールを整理',
        category: 'commentary',
        polarity: 'neutral',
        reviewState: 'unreviewed',
      }),
      makeNews({
        id: 'c-pos',
        title: 'マイナ保険証の便利な使い方',
        category: 'commentary',
        polarity: 'positive',
        reviewState: 'unreviewed',
      }),
    ],
  });

  it('本文一覧に混ぜず、下部の小タイル欄にまとめる', () => {
    renderApp(commentaryDataset, '/news');

    const cards = screen.getAllByTestId('news-card');
    expect(cards.map((c) => c.dataset.itemId)).toEqual(['main']);

    const tiles = screen.getAllByTestId('commentary-tile');
    expect(tiles.map((t) => t.dataset.itemId)).toEqual(['c-neg', 'c-neu', 'c-pos']);
  });

  it('論調バッジをポジティブ／中立／ネガティブで出す', () => {
    renderApp(commentaryDataset, '/news');
    const tiles = screen.getAllByTestId('commentary-tile');

    expect(tiles[0]).toHaveAttribute('data-tone', 'negative');
    expect(within(tiles[0]).getByTestId('commentary-tone')).toHaveTextContent('ネガティブ');
    expect(within(tiles[1]).getByTestId('commentary-tone')).toHaveTextContent('中立');
    expect(within(tiles[2]).getByTestId('commentary-tone')).toHaveTextContent('ポジティブ');
  });

  it('解説記事欄は本文一覧より後ろに描画される', () => {
    const { container } = renderApp(commentaryDataset, '/news');
    const main = screen.getByTestId('news-card');
    const tiles = container.querySelector('[data-testid="commentary-tiles"]')!;
    expect(main.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('解説記事には未レビューバッジを出さない（欄自体が注記を持つ）', () => {
    renderApp(commentaryDataset, '/news');
    for (const tile of screen.getAllByTestId('commentary-tile')) {
      expect(within(tile).queryByTestId('unreviewed-note')).not.toBeInTheDocument();
    }
    expect(screen.getByText(/論調の判定は自動です/)).toBeInTheDocument();
  });

  it('出典リンクを新しいタブ属性つきで出す', () => {
    renderApp(commentaryDataset, '/news');
    const link = within(screen.getAllByTestId('commentary-tile')[0]).getByTestId('external-link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('ダッシュボードには出さない', () => {
    renderApp(commentaryDataset, '/');
    const cards = screen.getAllByTestId('news-card');
    expect(cards.map((c) => c.dataset.itemId)).toEqual(['main']);
    expect(screen.queryAllByTestId('commentary-tile')).toHaveLength(0);
  });

  it('Teams投稿文にも含めない', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    renderApp(commentaryDataset, '/');
    await user.click(screen.getByRole('button', { name: 'Teams投稿文をコピー' }));

    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('本来のニュース');
    expect(text).not.toContain('やめた方がいい');
  });
});

describe('改修要望ボタン', () => {
  it('全画面の左下にボタンが出る', () => {
    for (const route of ['/', '/news', '/incidents', '/pr', '/archive']) {
      const { unmount } = renderApp(makeFullDataset(), route);
      expect(screen.getByTestId('feedback-fab')).toBeInTheDocument();
      unmount();
    }
  });

  it('押すとフォームが開き、対象画面が自動で選ばれる', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/incidents');

    await user.click(screen.getByTestId('feedback-fab'));

    const dialog = screen.getByTestId('feedback-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('対象画面')).toHaveValue('不具合・エラー詳細');
  });

  it('「こうしたい」が空のうちは投稿リンクを出さない', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/');

    await user.click(screen.getByTestId('feedback-fab'));

    expect(screen.queryByTestId('feedback-submit')).not.toBeInTheDocument();
    expect(screen.getByTestId('feedback-submit-disabled')).toHaveTextContent(
      '「こうしたい」を入力すると投稿できます',
    );
  });

  it('入力するとGitHub Issueの投稿リンクになる（新しいタブ属性つき）', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/news');

    await user.click(screen.getByTestId('feedback-fab'));
    await user.type(screen.getByLabelText(/こうしたい/), '要注視をもっと目立たせたい');

    const submit = screen.getByTestId('feedback-submit');
    expect(submit).toHaveAttribute('target', '_blank');
    expect(submit).toHaveAttribute('rel', 'noopener noreferrer');

    const href = submit.getAttribute('href')!;
    expect(href.startsWith('https://github.com/')).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get('title')).toContain('[改修要望]');
    expect(url.searchParams.get('body')).toContain('要注視をもっと目立たせたい');
    expect(url.searchParams.get('body')).toContain('対象画面：トップニュース・世論');
  });

  it('投稿画面を開いたら完了案内を出す', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/');

    await user.click(screen.getByTestId('feedback-fab'));
    await user.type(screen.getByLabelText(/こうしたい/), 'テスト要望');
    await user.click(screen.getByTestId('feedback-submit'));

    expect(screen.getByTestId('feedback-done')).toHaveTextContent('Submit new issue');
  });

  it('書きかけを保存し、閉じて開き直しても残る', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/');

    await user.click(screen.getByTestId('feedback-fab'));
    await user.type(screen.getByLabelText(/こうしたい/), '途中まで書いた要望');
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByTestId('feedback-dialog')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('feedback-fab'));
    expect(screen.getByLabelText(/こうしたい/)).toHaveValue('途中まで書いた要望');
  });

  it('Escapeと背景クリックで閉じられる', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/');

    await user.click(screen.getByTestId('feedback-fab'));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('feedback-dialog')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('feedback-fab'));
    await user.click(screen.getByTestId('feedback-overlay'));
    expect(screen.queryByTestId('feedback-dialog')).not.toBeInTheDocument();
  });

  it('要望一覧へのリンクを持つ', async () => {
    const user = userEvent.setup();
    renderApp(makeFullDataset(), '/');

    await user.click(screen.getByTestId('feedback-fab'));
    const link = screen.getByTestId('feedback-list-link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('label:改修要望');
  });
});

describe('404の扱い', () => {
  it('未定義のパスでも操作可能な画面を返す', () => {
    renderApp(makeFullDataset(), '/does-not-exist');
    expect(screen.getByText('ページが見つかりません')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ダッシュボードへ戻る' })).toBeInTheDocument();
  });
});

describe('リンク切れの扱い', () => {
  it('active:false の出典はリンクではなく注記にする', () => {
    const dataset = makeDataset({
      news: [
        makeNews({
          sources: [
            { type: 'primary', label: '削除済みページ', url: 'https://example.com/gone', active: false },
          ],
        }),
      ],
    });
    renderApp(dataset, '/news');

    const dead = screen.getAllByTestId('dead-link')[0];
    expect(dead).toHaveTextContent('リンク切れのため参照できません');
    expect(dead.tagName).toBe('SPAN');
  });

  it('不正なURLの出典もリンクにしない', () => {
    const dataset = makeDataset({
      news: [makeNews({ sources: [{ type: 'media', label: '不正URL', url: '#' }] })],
    });
    renderApp(dataset, '/news');
    expect(screen.getAllByTestId('dead-link').length).toBeGreaterThan(0);
  });
});

describe('横断検索', () => {
  it('トップバーの検索がダッシュボードに反映される', async () => {
    const user = userEvent.setup();
    const dataset = makeDataset({
      news: [
        makeNews({ id: 'a', title: '公金受取口座の広告' }),
        makeNews({ id: 'b', title: 'マイナアプリの不具合' }),
      ],
      incidents: [makeIncident({ id: 'i', title: 'サイバー攻撃', status: 'attention' })],
      prItems: [makePR({ id: 'p' })],
    });
    renderApp(dataset, '/');

    await user.type(screen.getByLabelText('サイト内検索'), '公金受取口座');

    const cards = screen.getAllByTestId('news-card');
    expect(cards.map((c) => c.dataset.itemId)).toEqual(['a']);
  });
});
