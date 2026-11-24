export type EngineMode = 'auto' | 'ocr' | 'gemini';
export type OcrLang = 'v6-small' | 'v6-medium' | 'chi_tra+eng' | 'eng';
export type SlideThemeId = 'editorial-ivory' | 'slate-executive' | 'forest-research' | 'terracotta-studio';
export type SplitGranularity = 'detailed' | 'blocks';

export interface TextRegion {
  id: string;
  text: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  /** Exact original tight pixel bounds (%) used for clean background stroke removal */
  eraseXPct?: number;
  eraseYPct?: number;
  eraseWPct?: number;
  eraseHPct?: number;
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

export interface GraphicElement {
  id: string;
  /** PNG data URL (with transparent exterior background where applicable) */
  dataUrl: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  /** Original cutout position on cleanedDataUrl */
  origXPct: number;
  origYPct: number;
  origWPct: number;
  origHPct: number;
  /** Back-to-front layer order: 1 = outer/mid containers, 2 = sub-cards/icons, 3 = manual slices */
  zIndex: number;
  label?: string;
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
  /** Clean ambient backdrop with segmented GraphicElements also inpainted out */
  baseBackdropDataUrl?: string;
  elements: GraphicElement[];
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
