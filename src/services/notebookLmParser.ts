import type { SlideItem, SlideTable, SlideThemeId, TextRegion } from '../types/slide';

export interface ThemeSpec {
  id: SlideThemeId;
  nameZh: string;
  nameEn: string;
  bgHex: string;
  cardHex: string;
  titleHex: string;
  bodyHex: string;
  mutedHex: string;
  accentHex: string;
}

export const SLIDE_THEMES: Record<SlideThemeId, ThemeSpec> = {
  'editorial-ivory': {
    id: 'editorial-ivory',
    nameZh: '暖白紙感簡報',
    nameEn: 'Editorial Ivory',
    bgHex: '#FAF8F5',
    cardHex: '#F1ECE4',
    titleHex: '#182026',
    bodyHex: '#2F3B46',
    mutedHex: '#6E7A85',
    accentHex: '#D94E28',
  },
  'slate-executive': {
    id: 'slate-executive',
    nameZh: '深石板商務',
    nameEn: 'Slate Executive',
    bgHex: '#151D26',
    cardHex: '#1F2A36',
    titleHex: '#F4F6F8',
    bodyHex: '#CBD5E1',
    mutedHex: '#8896A6',
    accentHex: '#E59934',
  },
  'forest-research': {
    id: 'forest-research',
    nameZh: '森綠學術研究',
    nameEn: 'Forest Research',
    bgHex: '#F4F7F5',
    cardHex: '#E6EFEA',
    titleHex: '#132A23',
    bodyHex: '#29443B',
    mutedHex: '#607D73',
    accentHex: '#1B7A68',
  },
  'terracotta-studio': {
    id: 'terracotta-studio',
    nameZh: '赤陶設計工作室',
    nameEn: 'Terracotta Studio',
    bgHex: '#F7F1EB',
    cardHex: '#EDE3D8',
    titleHex: '#241914',
    bodyHex: '#43322A',
    mutedHex: '#7D685E',
    accentHex: '#C4452B',
  },
};

