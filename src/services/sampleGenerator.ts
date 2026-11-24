export const SAMPLE_NOTEBOOKLM_MARKDOWN = `# 2026 企業生成式 AI 導入與知識治理指南
> 本簡報摘要彙整自內部技術白皮書與 NotebookLM 研究筆記，聚焦檢索增強生成 (RAG) 與地端隱私架構。

## 核心痛點：為什麼企業知識庫難以落地？
- 非結構化文件佔比超過 78%，傳統關鍵字搜尋無法理解跨部門語意脈絡
- 雲端公有模型存在機密財報與研發藍圖外洩的合規風險
- 模型幻覺問題導致第一線客服與法務團隊不敢直接採用 AI 輸出結果
- 簡報與 PDF 圖表鎖死在靜態像素中，團隊難以二次編輯與在地化改寫

## 雙軌架構對策：檢索精準度 vs 隱私安全
### 混合式語意檢索 (Hybrid RAG)
- 結合 BM25 精確詞頻與多語系向量索引，提升專有名詞命中率達 94%
- 強制要求每一段生成結論附帶原始文件頁碼與段落引用標記
- 針對表格與投影片影像預先執行結構化版面解析

### 瀏覽器與地端優先處理 (Local-First)
- 敏感簡報轉換與 OCR 文字提取直接在員工終端瀏覽器內完成
- 零伺服器檔案留存，徹底消除第三方雲端供應鏈資料外洩風險
- 支援離線快取推論模型，出差或內網隔離環境皆可穩定運作

## 導入效益指標對照
| 評估維度 | 傳統人工整理流程 | 導入 AI 知識工作流 | 改善幅度 |
| --- | --- | --- | --- |
| 單份研究簡報製作時間 | 4.5 小時 | 25 分鐘 | 節省 90% |
| 跨語系技術文件檢索準確率 | 61% | 94% | +33 個百分點 |
| 外部雲端資料上傳量 | 100% 原始檔上傳 | 0 MB (純本機轉換) | 100% 隱私合規 |

## 下一步行動建議
- 第一階段（第 1–2 週）：盤點高價值產品手冊與歷史簡報 PDF，建立標準化 Markdown 知識源
- 第二階段（第 3–4 週）：導入本地端簡報解鎖與自動化摘要工具，賦能業務與講師團隊快速客製教材
> 真正的 AI 生產力不在於一鍵生成不可修改的成品，而在於保留人類專家最後一哩路的精準編輯權。
`;

/**
 * Synthesizes 2 realistic rasterized NotebookLM-style slide PNG blobs (including graphics, cards,
 * Traditional Chinese + English text, and a bottom-right watermark) so users can test real
 * local OCR + background text removal + watermark erasing in 1 click!
 */
