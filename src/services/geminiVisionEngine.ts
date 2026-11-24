import type { TextRegion } from '../types/slide';
import { sampleRegionColors } from './inpaintEngine';

interface GeminiDetectedBox {
  text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0..1000
  role?: 'title' | 'subtitle' | 'heading' | 'body' | 'caption';
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
}

export async function detectSlideTextWithGemini(
  canvas: HTMLCanvasElement,
  apiKey: string,
  modelName = 'gemini-2.5-flash'
): Promise<TextRegion[]> {
  if (!apiKey.trim()) {
    throw new Error('請先於右上角「API 設定」輸入有效的 Gemini API Key，或切換為本地辨識引擎。');
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const base64Data = dataUrl.split(',')[1];

  const prompt = `Analyze this presentation slide image (such as a NotebookLM / Gemini Notebook slide).
Detect every distinct text block (titles, headings, bullet groups, card descriptions, axis/chart labels, captions).
Return a JSON array of objects where each object has:
- "text": exact string content (preserve line breaks with \\n if multi-line within the same block; do NOT merge separate columns or separate cards)
- "box_2d": [ymin, xmin, ymax, xmax] coordinates normalized to 0..1000
- "role": one of "title", "subtitle", "heading", "body", "caption"
- "align": "left", "center", or "right"
- "bold": boolean`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelName
  )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API 呼叫失敗 (${response.status}): ${errText.slice(0, 180)}`);
  }

  const json = await response.json();
  const rawText: string =
    json?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

  let parsed: GeminiDetectedBox[] = [];
  try {
    const obj = JSON.parse(rawText);
    parsed = Array.isArray(obj) ? obj : Array.isArray(obj?.items) ? obj.items : [];
  } catch {
    throw new Error('無法解析 Gemini Vision 回傳的 JSON 版面結構。');
  }

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx ? ctx.getImageData(0, 0, width, height) : null;
  const slideHeightPt = 540;

  return parsed
    .filter((item) => item && typeof item.text === 'string' && item.text.trim() && Array.isArray(item.box_2d))
    .map((item, idx) => {
      const [ymin, xmin, ymax, xmax] = item.box_2d;
      const x0 = Math.max(0, Math.min(width, (xmin / 1000) * width));
      const y0 = Math.max(0, Math.min(height, (ymin / 1000) * height));
      const x1 = Math.max(x0 + 8, Math.min(width, (xmax / 1000) * width));
      const y1 = Math.max(y0 + 8, Math.min(height, (ymax / 1000) * height));

      const lineCount = Math.max(1, item.text.split('\n').length);
      const estLinePx = (y1 - y0) / lineCount;
      const fontSizePt = Math.max(
        9,
        Math.min(52, Math.round((estLinePx / height) * slideHeightPt * 0.72))
      );

      const sampled = imageData
        ? sampleRegionColors(imageData, x0, y0, x1, y1)
        : { fgHex: '#182026', bgHex: '#FFFFFF', isDarkBg: false };

      const xPct = (x0 / width) * 100;
      const yPct = (y0 / height) * 100;
      const wPct = Math.min(100 - xPct, ((x1 - x0) / width) * 100 + 2);
      const hPct = Math.min(100 - yPct, ((y1 - y0) / height) * 100 + 1);

      return {
        id: `gem-${Date.now()}-${idx}`,
        text: item.text.trim(),
        xPct,
        yPct,
        wPct,
        hPct,
        fontSizePt,
        fontFamily: 'Microsoft JhengHei',
        color: sampled.fgHex,
        bgColor: 'transparent',
        bold: Boolean(item.bold || item.role === 'title' || item.role === 'heading'),
        italic: false,
        align: item.align || 'left',
        role: item.role || 'body',
        confidence: 98,
      };
    });
}
