import path from 'node:path';
import { e2bConnector } from '../connectors/e2b-connector';
import { touchSandbox } from './sandbox-activity-service';
import { sanitizePptFileName, validatePptRenderInstruction } from './ppt-render-instruction-validator';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function shellEscape(value: string) {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string) {
  const relative = path.posix.relative(workspaceRoot.replace(/\/+$/, ''), absolutePath);
  if (!relative || relative.startsWith('..') || path.posix.isAbsolute(relative)) {
    throw new Error('ppt_render_output_path_invalid');
  }
  return relative;
}

export function buildRendererScript() {
  return String.raw`import fs from 'node:fs/promises';
import pptxgen from 'pptxgenjs';

const [inputPath, outputPath, reportPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !reportPath) {
  throw new Error('missing renderer arguments');
}

const raw = await fs.readFile(inputPath, 'utf8');
const instructions = JSON.parse(raw);
const deck = instructions.deck || {};
const theme = instructions.theme || {};
const slides = Array.isArray(instructions.slides) ? instructions.slides : [];
const colorTokens = theme.colorTokens || {};
const warnings = [];
const assetRoot = outputPath.replace(/\/[^/]+$/, '') + '/assets';

function color(value, fallback) {
  const rawValue = String(value || fallback || '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(rawValue) ? rawValue.toUpperCase() : fallback;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function blockText(block) {
  if (!block || typeof block !== 'object') return '';
  if (typeof block.text === 'string') return block.text;
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.items)) return block.items.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
  if (Array.isArray(block.rows)) return block.rows.map((row) => Array.isArray(row) ? row.join(' | ') : String(row || '')).join('\n');
  return '';
}

function normalizeForCompare(value) {
  return text(value).toLowerCase().replace(/[\s　，。！？、,.!?;；:：'"“”‘’（）()【】\[\]-]+/g, '');
}

function isDuplicateText(left, right) {
  const a = normalizeForCompare(left);
  const b = normalizeForCompare(right);
  if (!a || !b) return false;
  return a === b || (a.length >= 8 && b.includes(a)) || (b.length >= 8 && a.includes(b));
}

function contentBlocks(slide) {
  return Array.isArray(slide.contentBlocks) ? slide.contentBlocks : [];
}

function uniqueContentBlocks(blocks, existingTexts, slideIndex) {
  const seen = existingTexts.map(normalizeForCompare).filter(Boolean);
  const result = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const body = blockText(block);
    const normalized = normalizeForCompare(body);
    if (!normalized) continue;
    const duplicated = seen.some((item) => item === normalized || (normalized.length >= 8 && item.includes(normalized)) || (item.length >= 8 && normalized.includes(item)));
    if (duplicated) {
      warnings.push({ slide: slideIndex, code: 'duplicate_text_block_skipped', text: body.slice(0, 80) });
      continue;
    }
    seen.push(normalized);
    result.push(block);
  }
  return result;
}

function imageUrl(slot) {
  return text(slot?.url || slot?.src);
}

function imageSlotsForSlide(slots) {
  const seen = new Set();
  const result = [];
  for (const slot of Array.isArray(slots) ? slots : []) {
    if (!slot || typeof slot !== 'object') continue;
    const url = imageUrl(slot);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    result.push(slot);
  }
  return result;
}

function imageExtension(contentType, url) {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  const path = String(url || '').split('?')[0].toLowerCase();
  if (path.endsWith('.png')) return 'png';
  if (path.endsWith('.webp')) return 'webp';
  if (path.endsWith('.gif')) return 'gif';
  return 'jpg';
}

async function downloadImage(slot, slideIndex) {
  const url = imageUrl(slot);
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'OneCEO PPT Renderer' } });
    if (!response.ok) {
      warnings.push({ slide: slideIndex, code: 'image_download_failed', url, status: response.status });
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) return null;
    const ext = imageExtension(response.headers.get('content-type'), url);
    const filePath = assetRoot + '/slide-' + String(slideIndex || 'x') + '-' + Math.random().toString(36).slice(2) + '.' + ext;
    await fs.writeFile(filePath, bytes);
    return { path: filePath, url, alt: text(slot?.alt || slot?.title) };
  } catch (error) {
    warnings.push({ slide: slideIndex, code: 'image_download_failed', url, message: String(error?.message || error) });
    return null;
  }
}

async function downloadImages(slots, slideIndex, maxCount, usedUrls) {
  const result = [];
  for (const slot of imageSlotsForSlide(slots)) {
    const url = imageUrl(slot);
    if (usedUrls.has(url) && result.length > 0) {
      warnings.push({ slide: slideIndex, code: 'reused_image_skipped', url });
      continue;
    }
    const image = await downloadImage(slot, slideIndex);
    if (!image) continue;
    result.push(image);
    usedUrls.add(url);
    if (result.length >= maxCount) break;
  }
  return result;
}

function addImagePanel(slide, image, box, options = {}) {
  const placeholderColor = options.placeholderColor || 'EEF3F8';
  const borderColor = options.borderColor || 'D0D7DE';
  if (image?.path) {
    slide.addImage({ path: image.path, x: box.x, y: box.y, w: box.w, h: box.h });
    if (image.alt) {
      slide.addText(image.alt, { x: box.x, y: box.y + box.h + 0.05, w: box.w, h: 0.18, fontSize: 6.5, color: options.captionColor || '6B7480', fit: 'shrink' });
    }
    return;
  }
  slide.addShape(pptx.ShapeType.roundRect, {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rectRadius: 0.06,
    fill: { color: placeholderColor },
    line: { color: borderColor, width: 0.8 },
  });
}

function addTextBlock(slide, body, box, options = {}) {
  slide.addText(body, {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fontFace: options.fontFace || sansFont,
    fontSize: options.fontSize || 10.8,
    bold: Boolean(options.bold),
    color: options.color,
    fit: 'shrink',
    breakLine: false,
    valign: options.valign || 'mid',
  });
}

const pptx = new pptxgen();
pptx.layout = String(theme.canvas || '').includes('4:3') ? 'LAYOUT_4X3' : 'LAYOUT_WIDE';
pptx.author = 'OneCEO';
pptx.company = 'OneCEO';
pptx.subject = text(deck.purpose);
pptx.title = text(deck.title);
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: theme.fontSystem?.heading || theme.fontSystem?.serifHeading || theme.fontSystem?.latin || 'Noto Serif SC',
  bodyFontFace: theme.fontSystem?.body || theme.fontSystem?.cjk || 'Noto Sans SC',
  lang: 'zh-CN'
};

const aestheticPresets = {
  'ink-classic': { ink: '0A0A0B', paper: 'F1EFEA', paperTint: 'E8E5DE', inkTint: '18181A', accent: 'C7A46C' },
  'indigo-porcelain': { ink: '0A1F3D', paper: 'F1F3F5', paperTint: 'E4E8EC', inkTint: '152A4A', accent: '75AADB' },
  'forest-ink': { ink: '1A2E1F', paper: 'F5F1E8', paperTint: 'ECE7DA', inkTint: '253D2C', accent: 'A2B58C' },
  'kraft-paper': { ink: '2A1E13', paper: 'EEDFC7', paperTint: 'E0D0B6', inkTint: '3A2A1D', accent: 'B27645' },
  'festival-lantern': { ink: '3A1511', paper: 'FFF4E1', paperTint: 'F7DEC2', inkTint: '5A2119', accent: 'D71920' },
  'temple-night': { ink: '102018', paper: 'F8F1DC', paperTint: 'EAD8B4', inkTint: '183528', accent: 'E5B84C' },
  dune: { ink: '1F1A14', paper: 'F0E6D2', paperTint: 'E3D7BF', inkTint: '2D2620', accent: 'C8A46D' },
};
function looksFestive() {
  const haystack = [
    deck.title,
    deck.topic,
    deck.purpose,
    theme.aestheticPreset,
    theme.visualPreset,
    theme.stylePreset,
    theme.mood,
    theme.visualTone,
  ].map(text).join(' ');
  return /(元宵|春节|新年|灯会|灯笼|民俗|传统|节日|festival|lantern|lunar|new year)/i.test(haystack);
}
const requestedPresetKey = text(theme.aestheticPreset || theme.visualPreset || theme.stylePreset);
const presetKey = looksFestive() && !/(festival|lantern|temple|heritage|lunar)/i.test(requestedPresetKey)
  ? 'festival-lantern'
  : requestedPresetKey || 'ink-classic';
const preset = aestheticPresets[presetKey] || aestheticPresets['ink-classic'];
const primary = color(colorTokens.primary || colorTokens.primaryColor || colorTokens.accent, preset.accent);
const serifFont = theme.fontSystem?.serifHeading || theme.fontSystem?.heading || 'Noto Serif SC';
const sansFont = theme.fontSystem?.body || theme.fontSystem?.cjk || 'Noto Sans SC';
const monoFont = theme.fontSystem?.mono || 'IBM Plex Mono';

function isLongText(value) {
  return normalizeForCompare(value).length > 42 || String(value || '').split(/\n/).length > 2;
}

function blockLines(block) {
  if (!block || typeof block !== 'object') return [];
  if (Array.isArray(block.items)) return block.items.map((item) => text(item)).filter(Boolean);
  const body = blockText(block);
  return body ? body.split(/\n+/).map((line) => text(line)).filter(Boolean) : [];
}

function splitBlocksForColumns(blocks) {
  const usable = blocks.filter((block) => blockText(block));
  if (usable.length >= 2) {
    const midpoint = Math.ceil(usable.length / 2);
    return [usable.slice(0, midpoint), usable.slice(midpoint)];
  }
  const lines = blockLines(usable[0]);
  if (lines.length >= 2) {
    const midpoint = Math.ceil(lines.length / 2);
    return [
      [{ type: 'detail', text: lines.slice(0, midpoint).join('\n') }],
      [{ type: 'detail', text: lines.slice(midpoint).join('\n') }],
    ];
  }
  return [usable, []];
}

function addInsightCards(slide, blocks, colors, options = {}) {
  const x = options.x ?? 0.76;
  const y = options.y ?? 2.14;
  const w = options.w ?? 11.45;
  const cardH = options.cardH ?? 0.9;
  const gap = options.gap ?? 0.22;
  const max = Math.min(blocks.length, options.max ?? 4);
  if (!max) return;
  blocks.slice(0, max).forEach((block, index) => {
    const body = blockText(block);
    const cy = y + index * (cardH + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: cy,
      w,
      h: cardH,
      rectRadius: 0.05,
      fill: { color: colors.softBg, transparency: colors.isDark ? 8 : 0 },
      line: { color: colors.line, transparency: colors.isDark ? 58 : 78, width: 0.55 },
    });
    slide.addShape(pptx.ShapeType.rect, { x, y: cy, w: 0.06, h: cardH, fill: { color: primary }, line: { color: primary, transparency: 100 } });
    slide.addText(body, {
      x: x + 0.24,
      y: cy + 0.14,
      w: w - 0.46,
      h: cardH - 0.22,
      fontFace: sansFont,
      fontSize: isLongText(body) ? 9.4 : 10.8,
      color: colors.fg,
      fit: 'shrink',
      breakLine: false,
    });
  });
}

function visualRoleFor(item, pageType, ordinal) {
  const explicit = text(item.visualRole || item.themeRole || item.tone).toLowerCase().replace(/_/g, '-');
  if (['hero-dark', 'hero-light', 'light', 'dark'].includes(explicit)) return explicit;
  const plan = Array.isArray(theme.rhythmPlan) ? theme.rhythmPlan.find((entry) => Number(entry?.index) === Number(item.index)) : null;
  const planned = text(plan?.visualRole).toLowerCase().replace(/_/g, '-');
  if (['hero-dark', 'hero-light', 'light', 'dark'].includes(planned)) return planned;
  if (pageType === 'cover') return 'hero-dark';
  if (pageType === 'section-divider') return ordinal % 2 === 0 ? 'hero-light' : 'hero-dark';
  if (pageType === 'quote' || text(item.layoutFamily).includes('quote') || text(item.layoutFamily).includes('question')) return ordinal % 2 === 0 ? 'dark' : 'hero-dark';
  return ordinal % 3 === 0 ? 'dark' : 'light';
}

function layoutFamilyFor(item, pageType) {
  const explicit = text(item.layoutFamily || item.layout || item.visualLayout).toLowerCase().replace(/_/g, '-');
  if (explicit) return explicit;
  const n = Number(item.index || 1);
  if (pageType === 'cover') return 'hero-cover';
  if (pageType === 'section-divider') return 'act-divider';
  if (pageType === 'comparison') return 'before-after';
  if (pageType === 'timeline') return 'pipeline';
  if (pageType === 'quote') return 'big-quote';
  if (pageType === 'closing') return 'question';
  if (n % 5 === 0) return 'big-number';
  if (n % 4 === 0) return 'pipeline';
  if (n % 3 === 0) return 'before-after';
  if (n % 2 === 0) return 'quote-image';
  return 'lead-image-side-text';
}

function colorsForRole(role) {
  const isDark = role.includes('dark') || role === 'dark';
  return {
    bg: isDark ? preset.ink : preset.paper,
    softBg: isDark ? preset.inkTint : preset.paperTint,
    fg: isDark ? preset.paper : preset.ink,
    muted: isDark ? preset.paperTint : preset.inkTint,
    line: isDark ? preset.paperTint : preset.inkTint,
    isDark,
  };
}

function addChrome(slide, item, colors, totalSlides) {
  const chrome = item.chrome && typeof item.chrome === 'object' ? item.chrome : {};
  const left = text(chrome.left || item.chromeLeft || deck.title || 'OneCEO');
  const right = text(chrome.right || item.chromeRight || ('VOL · ' + String(item.index || '') + ' / ' + String(totalSlides || '')));
  slide.addText(left, { x: 0.62, y: 0.28, w: 5.5, h: 0.18, fontFace: monoFont, fontSize: 6.4, charSpace: 1.15, color: colors.muted, fit: 'shrink' });
  slide.addText(right, { x: 7.9, y: 0.28, w: 4.8, h: 0.18, fontFace: monoFont, fontSize: 6.4, charSpace: 1.15, color: colors.muted, align: 'right', fit: 'shrink' });
}

function addFooter(slide, item, colors) {
  slide.addText(text(item.footer || deck.audience || ''), { x: 0.62, y: 6.85, w: 6.4, h: 0.18, fontFace: monoFont, fontSize: 6.2, charSpace: 0.8, color: colors.muted, fit: 'shrink' });
  slide.addText(String(item.index || ''), { x: 12.25, y: 6.85, w: 0.45, h: 0.18, fontFace: monoFont, fontSize: 6.2, color: colors.muted, align: 'right' });
}

function addKicker(slide, item, colors, box) {
  const kicker = text(item.kicker || item.eyebrow || item.sectionLabel);
  if (!kicker) return 0;
  slide.addText(kicker.toUpperCase(), { x: box.x, y: box.y, w: box.w, h: 0.22, fontFace: monoFont, fontSize: 7.2, charSpace: 1.35, color: colors.muted, fit: 'shrink' });
  return 0.36;
}

function addSoftTexture(slide, colors, role) {
  slide.background = { color: colors.bg };
  if (role.startsWith('hero')) {
    slide.addShape(pptx.ShapeType.ellipse, { x: 7.6, y: -0.8, w: 5.6, h: 5.6, line: { color: primary, transparency: 100 }, fill: { color: primary, transparency: colors.isDark ? 78 : 88 } });
    slide.addShape(pptx.ShapeType.ellipse, { x: -1.3, y: 4.6, w: 4.6, h: 4.6, line: { color: primary, transparency: 100 }, fill: { color: colors.softBg, transparency: colors.isDark ? 55 : 18 } });
  }
}

await fs.mkdir(assetRoot, { recursive: true });
const usedImageUrls = new Set();

for (const [ordinal, item] of slides.entries()) {
  const slide = pptx.addSlide();
  const pageType = text(item.pageType) || 'content';
  const role = visualRoleFor(item, pageType, ordinal + 1);
  const layoutFamily = layoutFamilyFor(item, pageType);
  const colors = colorsForRole(role);
  const title = text(item.title);
  const coreMessage = text(item.coreMessage);
  const showCoreMessage = coreMessage && !isDuplicateText(coreMessage, title) ? coreMessage : '';
  if (coreMessage && !showCoreMessage) {
    warnings.push({ slide: item.index, code: 'duplicate_core_message_skipped', text: coreMessage.slice(0, 80) });
  }
  const blocks = uniqueContentBlocks(contentBlocks(item), [title, coreMessage], item.index);
  const imageSlots = Array.isArray(item.imageSlots) ? item.imageSlots : [];
  const heroImages = await downloadImages(imageSlots, item.index, layoutFamily.includes('image-grid') ? 6 : 2, usedImageUrls);
  const heroImage = heroImages[0] || null;

  addSoftTexture(slide, colors, role);
  addChrome(slide, item, colors, slides.length);
  addFooter(slide, item, colors);

  if (pageType === 'cover') {
    slide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 1.02, w: 0.08, h: 5.15, fill: { color: primary }, line: { color: primary } });
    if (heroImage) {
      addImagePanel(slide, heroImage, { x: 7.35, y: 1.22, w: 4.9, h: 4.2 }, { placeholderColor: colors.softBg, borderColor: colors.line, captionColor: colors.muted });
    } else {
      slide.addShape(pptx.ShapeType.ellipse, { x: 8.08, y: 1.34, w: 3.75, h: 3.75, line: { color: primary, transparency: 35, width: 1.6 }, fill: { color: colors.bg, transparency: 100 } });
      slide.addShape(pptx.ShapeType.rect, { x: 8.55, y: 4.9, w: 3.1, h: 0.12, fill: { color: primary, transparency: 10 }, line: { color: primary, transparency: 100 } });
    }
    const titleWidth = heroImage ? 6.15 : 10.4;
    const offset = addKicker(slide, item, colors, { x: 1.1, y: 1.32, w: titleWidth });
    slide.addText(title || text(deck.title), { x: 1.06, y: 1.42 + offset, w: titleWidth, h: 1.48, fontFace: serifFont, fontSize: 39, bold: true, color: colors.fg, breakLine: false, fit: 'shrink' });
    slide.addText(showCoreMessage || text(deck.purpose), { x: 1.1, y: 3.22 + offset, w: titleWidth, h: 0.78, fontFace: sansFont, fontSize: 16, color: colors.muted, fit: 'shrink' });
    slide.addShape(pptx.ShapeType.line, { x: 1.1, y: 5.72, w: heroImage ? 3.3 : 4.2, h: 0, line: { color: primary, transparency: 10, width: 1.2 } });
    continue;
  }

  if (pageType === 'section-divider') {
    addKicker(slide, item, colors, { x: 0.82, y: 2.08, w: 8.5 });
    slide.addText(title || coreMessage, { x: 0.78, y: 2.48, w: 10.9, h: 0.95, fontFace: serifFont, fontSize: 34, bold: true, color: colors.fg, fit: 'shrink' });
    slide.addShape(pptx.ShapeType.rect, { x: 0.82, y: 3.58, w: 3.2, h: 0.08, fill: { color: primary }, line: { color: primary } });
    if (showCoreMessage) slide.addText(showCoreMessage, { x: 0.84, y: 3.92, w: 10.2, h: 0.48, fontFace: sansFont, fontSize: 12.5, color: colors.muted, fit: 'shrink' });
    continue;
  }

  if (layoutFamily.includes('image-grid')) {
    slide.addText(title || coreMessage, { x: 0.68, y: 0.78, w: 7.1, h: 0.58, fontFace: serifFont, fontSize: 24, bold: true, color: colors.fg, fit: 'shrink' });
    if (showCoreMessage) slide.addText(showCoreMessage, { x: 0.72, y: 1.44, w: 6.6, h: 0.38, fontFace: sansFont, fontSize: 10.8, color: colors.muted, fit: 'shrink' });
    const imagesToShow = heroImages.slice(0, 3);
    if (imagesToShow.length >= 3) {
      const boxes = [
        { x: 0.76, y: 2.08, w: 3.65, h: 2.2 },
        { x: 4.68, y: 2.08, w: 3.65, h: 2.2 },
        { x: 8.6, y: 2.08, w: 3.65, h: 2.2 },
      ];
      boxes.forEach((box, index) => addImagePanel(slide, imagesToShow[index], box, { placeholderColor: colors.softBg, borderColor: colors.line, captionColor: colors.muted }));
      addInsightCards(slide, blocks, colors, { x: 0.76, y: 4.78, w: 11.5, cardH: 0.58, gap: 0.16, max: 2 });
    } else if (imagesToShow.length === 2) {
      addImagePanel(slide, imagesToShow[0], { x: 0.76, y: 2.05, w: 5.48, h: 2.72 }, { placeholderColor: colors.softBg, borderColor: colors.line, captionColor: colors.muted });
      addImagePanel(slide, imagesToShow[1], { x: 6.78, y: 2.05, w: 5.48, h: 2.72 }, { placeholderColor: colors.softBg, borderColor: colors.line, captionColor: colors.muted });
      addInsightCards(slide, blocks, colors, { x: 0.76, y: 5.22, w: 11.5, cardH: 0.54, gap: 0.14, max: 2 });
    } else if (imagesToShow.length === 1) {
      addImagePanel(slide, imagesToShow[0], { x: 0.78, y: 2.0, w: 5.45, h: 3.28 }, { placeholderColor: colors.softBg, borderColor: colors.line, captionColor: colors.muted });
      addInsightCards(slide, blocks, colors, { x: 6.72, y: 2.0, w: 5.5, cardH: 0.88, gap: 0.22, max: 4 });
    } else {
      warnings.push({ slide: item.index, code: 'image_grid_without_images_rendered_as_cards' });
      addInsightCards(slide, blocks.length ? blocks : [{ text: showCoreMessage || title }], colors, { x: 0.76, y: 2.08, w: 11.5, cardH: 0.82, gap: 0.2, max: 4 });
    }
    continue;
  }

  if (layoutFamily.includes('big-number')) {
    slide.addText(title || coreMessage, { x: 0.68, y: 0.82, w: 6.4, h: 0.55, fontFace: serifFont, fontSize: 23, bold: true, color: colors.fg, fit: 'shrink' });
    if (showCoreMessage) slide.addText(showCoreMessage, { x: 0.72, y: 1.48, w: 6.5, h: 0.42, fontFace: sansFont, fontSize: 11.2, color: colors.muted, fit: 'shrink' });
    const metricBlocks = blocks.length ? blocks : [{ type: 'metric', text: showCoreMessage || title }];
    const mainMetric = blockText(metricBlocks[0]);
    slide.addText(mainMetric, { x: 0.78, y: 2.18, w: 5.95, h: 1.5, fontFace: serifFont, fontSize: 34, bold: true, color: colors.fg, fit: 'shrink' });
    metricBlocks.slice(1, 5).forEach((block, index) => {
      const x = 7.28 + (index % 2) * 2.68;
      const y = 2.12 + Math.floor(index / 2) * 1.42;
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 2.35, h: 1.05, rectRadius: 0.05, fill: { color: colors.softBg }, line: { color: colors.line, transparency: 70, width: 0.5 } });
      slide.addText(blockText(block), { x: x + 0.16, y: y + 0.15, w: 2.02, h: 0.72, fontFace: serifFont, fontSize: 15.5, bold: true, color: colors.fg, fit: 'shrink' });
    });
    if (heroImage) addImagePanel(slide, heroImage, { x: 7.25, y: 5.02, w: 4.92, h: 1.12 }, { placeholderColor: colors.softBg, borderColor: colors.line, captionColor: colors.muted });
    continue;
  }

  if (layoutFamily.includes('pipeline') || pageType === 'timeline') {
    slide.addText(title || coreMessage, { x: 0.68, y: 0.78, w: 8.4, h: 0.58, fontFace: serifFont, fontSize: 24, bold: true, color: colors.fg, fit: 'shrink' });
    if (showCoreMessage) slide.addText(showCoreMessage, { x: 0.72, y: 1.44, w: 8.8, h: 0.38, fontFace: sansFont, fontSize: 10.8, color: colors.muted, fit: 'shrink' });
    const steps = (blocks.length ? blocks : [{ text: title || coreMessage }]).slice(0, 5);
    const useVertical = steps.some((block) => isLongText(blockText(block))) || steps.length <= 3;
    if (useVertical) {
      slide.addShape(pptx.ShapeType.line, { x: 1.05, y: 2.12, w: 0, h: 3.9, line: { color: primary, transparency: 10, width: 1.4 } });
      steps.slice(0, 4).forEach((block, index) => {
        const y = 2.0 + index * 0.95;
        slide.addShape(pptx.ShapeType.ellipse, { x: 0.86, y: y + 0.1, w: 0.38, h: 0.38, fill: { color: primary }, line: { color: primary } });
        slide.addText(String(index + 1).padStart(2, '0'), { x: 1.42, y, w: 0.52, h: 0.24, fontFace: monoFont, fontSize: 7.2, color: colors.muted, fit: 'shrink' });
        slide.addShape(pptx.ShapeType.roundRect, { x: 2.02, y: y - 0.02, w: 9.85, h: 0.78, rectRadius: 0.05, fill: { color: colors.softBg }, line: { color: colors.line, transparency: 68, width: 0.5 } });
        slide.addText(blockText(block), { x: 2.22, y: y + 0.11, w: 9.45, h: 0.52, fontFace: sansFont, fontSize: isLongText(blockText(block)) ? 8.8 : 10.2, color: colors.fg, fit: 'shrink' });
      });
    } else {
      slide.addShape(pptx.ShapeType.line, { x: 1.15, y: 3.28, w: 10.7, h: 0, line: { color: primary, transparency: 12, width: 1.4 } });
      steps.forEach((block, index) => {
        const x = 0.76 + index * 2.38;
        slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.38, y: 3.08, w: 0.42, h: 0.42, fill: { color: primary }, line: { color: primary } });
        slide.addText(String(index + 1).padStart(2, '0'), { x, y: 2.36, w: 1.15, h: 0.26, fontFace: monoFont, fontSize: 7.2, color: colors.muted, align: 'center' });
        slide.addShape(pptx.ShapeType.roundRect, { x, y: 3.68, w: 1.72, h: 1.36, rectRadius: 0.05, fill: { color: colors.softBg }, line: { color: colors.line, transparency: 68, width: 0.5 } });
        slide.addText(blockText(block), { x: x + 0.14, y: 3.86, w: 1.44, h: 0.92, fontFace: sansFont, fontSize: 8.8, color: colors.fg, fit: 'shrink' });
      });
    }
    continue;
  }

  if (layoutFamily.includes('before-after') || pageType === 'comparison') {
    slide.addText(title || coreMessage, { x: 0.68, y: 0.78, w: 7.8, h: 0.58, fontFace: serifFont, fontSize: 24, bold: true, color: colors.fg, fit: 'shrink' });
    if (showCoreMessage) slide.addText(showCoreMessage, { x: 0.72, y: 1.44, w: 7.8, h: 0.38, fontFace: sansFont, fontSize: 10.8, color: colors.muted, fit: 'shrink' });
    const [splitLeft, splitRight] = splitBlocksForColumns(blocks);
    if (!splitLeft.length || !splitRight.length) {
      warnings.push({ slide: item.index, code: 'comparison_without_two_sides_rendered_as_cards' });
      addInsightCards(slide, blocks.length ? blocks : [{ text: showCoreMessage || title }], colors, { x: 0.76, y: 2.12, w: 11.45, cardH: 0.86, gap: 0.24, max: 4 });
      continue;
    }
    const leftBlocks = splitLeft.slice(0, 3);
    const rightBlocks = splitRight.slice(0, 3);
    const columns = [
      { label: text(item.leftLabel || 'BEFORE'), x: 0.78, blocks: leftBlocks },
      { label: text(item.rightLabel || 'AFTER'), x: 6.92, blocks: rightBlocks },
    ];
    columns.forEach((column) => {
      slide.addText(column.label, { x: column.x, y: 2.08, w: 4.8, h: 0.25, fontFace: monoFont, fontSize: 7.2, charSpace: 1.2, color: colors.muted, fit: 'shrink' });
      slide.addShape(pptx.ShapeType.roundRect, { x: column.x, y: 2.48, w: 5.28, h: 3.35, rectRadius: 0.05, fill: { color: colors.softBg }, line: { color: colors.line, transparency: 66, width: 0.55 } });
      column.blocks.slice(0, 3).forEach((block, index) => {
        slide.addText(blockText(block), { x: column.x + 0.26, y: 2.76 + index * 0.9, w: 4.68, h: 0.62, fontFace: sansFont, fontSize: 10.2, color: colors.fg, fit: 'shrink' });
        if (index < 2) slide.addShape(pptx.ShapeType.line, { x: column.x + 0.26, y: 3.52 + index * 0.9, w: 4.66, h: 0, line: { color: colors.line, transparency: 82, width: 0.4 } });
      });
    });
    continue;
  }

  const isQuoteLike = pageType === 'quote' || layoutFamily.includes('quote') || layoutFamily.includes('question');
  const titleY = isQuoteLike ? 1.65 : 0.78;
  addKicker(slide, item, colors, { x: 0.72, y: titleY - 0.36, w: 7.5 });
  slide.addText(title || coreMessage, { x: 0.68, y: titleY, w: heroImage ? 7.05 : 11.7, h: isQuoteLike ? 1.04 : 0.62, fontFace: serifFont, fontSize: isQuoteLike ? 31 : 23, bold: true, color: colors.fg, fit: 'shrink' });
  slide.addShape(pptx.ShapeType.line, { x: 0.72, y: isQuoteLike ? 3.02 : 1.48, w: heroImage ? 6.45 : 11.78, h: 0, line: { color: primary, transparency: 8, width: 1.05 } });
  if (showCoreMessage) {
    slide.addText(showCoreMessage, { x: 0.72, y: isQuoteLike ? 3.28 : 1.68, w: heroImage ? 6.6 : 11.6, h: 0.52, fontFace: sansFont, fontSize: isQuoteLike ? 14 : 12.2, color: colors.muted, fit: 'shrink' });
  }
  if (heroImage) {
    addImagePanel(slide, heroImage, { x: 8.04, y: isQuoteLike ? 1.55 : 1.72, w: 4.24, h: isQuoteLike ? 3.2 : 3.05 }, { placeholderColor: colors.softBg, borderColor: colors.line, captionColor: colors.muted });
  }

  let cursorY = showCoreMessage ? (isQuoteLike ? 4.08 : 2.22) : (isQuoteLike ? 3.34 : 1.86);
  const maxBlocks = Math.max(1, Math.min(blocks.length || 1, 5));
  if (blocks.length === 0) {
    slide.addText(coreMessage || title || 'Content planned in render instructions.', { x: 0.78, y: cursorY, w: heroImage ? 6.75 : 11.6, h: 0.62, fontFace: sansFont, fontSize: 13.5, color: colors.fg, fit: 'shrink' });
  }

  blocks.slice(0, maxBlocks).forEach((block, blockIndex) => {
    const kind = text(block.type || block.kind);
    const body = blockText(block);
    if (!body) return;
    const isMetric = kind === 'metric' || layoutFamily.includes('big-number');
    const isTimeline = pageType === 'timeline' || layoutFamily.includes('pipeline');
    const x = pageType === 'comparison' ? (blockIndex % 2 === 0 ? 0.78 : 6.86) : isTimeline ? 0.94 + blockIndex * 2.28 : 0.78;
    const w = pageType === 'comparison' ? 5.58 : isTimeline ? 1.82 : heroImage ? 6.75 : 11.75;
    const y = pageType === 'comparison' ? cursorY + Math.floor(blockIndex / 2) * 1.18 : isTimeline ? 3.05 : cursorY;
    const h = isMetric ? 0.98 : isTimeline ? 1.24 : 0.82;
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.05, fill: { color: colors.softBg, transparency: colors.isDark ? 5 : 0 }, line: { color: colors.line, transparency: colors.isDark ? 55 : 78, width: 0.55 } });
    if (isTimeline) {
      slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.12, y: y + 0.12, w: 0.26, h: 0.26, fill: { color: primary }, line: { color: primary } });
      if (blockIndex < maxBlocks - 1) slide.addShape(pptx.ShapeType.line, { x: x + 1.76, y: y + 0.25, w: 0.72, h: 0, line: { color: primary, transparency: 20, width: 1 } });
    }
    slide.addText(body, { x: x + 0.18, y: y + (isTimeline ? 0.44 : 0.12), w: w - 0.36, h: isTimeline ? 0.66 : h - 0.24, fontFace: isMetric ? serifFont : sansFont, fontSize: isMetric ? 20 : isTimeline ? 8.8 : 10.8, bold: isMetric, color: colors.fg, fit: 'shrink', breakLine: false });
    if (pageType !== 'comparison' && !isTimeline) cursorY += isMetric ? 1.1 : 0.92;
  });
}

const outputDir = outputPath.split('/').slice(0, -1).join('/');
if (outputDir) await fs.mkdir(outputDir, { recursive: true });
await pptx.writeFile({ fileName: outputPath });
const report = {
  status: 'completed',
  pptxPath: outputPath,
  reportPath,
  slideCount: slides.length,
  warnings,
  repairHints: []
};
await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log('ONECEO_PPT_RENDER_RESULT ' + JSON.stringify(report));
`;
}