export async function createSampleNotebookLmSlideFiles(): Promise<File[]> {
  const files: File[] = [];

  // Slide 1: Cover + KPI Cards + Simulated Watermark
  {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext('2d')!;

    // Warm NotebookLM studio background
    const grad = ctx.createLinearGradient(0, 0, 1600, 900);
    grad.addColorStop(0, '#F7F4EE');
    grad.addColorStop(1, '#EDE6DA');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1600, 900);

    // Decorative graphic shapes on right
    ctx.fillStyle = '#D94E28';
    ctx.fillRect(100, 130, 88, 8);

    ctx.fillStyle = '#E4DDD0';
    ctx.beginPath();
    ctx.roundRect(100, 470, 440, 290, 20);
    ctx.fill();

    ctx.fillStyle = '#1D2730';
    ctx.beginPath();
    ctx.roundRect(580, 470, 440, 290, 20);
    ctx.fill();

    ctx.fillStyle = '#DCE8E5';
    ctx.beginPath();
    ctx.roundRect(1060, 470, 440, 290, 20);
    ctx.fill();

    // Rasterized Text (pixels only — OCR will unlock these!)
    ctx.fillStyle = '#D94E28';
    ctx.font = '700 26px "Noto Sans TC", sans-serif';
    ctx.fillText('AI RESEARCH BRIEFING 2026', 100, 195);

    ctx.fillStyle = '#182026';
    ctx.font = '700 58px "Noto Sans TC", sans-serif';
    ctx.fillText('智慧簡報解鎖與本地端知識工作流', 100, 285);

    ctx.fillStyle = '#475569';
    ctx.font = '400 30px "Noto Sans TC", sans-serif';
    ctx.fillText('將靜態像素投影片還原為 100% 可自由編輯的 PowerPoint 文字方塊', 100, 365);

    // Card 1 Text
    ctx.fillStyle = '#D94E28';
    ctx.font = '700 48px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('100% Local', 140, 565);
    ctx.fillStyle = '#1E293B';
    ctx.font = '600 26px "Noto Sans TC", sans-serif';
    ctx.fillText('瀏覽器本地神經網路辨識', 140, 630);
    ctx.fillStyle = '#475569';
    ctx.font = '400 22px "Noto Sans TC", sans-serif';
    ctx.fillText('機密簡報不離機、免註冊帳號', 140, 680);

    // Card 2 Text (Light text on dark card — tests auto white foreground sampling!)
    ctx.fillStyle = '#F59E0B';
    ctx.font = '700 48px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Clean Bg', 620, 565);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = '600 26px "Noto Sans TC", sans-serif';
    ctx.fillText('雙線性邊界智慧去字修補', 620, 630);
    ctx.fillStyle = '#CBD5E1';
    ctx.font = '400 22px "Noto Sans TC", sans-serif';
    ctx.fillText('完整保留深淺卡片底色與插圖', 620, 680);

    // Card 3 Text
    ctx.fillStyle = '#18776C';
    ctx.font = '700 48px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Editable', 1100, 565);
    ctx.fillStyle = '#132A23';
    ctx.font = '600 26px "Noto Sans TC", sans-serif';
    ctx.fillText('匯出原生 .pptx 文字圖層', 1100, 630);
    ctx.fillStyle = '#335C52';
    ctx.font = '400 22px "Noto Sans TC", sans-serif';
    ctx.fillText('支援 PowerPoint 與 Google 簡報', 1100, 680);

    // Simulated bottom-right NotebookLM watermark
    ctx.fillStyle = '#8C857B';
    ctx.font = '600 20px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('NotebookLM', 1435, 868);

    const blob1 = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    files.push(new File([blob1], 'sample-notebooklm-slide-01.png', { type: 'image/png' }));
  }

  // Slide 2: Infographic Bar Chart + Key Findings
  {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#FAF8F5';
    ctx.fillRect(0, 0, 1600, 900);

    ctx.fillStyle = '#18776C';
    ctx.fillRect(100, 115, 75, 7);

    ctx.fillStyle = '#182026';
    ctx.font = '700 46px "Noto Sans TC", sans-serif';
    ctx.fillText('團隊簡報重製工時與隱私合規分析', 100, 185);

    // Left panel background
    ctx.fillStyle = '#EFECE6';
    ctx.beginPath();
    ctx.roundRect(100, 240, 680, 540, 20);
    ctx.fill();

    // Bar chart graphics on left (visual bars stay untouched in background!)
    const bars = [
      { y: 340, w: 480, color: '#94A3B8' },
      { y: 480, w: 320, color: '#E59934' },
      { y: 620, w: 120, color: '#D94E28' },
    ];
    for (const b of bars) {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.roundRect(150, b.y, b.w, 44, 8);
      ctx.fill();
    }

    ctx.fillStyle = '#1E293B';
    ctx.font = '600 24px "Noto Sans TC", sans-serif';
    ctx.fillText('人工重新排版打字：270 分鐘', 150, 322);
    ctx.fillText('雲端 AI 重新生成版面：95 分鐘', 150, 462);
    ctx.fillText('SlideUnlock 本地轉換微調：3 分鐘', 150, 602);

    // Right bullet points
    ctx.fillStyle = '#D94E28';
    ctx.font = '700 32px "Noto Sans TC", sans-serif';
    ctx.fillText('關鍵實測結論', 850, 305);

    ctx.fillStyle = '#2F3B46';
    ctx.font = '400 27px "Noto Sans TC", sans-serif';
    ctx.fillText('• 保留 100% 原始視覺構圖與資訊圖表細節', 850, 390);
    ctx.fillText('• 每個標題與數據標籤皆獨立為可編輯文字框', 850, 470);
    ctx.fillText('• 內建框選修補橡皮擦，輕鬆移除多餘標記', 850, 550);
    ctx.fillText('• 匯出後可直接套用企業母片字型與品牌色', 850, 630);

    // Simulated bottom-right NotebookLM watermark
    ctx.fillStyle = '#8C857B';
    ctx.font = '600 20px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('NotebookLM', 1435, 868);

    const blob2 = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    files.push(new File([blob2], 'sample-notebooklm-slide-02.png', { type: 'image/png' }));
  }

  return files;
}
