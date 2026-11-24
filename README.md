# SlideUnlock — NotebookLM 投影片、筆記與 PDF 轉可編輯 PowerPoint (.pptx)

> **100% 瀏覽器本地處理 · 零伺服器檔案上傳 · 背景智慧去字修補 · 支援 NotebookLM PDF / 截圖 / Markdown 筆記**

🌐 **線上立即使用 (GitHub Pages Live App)**：  
👉 **[https://zhijaysun0915.github.io/notebooklm-pdf-to-pptx/](https://zhijaysun0915.github.io/notebooklm-pdf-to-pptx/)**

---

## ✨ 為什麼需要這個工具？

Google **NotebookLM（現亦稱 Gemini Notebook）** 產生的簡報匯出檔為**扁平像素圖片型 PDF**——畫面上的標題與項目符號全部都是鎖死的像素，無法在 PowerPoint 或 Google Slides 中直接選取改字；而一般 PDF 轉 PPT 工具只會把整頁貼成單張靜態截圖。

**SlideUnlock** 參考並擴充了 [DeckEdit](https://deckedit.com/zh-Hant) 的核心體驗，完全在您的瀏覽器本地端完成以下工作流：

1. **雙輸入模式支援**：
   - **PDF ／ 投影片圖片轉 PPTX**：支援 `.pdf`、`.png`、`.jpg`、`.webp`（單檔最高 50 頁、支援多張圖片批次合併）。
   - **NotebookLM 筆記 ／ Markdown 轉 PPTX**：直接貼上或匯入 NotebookLM 產生的學習指南 (Study Guide)、簡報摘要 (Briefing Doc)、Markdown 表格或 JSON 筆記，自動排版為封面、雙欄重點卡、條列頁與**原生可編輯 PowerPoint 表格**。
2. **三層智慧文字與版面辨識引擎**：
   - **PDF 原生向量文字提取 (`pdfjs-dist`)**：若 PDF 本身含有文字層，100% 精準讀取座標、字級與段落。
   - **本地神經網路 OCR (`tesseract.js` v7)**：針對 NotebookLM 圖片型 PDF 與截圖，在瀏覽器 WebAssembly 內執行繁體中文 / 簡體中文 / 英文 / 日文辨識，並自動清除中文詞間多餘空白與取樣原始字體色彩。
   - **選填 Gemini Vision AI 高精度模式**：支援使用者填入自己的 Google Gemini API Key（僅儲存於本機 `localStorage`），針對極度複雜的資訊圖表進行結構化區塊偵測。
3. **雙線性邊界智慧去字修補 (Edge-Preserving Background Inpainting)**：
   - 自動分析文字框四周邊界色彩梯度，僅抹除高對比文字筆畫與抗鋸齒邊緣，100% 保留原始投影片的漸層卡片、資訊圖表長條圖與插畫細節。
4. **內建線上投影片編輯器 (Slide Studio)**：
   - 匯出前可直接在網頁上**雙擊改字、拖曳移動、縮放文字框、調整字型／字級／顏色**。
   - **一鍵移除全簡報右下角 NotebookLM 浮水印**。
   - **框選去字修補橡皮擦**：在畫布上拖曳框選任意殘留圖示或雜訊，即時無痕修補背景。
   - 支援匯出原生可編輯 **`.pptx`**（PowerPoint / Google Slides / Keynote 相容）與高解析度 **`.pdf`**。

---

## 🚀 本機開發與建置 (Local Development)

系統需求：Node.js 20+

```bash
# 1. 複製儲存庫
git clone https://github.com/zhijaysun0915/notebooklm-pdf-to-pptx.git
cd notebooklm-pdf-to-pptx

# 2. 安裝相依套件
npm install

# 3. 啟動開發伺服器
npm run dev

# 4. 建置靜態正式版 (輸出至 dist/)
npm run build
```

---

## 🛠️ 技術架構 (Tech Stack)

- **前端框架**：React 19 + TypeScript + Vite 8（純靜態打包，零後端依賴）
- **視覺設計**：Vanilla CSS Design System（支援淺色暖紙感 / 深色石板主題與繁中 / 英文雙語切換）
- **PDF 渲染與文字層解析**：`pdfjs-dist` v6
- **瀏覽器本地 OCR**：`tesseract.js` v7 (`chi_tra`, `chi_sim`, `jpn`, `eng`)
- **PowerPoint 檔案生成**：`pptxgenjs` v4
- **PDF 合成匯出**：`jspdf` v4

---

## 📄 授權條款 (License)

本專案採用 [MIT License](./LICENSE) 開源授權。