function renderThemeBackdrop(
  theme: ThemeSpec,
  variant: 'cover' | 'two-col' | 'standard',
  slideIndex: number,
  totalSlides: number
): string {
  const w = 1600;
  const h = 900;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = theme.bgHex;
  ctx.fillRect(0, 0, w, h);

  if (variant === 'cover') {
    // Left vertical editorial accent bar & subtle bottom panel
    ctx.fillStyle = theme.accentHex;
    ctx.fillRect(96, 170, 10, 290);

    ctx.fillStyle = theme.cardHex;
    ctx.fillRect(0, h - 130, w, 130);

    ctx.fillStyle = theme.accentHex;
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.arc(w - 190, 250, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (variant === 'two-col') {
    // Header accent rule
    ctx.fillStyle = theme.accentHex;
    ctx.fillRect(96, 152, 72, 5);

    // Two clean content cards
    ctx.fillStyle = theme.cardHex;
    roundRect(ctx, 96, 196, 676, 600, 18);
    ctx.fill();
    roundRect(ctx, 828, 196, 676, 600, 18);
    ctx.fill();
  } else {
    // Standard content slide
    ctx.fillStyle = theme.accentHex;
    ctx.fillRect(96, 152, 72, 5);

    ctx.fillStyle = theme.cardHex;
    roundRect(ctx, 96, 196, 1408, 600, 18);
    ctx.fill();
  }

  // Subtle progress bar along bottom edge
  if (totalSlides > 1) {
    ctx.fillStyle = theme.accentHex;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, h - 6, Math.round(((slideIndex + 1) / totalSlides) * w), 6);
    ctx.globalAlpha = 1;
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function stripMdInline(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .trim();
}

interface ParsedSection {
  title: string;
  bullets: string[];
  subCards: { heading: string; points: string[] }[];
  quote?: string;
  table?: { headers: string[]; rows: string[][] };
  notes?: string;
}

export function parseNotebookLmToSlides(
  rawContent: string,
  themeId: SlideThemeId
): SlideItem[] {
  const theme = SLIDE_THEMES[themeId] || SLIDE_THEMES['editorial-ivory'];
  let text = rawContent.trim();

  // Support NotebookLM JSON export if user pastes JSON structure
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsedJson = JSON.parse(text);
      if (Array.isArray(parsedJson)) {
        text = parsedJson
          .map(
            (item, i) =>
              `## ${item.title || item.heading || `重點 ${i + 1}`}\n${
                Array.isArray(item.bullets || item.points)
                  ? (item.bullets || item.points).map((b: string) => `- ${b}`).join('\n')
                  : item.content || item.text || ''
              }`
          )
          .join('\n\n');
      } else if (parsedJson && typeof parsedJson === 'object') {
        const docTitle = parsedJson.title || parsedJson.notebookTitle || 'NotebookLM 簡報';
        const body = Array.isArray(parsedJson.sections || parsedJson.slides || parsedJson.notes)
          ? (parsedJson.sections || parsedJson.slides || parsedJson.notes)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((sec: any, i: number) => {
                const st = sec.title || sec.heading || `章節 ${i + 1}`;
                const sb = Array.isArray(sec.bullets)
                  ? sec.bullets.map((b: string) => `- ${b}`).join('\n')
                  : sec.content || sec.body || '';
                return `## ${st}\n${sb}`;
              })
              .join('\n\n')
          : String(parsedJson.content || '');
        text = `# ${docTitle}\n\n${body}`;
      }
    } catch {
      // Treat as regular Markdown/text
    }
  }

  const lines = text.split(/\r?\n/);
  let deckTitle = '';
  let deckSubtitle = '';
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let currentSubCard: { heading: string; points: string[] } | null = null;
  let tableBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length >= 2 && current) {
      const parsedRows = tableBuffer
        .map((row) =>
          row
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => stripMdInline(c))
        )
        .filter((cells) => !cells.every((c) => /^[-:\s]+$/.test(c)));
      if (parsedRows.length >= 2) {
        current.table = {
          headers: parsedRows[0],
          rows: parsedRows.slice(1),
        };
      }
    }
    tableBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushTable();
      continue;
    }

    if (line.startsWith('|') && line.includes('|')) {
      if (!current) {
        current = { title: '資料對照表', bullets: [], subCards: [] };
        sections.push(current);
      }
      tableBuffer.push(line);
      continue;
    } else {
      flushTable();
    }

    if (/^#\s+/.test(line) && !deckTitle) {
      deckTitle = stripMdInline(line.replace(/^#\s+/, ''));
      continue;
    }

    if (/^##\s+/.test(line) || /^#\s+/.test(line)) {
      currentSubCard = null;
      current = {
        title: stripMdInline(line.replace(/^#{1,2}\s+/, '')),
        bullets: [],
        subCards: [],
      };
      sections.push(current);
      continue;
    }

    if (/^###\s+/.test(line)) {
      if (!current) {
        current = { title: '核心重點整理', bullets: [], subCards: [] };
        sections.push(current);
      }
      currentSubCard = {
        heading: stripMdInline(line.replace(/^###\s+/, '')),
        points: [],
      };
      current.subCards.push(currentSubCard);
      continue;
    }

    if (/^>\s*/.test(line)) {
      const q = stripMdInline(line.replace(/^>\s*/, ''));
      if (!current && !deckSubtitle && deckTitle) {
        deckSubtitle = q;
      } else {
        if (!current) {
          current = { title: '核心洞察摘要', bullets: [], subCards: [] };
          sections.push(current);
        }
        current.quote = current.quote ? `${current.quote}\n${q}` : q;
      }
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*•▪]|\d+[.)、])\s+(.*)$/);
    if (bulletMatch) {
      const itemText = stripMdInline(bulletMatch[1]);
      if (!current) {
        current = { title: deckTitle || '重點摘要', bullets: [], subCards: [] };
        sections.push(current);
      }
      if (currentSubCard) {
        currentSubCard.points.push(itemText);
      } else {
        current.bullets.push(itemText);
      }
      continue;
    }

    // Plain paragraph line
    if (!deckTitle) {
      deckTitle = stripMdInline(line).slice(0, 60);
    } else if (!current && !deckSubtitle && sections.length === 0) {
      deckSubtitle = stripMdInline(line);
    } else {
      if (!current) {
        current = { title: '內容摘要', bullets: [], subCards: [] };
        sections.push(current);
      }
      if (currentSubCard) {
        currentSubCard.points.push(stripMdInline(line));
      } else {
        current.bullets.push(stripMdInline(line));
      }
    }
  }
  flushTable();

  // Split sections that have > 6 bullets into clean continuation slides so text never overflows
  const expandedSections: ParsedSection[] = [];
  for (const sec of sections) {
    if (sec.bullets.length > 6 && sec.subCards.length === 0 && !sec.table) {
      for (let i = 0; i < sec.bullets.length; i += 5) {
        expandedSections.push({
          title: i === 0 ? sec.title : `${sec.title}（續）`,
          bullets: sec.bullets.slice(i, i + 5),
          subCards: [],
          quote: i === 0 ? sec.quote : undefined,
        });
      }
    } else {
      expandedSections.push(sec);
    }
  }

  const totalSlideCount = (deckTitle ? 1 : 0) + Math.max(1, expandedSections.length);
  const slides: SlideItem[] = [];
  let slideIdx = 0;

  // 1. Cover Slide
  if (deckTitle) {
    const bgUrl = renderThemeBackdrop(theme, 'cover', slideIdx, totalSlideCount);
    const coverRegions: TextRegion[] = [
      {
        id: `md-cover-tag-${Date.now()}`,
        text: 'NOTEBOOKLM BRIEFING DECK',
        xPct: 7.5,
        yPct: 19,
        wPct: 60,
        hPct: 5,
        fontSizePt: 11,
        fontFamily: 'Microsoft JhengHei',
        color: theme.accentHex,
        bgColor: 'transparent',
        bold: true,
        italic: false,
        align: 'left',
        role: 'caption',
      },
      {
        id: `md-cover-title-${Date.now()}`,
        text: deckTitle,
        xPct: 7.5,
        yPct: 26,
        wPct: 82,
        hPct: 22,
        fontSizePt: 36,
        fontFamily: 'Microsoft JhengHei',
        color: theme.titleHex,
        bgColor: 'transparent',
        bold: true,
        italic: false,
        align: 'left',
        role: 'title',
      },
      {
        id: `md-cover-sub-${Date.now()}`,
        text:
          deckSubtitle ||
          `共 ${expandedSections.length} 個核心章節 · 由 SlideUnlock 自動轉換為可編輯簡報`,
        xPct: 7.5,
        yPct: 51,
        wPct: 76,
        hPct: 12,
        fontSizePt: 16,
        fontFamily: 'Microsoft JhengHei',
        color: theme.bodyHex,
        bgColor: 'transparent',
        bold: false,
        italic: false,
        align: 'left',
        role: 'subtitle',
      },
      {
        id: `md-cover-foot-${Date.now()}`,
        text: new Date().toISOString().slice(0, 10),
        xPct: 7.5,
        yPct: 88.5,
        wPct: 40,
        hPct: 5,
        fontSizePt: 11,
        fontFamily: 'Microsoft JhengHei',
        color: theme.mutedHex,
        bgColor: 'transparent',
        bold: false,
        italic: false,
        align: 'left',
        role: 'caption',
      },
    ];

    slides.push({
      id: `md-slide-cover-${Date.now()}`,
      index: slideIdx++,
      included: true,
      widthPx: 1600,
      heightPx: 900,
      aspectRatio: 16 / 9,
      originalDataUrl: bgUrl,
      cleanedDataUrl: bgUrl,
      elements: [],
      backgroundMode: 'cleaned',
      solidBgHex: theme.bgHex,
      regions: coverRegions,
      manualErasePatches: [],
      sourceType: 'notebooklm-md',
    });
  }

  // 2. Content Slides
  const effectiveSections =
    expandedSections.length > 0
      ? expandedSections
      : [{ title: '簡報重點', bullets: ['請在此輸入您的簡報內容'], subCards: [] }];

  for (const sec of effectiveSections) {
    const isTwoCol = sec.subCards.length >= 2;
    const bgUrl = renderThemeBackdrop(
      theme,
      isTwoCol ? 'two-col' : 'standard',
      slideIdx,
      totalSlideCount
    );

    const regions: TextRegion[] = [
      {
        id: `md-h-${Date.now()}-${slideIdx}`,
        text: sec.title,
        xPct: 6,
        yPct: 8.2,
        wPct: 84,
        hPct: 8,
        fontSizePt: 25,
        fontFamily: 'Microsoft JhengHei',
        color: theme.titleHex,
        bgColor: 'transparent',
        bold: true,
        italic: false,
        align: 'left',
        role: 'heading',
      },
      {
        id: `md-pg-${Date.now()}-${slideIdx}`,
        text: `${slideIdx + 1} / ${totalSlideCount}`,
        xPct: 88,
        yPct: 91,
        wPct: 8,
        hPct: 4,
        fontSizePt: 10,
        fontFamily: 'Microsoft JhengHei',
        color: theme.mutedHex,
        bgColor: 'transparent',
        bold: false,
        italic: false,
        align: 'right',
        role: 'caption',
      },
    ];

    const tables: SlideTable[] = [];

    if (isTwoCol) {
      const leftCard = sec.subCards[0];
      const rightCard = sec.subCards[1];
      const extraPoints = sec.subCards
        .slice(2)
        .flatMap((c) => [`【${c.heading}】`, ...c.points]);

      regions.push(
        {
          id: `md-c1-h-${Date.now()}-${slideIdx}`,
          text: leftCard.heading,
          xPct: 8,
          yPct: 24.5,
          wPct: 38,
          hPct: 6.5,
          fontSizePt: 18,
          fontFamily: 'Microsoft JhengHei',
          color: theme.accentHex,
          bgColor: 'transparent',
          bold: true,
          italic: false,
          align: 'left',
          role: 'heading',
        },
        {
          id: `md-c1-b-${Date.now()}-${slideIdx}`,
          text: leftCard.points.map((p) => `• ${p}`).join('\n\n'),
          xPct: 8,
          yPct: 33,
          wPct: 38,
          hPct: 50,
          fontSizePt: 14,
          fontFamily: 'Microsoft JhengHei',
          color: theme.bodyHex,
          bgColor: 'transparent',
          bold: false,
          italic: false,
          align: 'left',
          role: 'body',
        },
        {
          id: `md-c2-h-${Date.now()}-${slideIdx}`,
          text: rightCard.heading,
          xPct: 53.8,
          yPct: 24.5,
          wPct: 38,
          hPct: 6.5,
          fontSizePt: 18,
          fontFamily: 'Microsoft JhengHei',
          color: theme.accentHex,
          bgColor: 'transparent',
          bold: true,
          italic: false,
          align: 'left',
          role: 'heading',
        },
        {
          id: `md-c2-b-${Date.now()}-${slideIdx}`,
          text: [...rightCard.points, ...extraPoints].map((p) => `• ${p}`).join('\n\n'),
          xPct: 53.8,
          yPct: 33,
          wPct: 38,
          hPct: 50,
          fontSizePt: 14,
          fontFamily: 'Microsoft JhengHei',
          color: theme.bodyHex,
          bgColor: 'transparent',
          bold: false,
          italic: false,
          align: 'left',
          role: 'body',
        }
      );
    } else if (sec.table) {
      tables.push({
        id: `md-tbl-${Date.now()}-${slideIdx}`,
        xPct: 8,
        yPct: 25,
        wPct: 84,
        hPct: sec.bullets.length > 0 ? 40 : 56,
        headers: sec.table.headers,
        rows: sec.table.rows,
      });
      if (sec.bullets.length > 0) {
        regions.push({
          id: `md-tbl-note-${Date.now()}-${slideIdx}`,
          text: sec.bullets.map((b) => `• ${b}`).join('\n'),
          xPct: 8,
          yPct: 69,
          wPct: 84,
          hPct: 16,
          fontSizePt: 13,
          fontFamily: 'Microsoft JhengHei',
          color: theme.bodyHex,
          bgColor: 'transparent',
          bold: false,
          italic: false,
          align: 'left',
          role: 'body',
        });
      }
    } else {
      const combinedBullets = [
        ...sec.bullets,
        ...sec.subCards.flatMap((sc) => [`${sc.heading}：`, ...sc.points]),
      ];

      if (combinedBullets.length > 0) {
        regions.push({
          id: `md-body-${Date.now()}-${slideIdx}`,
          text: combinedBullets.map((b) => `• ${b}`).join('\n\n'),
          xPct: 8.5,
          yPct: 25,
          wPct: 83,
          hPct: sec.quote ? 42 : 56,
          fontSizePt: combinedBullets.length <= 4 ? 16 : 14,
          fontFamily: 'Microsoft JhengHei',
          color: theme.bodyHex,
          bgColor: 'transparent',
          bold: false,
          italic: false,
          align: 'left',
          role: 'body',
        });
      }

      if (sec.quote) {
        regions.push({
          id: `md-quote-${Date.now()}-${slideIdx}`,
          text: `「${sec.quote}」`,
          xPct: 8.5,
          yPct: combinedBullets.length > 0 ? 71 : 32,
          wPct: 83,
          hPct: 13,
          fontSizePt: 15,
          fontFamily: 'Microsoft JhengHei',
          color: theme.accentHex,
          bgColor: 'transparent',
          bold: true,
          italic: true,
          align: 'left',
          role: 'subtitle',
        });
      }
    }

    slides.push({
      id: `md-slide-${Date.now()}-${slideIdx}`,
      index: slideIdx++,
      included: true,
      widthPx: 1600,
      heightPx: 900,
      aspectRatio: 16 / 9,
      originalDataUrl: bgUrl,
      cleanedDataUrl: bgUrl,
      elements: [],
      backgroundMode: 'cleaned',
      solidBgHex: theme.bgHex,
      regions,
      manualErasePatches: [],
      tables: tables.length > 0 ? tables : undefined,
      speakerNotes: sec.quote || undefined,
      sourceType: 'notebooklm-md',
    });
  }

  return slides;
}
