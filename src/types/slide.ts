export type EngineMode = 'auto' | 'ocr' | 'gemini';
export type OcrLang = 'chi_tra+eng' | 'chi_sim+eng' | 'jpn+eng' | 'eng';
export type SlideThemeId = 'editorial-ivory' | 'slate-executive' | 'forest-research' | 'terracotta-studio';

export interface TextRegion {
  id: string;
  text: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  fontSizePt: number;
  fontFamily: string;
  color: string;
  bgColor: string; // 'transparent' or '#RRGGBB'
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  role: 'title' | 'subtitle' | 'heading' | 'body' | 'caption';
  confidence?: number;
}

export interface ErasePatch {
  id: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface SlideTable {
  id: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  headers: string[];
  rows: string[][];
}

export interface SlideItem {
  id: string;
  index: number;
  included: boolean;
  widthPx: number;
  heightPx: number;
  aspectRatio: number;
  originalDataUrl: string;
  cleanedDataUrl: string;
  backgroundMode: 'cleaned' | 'original' | 'solid';
  solidBgHex: string;
  regions: TextRegion[];
  manualErasePatches: ErasePatch[];
  tables?: SlideTable[];
  speakerNotes?: string;
  sourceType: 'pdf-vector' | 'pdf-ocr' | 'image-ocr' | 'gemini-vision' | 'notebooklm-md';
}

export interface ConversionProgress {
  active: boolean;
  currentSlide: number;
  totalSlides: number;
  stageLabel: string;
  percent: number;
}