export type PptRenderToolResult = {
  status: 'completed' | 'failed';
  pptxPath?: string;
  reportPath?: string;
  slideCount?: number;
  warnings: unknown[];
  repairHints: unknown[];
  stage?: string;
  errors?: string[];
};

export class PptRenderToolService {
  async render(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    instructions: unknown;
    outputFileName?: string | null;
  }): Promise<PptRenderToolResult> {
    const validated = validatePptRenderInstruction(input.instructions);
    const fileName = asText(input.outputFileName) ? sanitizePptFileName(input.outputFileName) : validated.fileName;
    const workspaceRoot = input.workspaceRoot.replace(/\/+$/, '');
    const rendererRoot = path.posix.join(workspaceRoot, '.oneceo', 'ppt-renderer');
    const deliverablesRoot = path.posix.join(workspaceRoot, 'deliverables');
    const inputPath = path.posix.join(rendererRoot, 'render-instructions.json');
    const scriptPath = path.posix.join(rendererRoot, 'render-pptx.mjs');
    const packagePath = path.posix.join(rendererRoot, 'package.json');
    const outputPath = path.posix.join(deliverablesRoot, fileName);
    const reportPath = path.posix.join(deliverablesRoot, fileName.replace(/\.pptx$/i, '.render-report.json'));

    await e2bConnector.runCommand(input.sandboxId, `mkdir -p ${shellEscape(rendererRoot)} ${shellEscape(deliverablesRoot)}`, {
      timeoutMs: 15_000,
    });
    await e2bConnector.writeFile(input.sandboxId, inputPath, Buffer.from(JSON.stringify(validated.instruction, null, 2), 'utf8'));
    await e2bConnector.writeFile(input.sandboxId, scriptPath, Buffer.from(buildRendererScript(), 'utf8'));
    await e2bConnector.writeFile(
      input.sandboxId,
      packagePath,
      Buffer.from(JSON.stringify({ type: 'module', dependencies: { pptxgenjs: '^3.12.0' } }, null, 2), 'utf8')
    );

    const stdoutPath = path.posix.join(rendererRoot, 'render.stdout.log');
    const stderrPath = path.posix.join(rendererRoot, 'render.stderr.log');
    const command = [
      'set +e',
      `: > ${shellEscape(stdoutPath)}`,
      `: > ${shellEscape(stderrPath)}`,
      `(test -d node_modules/pptxgenjs || npm install --silent --no-audit --no-fund) >> ${shellEscape(stdoutPath)} 2>> ${shellEscape(stderrPath)}`,
      'install_code=$?',
      'if [ "$install_code" -eq 0 ]; then',
      `  node ${shellEscape(scriptPath)} ${shellEscape(inputPath)} ${shellEscape(outputPath)} ${shellEscape(reportPath)} >> ${shellEscape(stdoutPath)} 2>> ${shellEscape(stderrPath)}`,
      '  render_code=$?',
      'else',
      '  render_code=$install_code',
      'fi',
      `cat ${shellEscape(stdoutPath)}`,
      `cat ${shellEscape(stderrPath)} >&2`,
      'printf "\\nONECEO_PPT_COMMAND_EXIT %s\\n" "$render_code"',
      'exit 0',
    ].join('\n');
    const result = await e2bConnector.runCommand(input.sandboxId, command, {
      cwd: rendererRoot,
      timeoutMs: 180_000,
    });

    const commandExitMarker = asText(result.stdout)
      .split('\n')
      .find((line) => line.startsWith('ONECEO_PPT_COMMAND_EXIT '));
    const commandExitCode = commandExitMarker ? Number(commandExitMarker.slice('ONECEO_PPT_COMMAND_EXIT '.length)) : result.exitCode;
    if (result.exitCode !== 0 || commandExitCode !== 0) {
      return {
        status: 'failed',
        stage: 'render',
        warnings: [],
        repairHints: ['Inspect renderer stderr and repair PptRenderInstruction before retrying.'],
        errors: [asText(result.stderr) || asText(result.stdout) || 'ppt_render_failed'],
      };
    }

    const marker = asText(result.stdout)
      .split('\n')
      .find((line) => line.startsWith('ONECEO_PPT_RENDER_RESULT '));
    const parsed = marker ? JSON.parse(marker.slice('ONECEO_PPT_RENDER_RESULT '.length)) : {};
    await touchSandbox(input.sandboxId, 'ppt_render');

    return {
      status: 'completed',
      pptxPath: toWorkspaceRelative(workspaceRoot, asText(parsed.pptxPath) || outputPath),
      reportPath: toWorkspaceRelative(workspaceRoot, asText(parsed.reportPath) || reportPath),
      slideCount: Number(parsed.slideCount) || validated.slideCount,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      repairHints: Array.isArray(parsed.repairHints) ? parsed.repairHints : [],
    };
  }
}

export const pptRenderToolService = new PptRenderToolService();
