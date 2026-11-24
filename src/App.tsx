import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FileUp,
  Globe,
  KeyRound,
  Layers,
  Moon,
  Sparkles,
  Sun,
  Wand2,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { ApiKeyModal } from './components/ApiKeyModal';
import { SlideStudio } from './components/SlideStudio';
import { translations, type Locale } from './i18n/translations';
import { parseNotebookLmToSlides, SLIDE_THEMES } from './services/notebookLmParser';
import { processImageFiles, processPdfFile } from './services/pdfProcessor';
import {
  createSampleNotebookLmSlideFiles,
  SAMPLE_NOTEBOOKLM_MARKDOWN,
} from './services/sampleGenerator';
import type {
  ConversionProgress,
  EngineMode,
  OcrLang,
  SlideItem,
  SlideThemeId,
} from './types/slide';

type InputTab = 'pdf-image' | 'notes-md';

const STORAGE_GEMINI_KEY = 'slideunlock_gemini_api_key';

export function App() {
  const [locale, setLocale] = useState<Locale>('zh-Hant');
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<InputTab>('pdf-image');

  // Engine & OCR state
  const [engineMode, setEngineMode] = useState<EngineMode>('auto');
  const [ocrLang, setOcrLang] = useState<OcrLang>('chi_tra+eng');
  const [geminiKey, setGeminiKey] = useState<string>(
    () => localStorage.getItem(STORAGE_GEMINI_KEY) || ''
  );
  const [apiModalOpen, setApiModalOpen] = useState(false);

  // NotebookLM Markdown mode state
  const [markdownInput, setMarkdownInput] = useState<string>(SAMPLE_NOTEBOOKLM_MARKDOWN);
  const [themeId, setThemeId] = useState<SlideThemeId>('editorial-ivory');

  // Upload & Studio state
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<ConversionProgress>({
    active: false,
    currentSlide: 0,
    totalSlides: 0,
    stageLabel: '',
    percent: 0,
  });
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [deckName, setDeckName] = useState<string>('NotebookLM-Presentation');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mdFileInputRef = useRef<HTMLInputElement | null>(null);
  const t = translations[locale];

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh-Hant' ? 'zh-Hant' : 'en';
  }, [locale]);

  const handleSaveApiKey = (key: string) => {
    setGeminiKey(key);
    if (key) {
      localStorage.setItem(STORAGE_GEMINI_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_GEMINI_KEY);
    }
  };

  const handleIncomingFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setErrorBanner(null);

    const first = arr[0];
    const lower = first.name.toLowerCase();

    // Auto-route Markdown / TXT / JSON NotebookLM exports
    if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.json')) {
      const text = await first.text();
      setMarkdownInput(text);
      setDeckName(first.name.replace(/\.[^/.]+$/, ''));
      const parsedSlides = parseNotebookLmToSlides(text, themeId);
      setSlides(parsedSlides);
      return;
    }

    if (engineMode === 'gemini' && !geminiKey.trim()) {
      setApiModalOpen(true);
      setErrorBanner(
        locale === 'zh-Hant'
          ? '您選擇了 Gemini Vision AI 模式，請先輸入您的 Gemini API Key，或切換為本地辨識引擎。'
          : 'Please enter your Gemini API Key for Gemini Vision mode, or switch to the local OCR engine.'
      );
      return;
    }

    try {
      setDeckName(first.name.replace(/\.[^/.]+$/, ''));
      setProgress({
        active: true,
        currentSlide: 1,
        totalSlides: arr.length,
        stageLabel: locale === 'zh-Hant' ? '正在初始化本地轉檔引擎...' : 'Initializing local engine...',
        percent: 4,
      });

      if (lower.endsWith('.pdf') || first.type === 'application/pdf') {
        const result = await processPdfFile(first, {
          engineMode,
          ocrLang,
          geminiApiKey: geminiKey,
          onProgress: setProgress,
        });
        setSlides(result);
      } else {
        const imageFiles = arr.filter(
          (f) =>
            f.type.startsWith('image/') ||
            /\.(png|jpe?g|webp|bmp)$/i.test(f.name)
        );
        if (imageFiles.length === 0) {
          throw new Error(
            locale === 'zh-Hant'
              ? '不支援的檔案格式。請上傳 PDF、PNG、JPG、WebP 或 .md / .txt 筆記檔。'
              : 'Unsupported file format. Please upload PDF, PNG, JPG, WebP, or .md / .txt.'
          );
        }
        const result = await processImageFiles(imageFiles, {
          engineMode,
          ocrLang,
          geminiApiKey: geminiKey,
          onProgress: setProgress,
        });
        setSlides(result);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress((prev) => ({ ...prev, active: false }));
    }
  };

  const handleTrySampleDeck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setErrorBanner(null);
    const sampleFiles = await createSampleNotebookLmSlideFiles();
    await handleIncomingFiles(sampleFiles);
  };

  const handleGenerateFromMarkdown = () => {
    setErrorBanner(null);
    if (!markdownInput.trim()) {
      setErrorBanner(
        locale === 'zh-Hant' ? '請先輸入或貼上筆記與大綱內容。' : 'Please enter Markdown or note content first.'
      );
      return;
    }
    const generated = parseNotebookLmToSlides(markdownInput, themeId);
    setDeckName('NotebookLM-Briefing');
    setSlides(generated);
  };

  return (
    <div className="app-shell">
      {/* Sticky Header */}
      <header className="topbar">
        <div className="topbar-inner">
          <a
            href="#top"
            className="brand-group"
            onClick={(e) => {
              e.preventDefault();
              setSlides([]);
            }}
            id="link-brand-home"
          >
            <span className="brand-mark" aria-hidden="true">
              <Layers size={17} />
            </span>
            <span>
              <span className="brand-title">SlideUnlock</span>
              <span className="brand-subtitle">{t.brandSubtitle}</span>
            </span>
          </a>

          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setApiModalOpen(true)}
              id="btn-open-api-modal"
            >
              <KeyRound size={14} />
              {t.apiKeyBtn}
              {geminiKey ? ' ✓' : ''}
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setLocale((l) => (l === 'zh-Hant' ? 'en' : 'zh-Hant'))}
              id="btn-toggle-locale"
            >
              <Globe size={14} />
              {locale === 'zh-Hant' ? 'EN' : '繁體中文'}
            </button>

            <button
              type="button"
              className="icon-btn"
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Toggle color theme"
              id="btn-toggle-theme"
            >
              {darkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <a
              href="https://github.com/zhijaysun0915/notebooklm-pdf-to-pptx"
              target="_blank"
              rel="noreferrer"
              className="icon-btn"
              aria-label="GitHub Repository"
              id="link-github-repo"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content: Either Interactive Slide Studio or Converter Home */}
      {slides.length > 0 ? (
        <SlideStudio
          locale={locale}
          deckName={deckName}
          slides={slides}
          onChangeSlides={setSlides}
          onBack={() => setSlides([])}
        />
      ) : (
        <main className="home-main">
          <section className="hero-header">
            <div className="hero-eyebrow">{t.heroEyebrow}</div>
            <h1>{t.heroTitle}</h1>
            <p className="hero-lead">{t.heroLead}</p>
          </section>

          {/* Input Mode Switcher */}
          <div className="mode-bar-wrap">
            <div className="segmented-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'pdf-image'}
                className={`segmented-tab ${activeTab === 'pdf-image' ? 'active' : ''}`}
                onClick={() => setActiveTab('pdf-image')}
                id="tab-pdf-image"
              >
                <FileSpreadsheet size={16} />
                {t.tabPdfImage}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'notes-md'}
                className={`segmented-tab ${activeTab === 'notes-md' ? 'active' : ''}`}
                onClick={() => setActiveTab('notes-md')}
                id="tab-notes-md"
              >
                <FileText size={16} />
                {t.tabNotesMd}
              </button>
            </div>
          </div>

          {/* Converter Surface */}
          <section className="converter-surface" aria-label="Converter Workspace">
            {activeTab === 'pdf-image' ? (
              <>
                <div className="engine-toolbar">
                  <div className="toolbar-group">
                    <label className="field-inline" htmlFor="select-engine-mode">
                      <span>{t.engineLabel}：</span>
                      <select
                        id="select-engine-mode"
                        className="select-control"
                        value={engineMode}
                        onChange={(e) => setEngineMode(e.target.value as EngineMode)}
                      >
                        <option value="auto">{t.engineAuto}</option>
                        <option value="ocr">{t.engineOcr}</option>
                        <option value="gemini">{t.engineGemini}</option>
                      </select>
                    </label>

                    {engineMode !== 'gemini' && (
                      <label className="field-inline" htmlFor="select-ocr-lang">
                        <span>{t.ocrLangLabel}：</span>
                        <select
                          id="select-ocr-lang"
                          className="select-control"
                          value={ocrLang}
                          onChange={(e) => setOcrLang(e.target.value as OcrLang)}
                        >
                          <option value="chi_tra+eng">繁體中文 + English</option>
                          <option value="chi_sim+eng">简体中文 + English</option>
                          <option value="jpn+eng">日本語 + English</option>
                          <option value="eng">English Only</option>
                        </select>
                      </label>
                    )}
                  </div>

                  <span className="badge-tag badge-teal">
                    <CheckCircle2 size={13} />
                    {locale === 'zh-Hant' ? '零檔案上傳 · 離線可用' : 'Zero Server Upload'}
                  </span>
                </div>

                <div
                  className={`dropzone ${isDragging ? 'dragging' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files?.length) {
                      handleIncomingFiles(e.dataTransfer.files);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  id="upload-dropzone"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.txt,.json,application/pdf,image/*"
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        handleIncomingFiles(e.target.files);
                        e.target.value = '';
                      }
                    }}
                    id="file-upload-input"
                  />

                  <div className="dropzone-icon-box">
                    <FileUp size={26} />
                  </div>
                  <h2 className="dropzone-title">{t.dropTitle}</h2>
                  <p className="dropzone-desc">{t.dropDesc}</p>

                  <div className="dropzone-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      disabled={progress.active}
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      id="btn-browse-files"
                    >
                      <FileUp size={17} />
                      {t.browseBtn}
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary btn-lg"
                      disabled={progress.active}
                      onClick={handleTrySampleDeck}
                      id="btn-try-sample-deck"
                    >
                      <Sparkles size={17} />
                      {t.sampleSlideBtn}
                    </button>
                  </div>

                  <div className="dropzone-meta">{t.metaHint}</div>
                </div>
              </>
            ) : (
              <div className="notes-workbench">
                <div className="markdown-editor-col">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <label
                      htmlFor="notebooklm-md-textarea"
                      style={{ fontSize: '0.84rem', fontWeight: 600 }}
                    >
                      {t.mdInputLabel}
                    </label>
                    <div style={{ display: 'flex', gap: '0.45rem' }}>
                      <input
                        ref={mdFileInputRef}
                        type="file"
                        accept=".md,.txt,.json,text/markdown,text/plain"
                        className="sr-only"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            const txt = await f.text();
                            setMarkdownInput(txt);
                            setDeckName(f.name.replace(/\.[^/.]+$/, ''));
                          }
                        }}
                        id="md-file-input"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => mdFileInputRef.current?.click()}
                        id="btn-import-md-file"
                      >
                        {t.uploadMdFileBtn}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setMarkdownInput(SAMPLE_NOTEBOOKLM_MARKDOWN)}
                        id="btn-load-sample-md"
                      >
                        {t.loadSampleMdBtn}
                      </button>
                    </div>
                  </div>

                  <textarea
                    id="notebooklm-md-textarea"
                    className="markdown-textarea"
                    value={markdownInput}
                    onChange={(e) => setMarkdownInput(e.target.value)}
                    placeholder="# 簡報標題&#10;## 第一章重點&#10;- 條列重點一&#10;- 條列重點二"
                  />
                </div>

                <div className="theme-picker-col">
                  <div>
                    <div
                      style={{
                        fontSize: '0.84rem',
                        fontWeight: 700,
                        marginBottom: '0.65rem',
                      }}
                    >
                      {t.themeLabel}
                    </div>
                    <div className="theme-swatch-grid">
                      {Object.values(SLIDE_THEMES).map((thm) => (
                        <button
                          key={thm.id}
                          type="button"
                          className={`theme-swatch-btn ${themeId === thm.id ? 'active' : ''}`}
                          onClick={() => setThemeId(thm.id)}
                          id={`btn-theme-${thm.id}`}
                        >
                          <div
                            className="swatch-preview-bar"
                            style={{ background: thm.bgHex }}
                          >
                            <span
                              className="swatch-dot"
                              style={{ background: thm.accentHex }}
                            />
                            <span
                              style={{
                                height: '5px',
                                width: '48px',
                                borderRadius: '3px',
                                background: thm.titleHex,
                                opacity: 0.85,
                              }}
                            />
                          </div>
                          <span className="swatch-label">
                            {locale === 'zh-Hant' ? thm.nameZh : thm.nameEn}
                          </span>
                        </button>
                      ))}
                    </div>

                    <ul
                      style={{
                        margin: '1rem 0 0',
                        paddingLeft: '1.1rem',
                        fontSize: '0.8rem',
                        color: 'var(--ink-secondary)',
                      }}
                    >
                      <li>
                        {locale === 'zh-Hant'
                          ? '# 主標題自動生成封面頁，## 章節生成內容頁'
                          : '# H1 builds cover slide, ## H2 builds content slides'}
                      </li>
                      <li>
                        {locale === 'zh-Hant'
                          ? '### 子標題自動排版為雙欄對照重點卡'
                          : '### H3 subsections auto-layout into two-column cards'}
                      </li>
                      <li>
                        {locale === 'zh-Hant'
                          ? 'Markdown 表格直接輸出為原生可編輯 PowerPoint 表格'
                          : 'Markdown tables convert to native PowerPoint tables'}
                      </li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    style={{ width: '100%' }}
                    onClick={handleGenerateFromMarkdown}
                    id="btn-generate-md-slides"
                  >
                    <Wand2 size={17} />
                    {t.generateSlidesBtn}
                  </button>
                </div>
              </div>
            )}

            {/* Live Conversion Progress */}
            {progress.active && (
              <div className="progress-panel" role="status" aria-live="polite">
                <div className="progress-header">
                  <span>{progress.stageLabel}</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.max(5, progress.percent)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error Alert */}
            {errorBanner && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.8rem 1rem',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--danger-soft)',
                  color: 'var(--danger-primary)',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                }}
                role="alert"
              >
                {errorBanner}
              </div>
            )}
          </section>

          {/* Privacy & Feature Trust Strip */}
          <div className="trust-strip">
            <span className="trust-item">
              <CheckCircle2 size={16} color="var(--teal-primary)" />
              {t.trustLocal}
            </span>
            <span className="trust-item">
              <CheckCircle2 size={16} color="var(--teal-primary)" />
              {t.trustEditable}
            </span>
            <span className="trust-item">
              <CheckCircle2 size={16} color="var(--teal-primary)" />
              {t.trustWatermark}
            </span>
          </div>

          {/* 3-Step How It Works */}
          <section className="workflow-section">
            <h2 className="section-heading">{t.howTitle}</h2>
            <div className="steps-row">
              <article className="step-item">
                <span className="step-num">STEP 01</span>
                <h3>{t.step1Title}</h3>
                <p>{t.step1Desc}</p>
              </article>
              <article className="step-item">
                <span className="step-num">STEP 02</span>
                <h3>{t.step2Title}</h3>
                <p>{t.step2Desc}</p>
              </article>
              <article className="step-item">
                <span className="step-num">STEP 03</span>
                <h3>{t.step3Title}</h3>
                <p>{t.step3Desc}</p>
              </article>
            </div>
          </section>

          {/* Comparison Table */}
          <section className="workflow-section">
            <h2 className="section-heading">{t.compareTitle}</h2>
            <div className="comparison-wrap">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>{t.colFeature}</th>
                    <th>{t.colOurs}</th>
                    <th>{t.colNative}</th>
                    <th>{t.colTraditional}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{locale === 'zh-Hant' ? '文字可編輯性' : 'Text Editability'}</td>
                    <td>
                      <span className="badge-tag badge-accent">
                        {locale === 'zh-Hant'
                          ? '每個標題與條列皆為獨立文字方塊'
                          : 'Real independent PPTX text boxes'}
                      </span>
                    </td>
                    <td>
                      {locale === 'zh-Hant'
                        ? 'AI 重繪版面，多數區塊仍為圖片'
                        : 'AI-regenerated layout, non-editable elements'}
                    </td>
                    <td>
                      {locale === 'zh-Hant'
                        ? '整頁貼成單張靜態圖片，無法改字'
                        : 'Single flat screenshot per slide'}
                    </td>
                  </tr>
                  <tr>
                    <td>{locale === 'zh-Hant' ? '原始背景與插圖保留' : 'Original Design Preservation'}</td>
                    <td>
                      {locale === 'zh-Hant'
                        ? '雙線性邊界修補去字，100% 保留原構圖與圖表'
                        : 'Full-res inpainted background & charts intact'}
                    </td>
                    <td>
                      {locale === 'zh-Hant' ? '重新生成，與原 PDF 視覺不同' : 'Loses original visual design'}
                    </td>
                    <td>
                      {locale === 'zh-Hant' ? '若疊字會與原圖殘字重疊' : 'Double-layered overlapping text'}
                    </td>
                  </tr>
                  <tr>
                    <td>{locale === 'zh-Hant' ? 'NotebookLM 筆記 / Markdown 支援' : 'NotebookLM Notes / MD'}</td>
                    <td>
                      {locale === 'zh-Hant'
                        ? '直接將學習指南、表格與大綱轉為多版型簡報'
                        : 'Converts Study Guides & MD tables directly'}
                    </td>
                    <td>{locale === 'zh-Hant' ? '有每日生成次數與 20 頁上限' : 'Quota & 20-slide cap'}</td>
                    <td>{locale === 'zh-Hant' ? '不支援' : 'Not supported'}</td>
                  </tr>
                  <tr>
                    <td>{locale === 'zh-Hant' ? '資料隱私與費用' : 'Privacy & Cost'}</td>
                    <td>
                      {locale === 'zh-Hant'
                        ? '100% 瀏覽器本地執行・開源免費無浮水印'
                        : '100% Local in-browser • Free & Open Source'}
                    </td>
                    <td>{locale === 'zh-Hant' ? '雲端運算' : 'Cloud servers'}</td>
                    <td>
                      {locale === 'zh-Hant'
                        ? '需上傳伺服器，免費版常壓浮水印'
                        : 'Uploads files to cloud, paid/watermarked'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}

      {slides.length === 0 && (
        <footer className="footer-bar">
          SlideUnlock Studio — 100% Client-Side NotebookLM &amp; PDF to Editable PowerPoint Converter · MIT Open Source
        </footer>
      )}

      {apiModalOpen && (
        <ApiKeyModal
          locale={locale}
          initialKey={geminiKey}
          onSave={handleSaveApiKey}
          onClose={() => setApiModalOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
