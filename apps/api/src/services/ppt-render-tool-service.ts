import path from 'node:path';
import { e2bConnector } from '../connectors/e2b-connector';
import { touchSandbox } from './sandbox-activity-service';
import { sanitizePptFileName, validatePptRenderInstruction } from './ppt-render-instruction-validator';
import { validateHtmlDeckSpec } from './ppt-html-deck-validator';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function shellEscape(value: string) {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function htmlDeckGeometry(aspectRatio: '16:9' | '4:3') {
  return aspectRatio === '4:3'
    ? { widthPx: 1024, heightPx: 768, widthIn: 10, heightIn: 7.5, layout: 'LAYOUT_4X3' }
    : { widthPx: 1280, heightPx: 720, widthIn: 13.333333, heightIn: 7.5, layout: 'LAYOUT_WIDE' };
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string) {
  const relative = path.posix.relative(workspaceRoot.replace(/\/+$/, ''), absolutePath);
  if (!relative || relative.startsWith('..') || path.posix.isAbsolute(relative)) {
    throw new Error('ppt_render_output_path_invalid');
  }
  return relative;
}

export function buildRendererScript() {
  return String.raw`import { lookup } from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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
  if (Array.isArray(block.items)) return block.items.map((item) => itemText(item)).filter(Boolean).join('\n');
  if (Array.isArray(block.rows)) return block.rows.map((row) => Array.isArray(row) ? row.join(' | ') : String(row || '')).join('\n');
  return '';
}

function itemText(item) {
  if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
    return String(item).trim();
  }
  if (!item || typeof item !== 'object') return '';
  const record = item;
  const direct = text(record.text || record.content || record.title || record.label || record.value || record.name);
  if (direct) return direct;
  if (Array.isArray(record.items)) return record.items.map((child) => itemText(child)).filter(Boolean).join('；');
  const pairs = Object.entries(record)
    .map(([key, value]) => {
      const body = itemText(value);
      return body ? (['text', 'content', 'title', 'label', 'value', 'name'].includes(key) ? body : key + '：' + body) : '';
    })
    .filter(Boolean);
  return pairs.join('；');
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

function decodeLoose(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function imageQualityIssue(slot, url) {
  const metadata = [
    url,
    decodeLoose(url),
    slot?.alt,
    slot?.title,
    slot?.caption,
    slot?.sourceUrl,
    slot?.usageHint,
  ].map((item) => String(item || '').toLowerCase()).join(' ');
  const badPatterns = [
    /手抄报|小报|电子小报|电子手抄报/,
    /模板|模版|template|ppt模板|word格式|可打印|下载|素材下载/,
    /千库|昵图|包图|摄图|觅知|我图|六图|588ku|nipic|ibaotu|ooopic|sucai|素材网/,
    /31款|合集|大全|海报模板|边框素材/,
    /watermark|stock photo|正版授权/,
  ];
  if (badPatterns.some((pattern) => pattern.test(metadata))) return 'promotional_or_template_image';
  return '';
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

function cleanIpHost(value) {
  return String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
}

function isBlockedIpv4Address(address) {
  const parts = cleanIpHost(address).split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && (parts[1] === 0 || parts[1] === 168)) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
    parts[0] >= 224
  );
}

function isBlockedIpv6Address(address) {
  const normalized = cleanIpHost(address);
  if (!normalized || normalized === '::' || normalized === '::1') return true;
  if (/^(?:0+:){2,7}0*1$/.test(normalized) || /^(?:0+:){2,7}0*$/.test(normalized)) return true;
  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isBlockedIpv4Address(mappedIpv4[1]);
  const mappedIpv4Hex = normalized.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedIpv4Hex) {
    const high = Number.parseInt(mappedIpv4Hex[1], 16);
    const low = Number.parseInt(mappedIpv4Hex[2], 16);
    if (Number.isInteger(high) && Number.isInteger(low)) {
      const mappedAddress = [
        (high >> 8) & 255,
        high & 255,
        (low >> 8) & 255,
        low & 255,
      ].join('.');
      return isBlockedIpv4Address(mappedAddress);
    }
  }
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
  if (!Number.isFinite(first)) return false;
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

function isBlockedIpAddress(address) {
  const normalized = cleanIpHost(address);
  const family = net.isIP(normalized);
  if (family === 4) return isBlockedIpv4Address(normalized);
  if (family === 6) return isBlockedIpv6Address(normalized);
  return false;
}

function isBlockedHost(host) {
  const normalized = cleanIpHost(host);
  if (
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true;
  }
  return isBlockedIpAddress(normalized);
}

async function assertImageUrlAllowed(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: 'image_download_invalid_url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, code: 'image_download_invalid_url' };
  }
  const host = parsed.hostname.toLowerCase();
  if (isBlockedHost(host)) {
    return { ok: false, code: 'image_download_blocked_host', host };
  }
  if (net.isIP(cleanIpHost(host))) {
    return { ok: true };
  }
  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch (error) {
    return { ok: false, code: 'image_download_dns_failed', host, message: String(error?.message || error) };
  }
  const blockedRecord = records.find((record) => isBlockedIpAddress(record.address));
  if (blockedRecord) {
    return { ok: false, code: 'image_download_blocked_resolved_address', host, address: blockedRecord.address };
  }
  return { ok: true };
}

async function fetchImageResponse(url, signal, slideIndex) {
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
    const allowance = await assertImageUrlAllowed(currentUrl);
    if (!allowance.ok) {
      warnings.push({ slide: slideIndex, url: currentUrl, ...allowance });
      return null;
    }
    const response = await fetch(currentUrl, {
      headers: { 'user-agent': 'OneCEO PPT Renderer' },
      signal,
      redirect: 'manual',
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return { response, url: currentUrl };
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    return { response, url: currentUrl };
  }
  warnings.push({ slide: slideIndex, code: 'image_download_too_many_redirects', url });
  return null;
}

function layoutExpectsProvidedImage(pageType, layoutFamily) {
  return (
    pageType === 'cover' ||
    layoutFamily.includes('image-grid') ||
    layoutFamily.includes('quote-image') ||
    layoutFamily.includes('lead-image-side-text') ||
    layoutFamily.includes('gallery')
  );
}

async function downloadImage(slot, slideIndex) {
  const url = imageUrl(slot);
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const fetched = await fetchImageResponse(url, controller.signal, slideIndex);
    if (!fetched) return null;
    const { response, url: finalUrl } = fetched;
    if (!response.ok) {
      warnings.push({ slide: slideIndex, code: 'image_download_failed', url: finalUrl, status: response.status });
      return null;
    }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      warnings.push({ slide: slideIndex, code: 'image_download_non_image_content_type', url: finalUrl, contentType });
      return null;
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      warnings.push({ slide: slideIndex, code: 'image_download_too_large', url: finalUrl, contentLength });
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) return null;
    if (bytes.length > MAX_IMAGE_BYTES) {
      warnings.push({ slide: slideIndex, code: 'image_download_too_large', url: finalUrl, byteLength: bytes.length });
      return null;
    }
    const ext = imageExtension(contentType, finalUrl);
    const filePath = assetRoot + '/slide-' + String(slideIndex || 'x') + '-' + Math.random().toString(36).slice(2) + '.' + ext;
    await fs.writeFile(filePath, bytes);
    return { path: filePath, url: finalUrl, alt: text(slot?.alt || slot?.title) };
  } catch (error) {
    warnings.push({ slide: slideIndex, code: 'image_download_failed', url, message: String(error?.message || error) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadImages(slots, slideIndex, maxCount, usedUrls) {
  const result = [];
  for (const slot of imageSlotsForSlide(slots)) {
    const url = imageUrl(slot);
    const qualityIssue = imageQualityIssue(slot, url);
    if (qualityIssue) {
      warnings.push({ slide: slideIndex, code: 'low_quality_image_skipped', reason: qualityIssue, url, alt: text(slot?.alt || slot?.title).slice(0, 80) });
      continue;
    }
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
function hexToRgb(hex) {
  const value = color(hex, '');
  if (!value) return null;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}
function linearizeChannel(value) {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * linearizeChannel(rgb.r) + 0.7152 * linearizeChannel(rgb.g) + 0.0722 * linearizeChannel(rgb.b);
}
function contrastRatio(left, right) {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}
function pickReadableColor(candidates, background, minimumRatio) {
  const normalizedCandidates = candidates
    .map((candidate) => color(candidate, ''))
    .filter(Boolean);
  let best = normalizedCandidates[0] || '111827';
  let bestRatio = contrastRatio(best, background);
  for (const candidate of normalizedCandidates.slice(1)) {
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  if (bestRatio >= minimumRatio) return best;
  const blackRatio = contrastRatio('111827', background);
  const whiteRatio = contrastRatio('FFFFFF', background);
  return blackRatio >= whiteRatio ? '111827' : 'FFFFFF';
}
const serifFont = theme.fontSystem?.serifHeading || theme.fontSystem?.heading || 'Noto Serif SC';
const sansFont = theme.fontSystem?.body || theme.fontSystem?.cjk || 'Noto Sans SC';
const monoFont = theme.fontSystem?.mono || 'IBM Plex Mono';

function isLongText(value) {
  return normalizeForCompare(value).length > 42 || String(value || '').split(/\n/).length > 2;
}

function blockLines(block) {
  if (!block || typeof block !== 'object') return [];
  if (Array.isArray(block.items)) return block.items.map((item) => itemText(item)).filter(Boolean);
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

function totalContentLength(blocks) {
  return blocks.map((block) => normalizeForCompare(blockText(block)).length).reduce((sum, value) => sum + value, 0);
}

function slideLooksLowDensity(pageType, layoutFamily, blocks, showCoreMessage, hasImage) {
  if (['cover', 'section-divider', 'closing', 'quote'].includes(pageType)) return false;
  if (layoutFamily.includes('big-quote') || layoutFamily.includes('question')) return false;
  return !hasImage && blocks.length < 2 && (totalContentLength(blocks) + normalizeForCompare(showCoreMessage).length) < 70;
}

function comparisonSemanticIssue(item, title, coreMessage, blocks) {
  const family = text(item.layoutFamily || item.layout || item.visualLayout).toLowerCase().replace(/_/g, '-');
  if (family.includes('regional-compare') || family.includes('two-column')) return '';
  if (text(item.leftLabel) || text(item.rightLabel)) return '';
  const haystack = [title, coreMessage, ...blocks.map((block) => blockText(block))].join(' ');
  if (/(美食|汤圆|元宵|食材|南方|北方|地域|民俗活动|舞龙|舞狮|灯会|习俗|种类|类型|分类)/.test(haystack)) {
    return 'semantic_compare_not_before_after';
  }
  return '';
}

function semanticLayoutFamily(layoutFamily, item, pageType, title, coreMessage, blocks) {
  if ((layoutFamily.includes('before-after') || pageType === 'comparison') && comparisonSemanticIssue(item, title, coreMessage, blocks)) {
    return 'regional-compare';
  }
  return layoutFamily;
}

function compareLabels(item, title, coreMessage, blocks, layoutFamily) {
  if (text(item.leftLabel) || text(item.rightLabel)) {
    return [text(item.leftLabel || 'LEFT'), text(item.rightLabel || 'RIGHT')];
  }
  const haystack = [title, coreMessage, ...blocks.map((block) => blockText(block))].join(' ');
  if (/(南方|北方|汤圆|元宵|地域)/.test(haystack)) return ['北方 / 元宵', '南方 / 汤圆'];
  if (/(民俗活动|舞龙|舞狮|灯会|习俗)/.test(haystack)) return ['传统仪式', '公共活动'];
  if (layoutFamily.includes('regional-compare') || layoutFamily.includes('two-column')) return ['角度一', '角度二'];
  return ['BEFORE', 'AFTER'];
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
  const bg = isDark ? preset.ink : preset.paper;
  const softBg = isDark ? preset.inkTint : preset.paperTint;
  const fg = pickReadableColor(
    [isDark ? preset.paper : preset.ink, colorTokens.text, colorTokens.textColor, colorTokens.foreground],
    bg,
    4.5,
  );
  const muted = pickReadableColor(
    [isDark ? preset.paperTint : preset.inkTint, fg, isDark ? preset.paper : preset.ink],
    bg,
    3,
  );
  return {
    bg,
    softBg,
    fg,
    muted,
    line: muted,
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
  const title = text(item.title);
  const coreMessage = text(item.coreMessage);
  const showCoreMessage = coreMessage && !isDuplicateText(coreMessage, title) ? coreMessage : '';
  if (coreMessage && !showCoreMessage) {
    warnings.push({ slide: item.index, code: 'duplicate_core_message_skipped', text: coreMessage.slice(0, 80) });
  }
  const blocks = uniqueContentBlocks(contentBlocks(item), [title, coreMessage], item.index);
  const layoutFamily = semanticLayoutFamily(layoutFamilyFor(item, pageType), item, pageType, title, showCoreMessage || coreMessage, blocks);
  const colors = colorsForRole(role);
  const imageSlots = Array.isArray(item.imageSlots) ? item.imageSlots : [];
  const requestedImageCount = imageSlotsForSlide(imageSlots).length;
  const heroImages = await downloadImages(imageSlots, item.index, layoutFamily.includes('image-grid') ? 6 : 2, usedImageUrls);
  const heroImage = heroImages[0] || null;
  if (requestedImageCount > 0 && heroImages.length === 0 && layoutExpectsProvidedImage(pageType, layoutFamily)) {
    warnings.push({ slide: item.index, code: 'required_image_missing', layoutFamily, requestedImageCount });
  }
  if (slideLooksLowDensity(pageType, layoutFamily, blocks, showCoreMessage, Boolean(heroImage))) {
    warnings.push({ slide: item.index, code: 'low_density_slide', layoutFamily, contentBlockCount: blocks.length });
  }
  const semanticIssue = comparisonSemanticIssue(item, title, showCoreMessage || coreMessage, blocks);
  if (semanticIssue) {
    warnings.push({ slide: item.index, code: 'layout_semantic_downgraded', from: 'before-after', to: layoutFamily, reason: semanticIssue });
  }

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

  if (layoutFamily.includes('before-after') || layoutFamily.includes('regional-compare') || layoutFamily.includes('two-column') || pageType === 'comparison') {
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
    const [leftLabel, rightLabel] = compareLabels(item, title, showCoreMessage || coreMessage, blocks, layoutFamily);
    const columns = [
      { label: leftLabel, x: 0.78, blocks: leftBlocks },
      { label: rightLabel, x: 6.92, blocks: rightBlocks },
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

export function buildHtmlDeckRendererScript() {
  return String.raw`import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const pptxgen = require('pptxgenjs');

function requireFromNodePathFirst(packageName) {
  const searchRoots = String(process.env.NODE_PATH || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const root of searchRoots) {
    try {
      return require(path.join(root, packageName));
    } catch {
      // Try the next platform-managed module root before falling back to local node_modules.
    }
  }
  return require(packageName);
}

const { chromium } = requireFromNodePathFirst('playwright');

const [specPath, projectRoot, outputPath, reportPath, visualQaReportPath, screenshotRoot] = process.argv.slice(2);
if (!specPath || !projectRoot || !outputPath || !reportPath || !visualQaReportPath || !screenshotRoot) {
  throw new Error('missing html deck renderer arguments');
}

const spec = JSON.parse(await fs.readFile(specPath, 'utf8'));
const deck = spec.deck || {};
const slides = Array.isArray(spec.slides) ? spec.slides : [];
const aspectRatio = String(deck.aspectRatio || '').replace(/\s+/g, '') === '4:3' ? '4:3' : '16:9';
const slideGeometry = aspectRatio === '4:3'
  ? { widthPx: 1024, heightPx: 768, widthIn: 10, heightIn: 7.5, layout: 'LAYOUT_4X3' }
  : { widthPx: 1280, heightPx: 720, widthIn: 13.333333, heightIn: 7.5, layout: 'LAYOUT_WIDE' };
const warnings = [];
const renderSlideRoot = path.posix.join(projectRoot, '.oneceo-rendered-slides');

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtmlAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resolveSlidePath(htmlFile) {
  const absolute = path.posix.normalize(path.posix.join(projectRoot, htmlFile));
  const normalizedRoot = projectRoot.replace(/\/+$/, '');
  if (!absolute.startsWith(normalizedRoot + '/')) {
    throw new Error('ppt_html_slide_path_outside_project');
  }
  return absolute;
}

function pptxError(message) {
  return message && typeof message === 'object' ? message.message || String(message) : String(message || '');
}

async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function extractHead(rawHtml) {
  const match = String(rawHtml || '').match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  return match ? match[1] : '';
}

function extractBody(rawHtml) {
  const match = String(rawHtml || '').match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : String(rawHtml || '');
}

function absolutizeStylesheetLink(tag, baseDir) {
  const hrefMatch = String(tag || '').match(/\bhref\s*=\s*(["'])(.*?)\1/i) || String(tag || '').match(/\bhref\s*=\s*([^\s>]+)/i);
  if (!hrefMatch) return tag;
  const rawHref = hrefMatch[2] || hrefMatch[1] || '';
  if (!rawHref || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(rawHref)) return tag;
  const absoluteHref = pathToFileURL(path.posix.normalize(path.posix.join(baseDir, rawHref))).href;
  return String(tag).replace(hrefMatch[0], 'href="' + escapeHtmlAttr(absoluteHref) + '"');
}

function absolutizeCssUrls(css, baseDir) {
  return String(css || '').replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, rawUrl) => {
    const value = String(rawUrl || '').trim();
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value)) return match;
    const absoluteUrl = pathToFileURL(path.posix.normalize(path.posix.join(baseDir, value))).href;
    const q = quote || '';
    return 'url(' + q + absoluteUrl + q + ')';
  });
}

function absolutizeStyleTag(tag, baseDir) {
  return String(tag || '').replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/i, (_match, openTag, css, closeTag) => {
    return openTag + absolutizeCssUrls(css, baseDir) + closeTag;
  });
}

function collectStyleFragments(rawHtml, baseDir) {
  const head = extractHead(rawHtml) || String(rawHtml || '');
  const styles = (head.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).map((tag) => absolutizeStyleTag(tag, baseDir));
  const links = (head.match(/<link\b[^>]*>/gi) || [])
    .filter((tag) => /\brel\s*=\s*(["'][^"']*\bstylesheet\b[^"']*["']|[^\s>]*stylesheet[^\s>]*)/i.test(tag))
    .map((tag) => absolutizeStylesheetLink(tag, baseDir));
  return {
    fragments: [...links, ...styles],
    hasCss: links.length + styles.length > 0,
  };
}

async function buildRenderableSlide(slideSpec, index, htmlFile, slidePath) {
  const indexPath = path.posix.join(projectRoot, 'index.html');
  const indexHtml = await readOptionalFile(indexPath);
  const slideHtml = await fs.readFile(slidePath, 'utf8');
  const sharedHead = collectStyleFragments(indexHtml, projectRoot);
  const slideHead = collectStyleFragments(slideHtml, path.posix.dirname(slidePath));
  const sourceCssApplied = sharedHead.hasCss || slideHead.hasCss;
  const body = extractBody(slideHtml);
  const baseHref = pathToFileURL(path.posix.dirname(slidePath).replace(/\/+$/, '') + '/').href;
  const renderedHtmlPath = path.posix.join(renderSlideRoot, htmlFile);
  const rendererCss = [
    '<style data-oneceo-renderer="slide-frame">',
    'html,body{width:' + slideGeometry.widthPx + 'px;height:' + slideGeometry.heightPx + 'px;margin:0;overflow:hidden;background:#fff;}',
    'body{display:flex;align-items:stretch;justify-content:center;}',
    '.slide,body>[data-slide-id]:first-child{width:' + slideGeometry.widthPx + 'px!important;height:' + slideGeometry.heightPx + 'px!important;margin:0!important;box-sizing:border-box;}',
    '.slide{border-radius:0!important;box-shadow:none!important;}',
    'img,svg,video,canvas{max-width:100%;}',
    '</style>',
  ].join('');
  const normalized = [
    '<!doctype html>',
    '<html lang="' + escapeHtmlAttr(text(deck.language) || 'zh-CN') + '">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=' + slideGeometry.widthPx + ', initial-scale=1.0">',
    '<base href="' + escapeHtmlAttr(baseHref) + '">',
    ...sharedHead.fragments,
    ...slideHead.fragments,
    rendererCss,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n');
  await fs.mkdir(path.posix.dirname(renderedHtmlPath), { recursive: true });
  await fs.writeFile(renderedHtmlPath, normalized, 'utf8');
  return {
    renderedHtmlPath,
    sourceCssApplied,
    sourceMode: /<html\b/i.test(slideHtml) ? 'full_html' : 'fragment',
    sharedCssApplied: sharedHead.hasCss,
    slideCssApplied: slideHead.hasCss,
  };
}

await fs.mkdir(path.posix.dirname(outputPath), { recursive: true });
await fs.mkdir(screenshotRoot, { recursive: true });
await fs.mkdir(renderSlideRoot, { recursive: true });
const pptImageRoot = path.posix.join(path.posix.dirname(outputPath), '.ppt-images');
await fs.mkdir(pptImageRoot, { recursive: true });

let browser;
const qaSlides = [];
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: slideGeometry.widthPx, height: slideGeometry.heightPx },
    deviceScaleFactor: 1,
  });

  for (const slideSpec of slides) {
    const index = Number(slideSpec.index || qaSlides.length + 1);
    const htmlFile = text(slideSpec.htmlFile);
    const slidePath = resolveSlidePath(htmlFile);
    const screenshotPath = path.posix.join(screenshotRoot, String(index).padStart(3, '0') + '.png');
    const pptImagePath = path.posix.join(pptImageRoot, String(index).padStart(3, '0') + '.jpg');
    const page = await context.newPage();
    try {
      await fs.access(slidePath);
      const renderable = await buildRenderableSlide(slideSpec, index, htmlFile, slidePath);
      await page.goto(pathToFileURL(renderable.renderedHtmlPath).href, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(250);
      const metrics = await page.evaluate(({ fallbackWidth, fallbackHeight, renderedHtmlPath, sourceCssApplied, sourceMode, sharedCssApplied, slideCssApplied }) => {
        const body = document.body;
        const root = document.documentElement;
        const textContent = String(body?.innerText || '').trim();
        const slide = document.querySelector('[data-slide-id]') || document.querySelector('.slide') || body;
        const style = window.getComputedStyle(slide);
        return {
          textLength: textContent.length,
          scrollWidth: Math.max(body?.scrollWidth || 0, root?.scrollWidth || 0),
          scrollHeight: Math.max(body?.scrollHeight || 0, root?.scrollHeight || 0),
          clientWidth: root?.clientWidth || fallbackWidth,
          clientHeight: root?.clientHeight || fallbackHeight,
          bodyChildren: body?.children?.length || 0,
          slideId: slide?.getAttribute?.('data-slide-id') || '',
          slideIndex: slide?.getAttribute?.('data-slide-index') || '',
          backgroundColor: style.backgroundColor,
          fontFamily: style.fontFamily,
          styleTagCount: document.querySelectorAll('style').length,
          stylesheetLinkCount: document.querySelectorAll('link[rel~="stylesheet" i]').length,
          renderedHtmlPath,
          sourceCssApplied,
          sourceMode,
          sharedCssApplied,
          slideCssApplied,
        };
      }, {
        fallbackWidth: slideGeometry.widthPx,
        fallbackHeight: slideGeometry.heightPx,
        renderedHtmlPath: renderable.renderedHtmlPath,
        sourceCssApplied: renderable.sourceCssApplied,
        sourceMode: renderable.sourceMode,
        sharedCssApplied: renderable.sharedCssApplied,
        slideCssApplied: renderable.slideCssApplied,
      });
      const slideWarnings = [];
      if (!metrics.textLength && metrics.bodyChildren === 0) {
        slideWarnings.push({ code: 'empty_slide_dom' });
      }
      if (!metrics.sourceCssApplied) {
        slideWarnings.push({ code: 'slide_stylesheet_missing', renderedHtmlPath: metrics.renderedHtmlPath });
      }
      if (metrics.scrollWidth > metrics.clientWidth + 2 || metrics.scrollHeight > metrics.clientHeight + 2) {
        slideWarnings.push({ code: 'slide_has_scroll_overflow', metrics });
      }
      if (!metrics.slideId) {
        slideWarnings.push({ code: 'missing_data_slide_id' });
      }
      if (!metrics.slideIndex) {
        slideWarnings.push({ code: 'missing_data_slide_index' });
      }
      const badText = await page.evaluate(() => document.body.innerText || '');
      if (/undefined|NaN|\[object Object\]/.test(badText)) {
        slideWarnings.push({ code: 'invalid_placeholder_text' });
      }
      await page.screenshot({ path: screenshotPath, fullPage: false, type: 'png' });
      await page.screenshot({ path: pptImagePath, fullPage: false, type: 'jpeg', quality: 90 });
      qaSlides.push({
        index,
        id: text(slideSpec.id),
        htmlFile,
        renderedHtmlPath: metrics.renderedHtmlPath,
        screenshotPath,
        pptImagePath,
        metrics,
        warnings: slideWarnings,
      });
    } catch (error) {
      throw new Error('slide_render_failed:' + htmlFile + ':' + pptxError(error));
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  await context.close();
} catch (error) {
  const failedReport = {
    status: 'failed',
    stage: 'render',
    pptxPath: null,
    reportPath,
    htmlManifestPath: path.posix.join(projectRoot, 'manifest.json'),
    visualQaReportPath,
    slideCount: slides.length,
    warnings,
    repairHints: ['Fix the HTML deck so it can be opened by Chromium and rerun render_pptx_from_html_deck.'],
    errors: [pptxError(error)],
  };
  await fs.writeFile(reportPath, JSON.stringify(failedReport, null, 2), 'utf8');
  console.log('ONECEO_PPT_HTML_RENDER_RESULT ' + JSON.stringify(failedReport));
  process.exit(0);
} finally {
  if (browser) await browser.close().catch(() => undefined);
}

const visualQaReport = {
  status: 'completed',
  slideCount: slides.length,
  screenshots: qaSlides.map((slide) => ({ index: slide.index, path: slide.screenshotPath, renderedHtmlPath: slide.renderedHtmlPath })),
  warnings,
  fatalErrors: [],
  slides: qaSlides,
};
await fs.writeFile(visualQaReportPath, JSON.stringify(visualQaReport, null, 2), 'utf8');

const pptx = new pptxgen();
pptx.layout = slideGeometry.layout;
pptx.author = 'OneCEO';
pptx.company = 'OneCEO';
pptx.subject = text(deck.purpose);
pptx.title = text(deck.title);
pptx.lang = text(deck.language) || 'zh-CN';

for (const slideImage of qaSlides) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addImage({ path: slideImage.pptImagePath, x: 0, y: 0, w: slideGeometry.widthIn, h: slideGeometry.heightIn });
}

await pptx.writeFile({ fileName: outputPath });
const report = {
  status: 'completed',
  pptxPath: outputPath,
  htmlManifestPath: path.posix.join(projectRoot, 'manifest.json'),
  visualQaReportPath,
  exportReportPath: reportPath,
  reportPath,
  exportMode: 'rasterized_html_screenshots',
  editablePptx: false,
  aspectRatio,
  slideCount: slides.length,
  warnings,
  repairHints: [],
};
await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log('ONECEO_PPT_HTML_RENDER_RESULT ' + JSON.stringify(report));
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
  exportMode?: string;
  editablePptx?: boolean;
  aspectRatio?: string;
  slideWidthIn?: number;
  slideHeightIn?: number;
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
    if (asText(parsed.status) === 'failed') {
      return {
        status: 'failed',
        stage: asText(parsed.stage) || 'render',
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        repairHints: Array.isArray(parsed.repairHints) ? parsed.repairHints : ['Repair PptRenderInstruction before retrying.'],
        errors: Array.isArray(parsed.errors) ? parsed.errors.map((item: unknown) => JSON.stringify(item)) : ['ppt_render_failed'],
        reportPath: toWorkspaceRelative(workspaceRoot, asText(parsed.reportPath) || reportPath),
        slideCount: Number(parsed.slideCount) || validated.slideCount,
      };
    }
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

  async renderHtmlDeck(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    htmlDeckSpec: unknown;
    projectRoot?: string | null;
    outputFileName?: string | null;
  }): Promise<PptRenderToolResult & { htmlManifestPath?: string; visualQaReportPath?: string; exportReportPath?: string }> {
    const validated = validateHtmlDeckSpec(input.htmlDeckSpec);
    const fileName = asText(input.outputFileName) ? sanitizePptFileName(input.outputFileName) : validated.fileName;
    const workspaceRoot = input.workspaceRoot.replace(/\/+$/, '');
    const rawProjectRoot = asText(input.projectRoot) || 'ppt-html-deck';
    const projectRoot = rawProjectRoot.startsWith('/')
      ? path.posix.normalize(rawProjectRoot)
      : path.posix.normalize(path.posix.join(workspaceRoot, rawProjectRoot));
    if (!projectRoot.startsWith(`${workspaceRoot}/`)) {
      throw new Error('ppt_html_deck_project_root_outside_workspace');
    }

    const rendererRoot = path.posix.join(workspaceRoot, '.oneceo', 'ppt-html-renderer');
    const exportRoot = path.posix.join(projectRoot, 'export');
    const screenshotRoot = path.posix.join(projectRoot, 'screenshots');
    const geometry = htmlDeckGeometry(validated.aspectRatio);
    const specPath = path.posix.join(rendererRoot, 'html-deck-spec.json');
    const scriptPath = path.posix.join(rendererRoot, 'render-html-deck.mjs');
    const packagePath = path.posix.join(rendererRoot, 'package.json');
    const outputPath = path.posix.join(exportRoot, fileName);
    const reportPath = path.posix.join(exportRoot, 'export-report.json');
    const visualQaReportPath = path.posix.join(exportRoot, 'visual-qa-report.json');

    await e2bConnector.runCommand(input.sandboxId, `mkdir -p ${shellEscape(rendererRoot)} ${shellEscape(exportRoot)} ${shellEscape(screenshotRoot)}`, {
      timeoutMs: 15_000,
    });
    await e2bConnector.writeFile(input.sandboxId, specPath, Buffer.from(JSON.stringify(validated.spec, null, 2), 'utf8'));
    await e2bConnector.writeFile(input.sandboxId, scriptPath, Buffer.from(buildHtmlDeckRendererScript(), 'utf8'));
    await e2bConnector.writeFile(
      input.sandboxId,
      packagePath,
      Buffer.from(JSON.stringify({ type: 'module', dependencies: { pptxgenjs: '^3.12.0' } }, null, 2), 'utf8')
    );

    const stdoutPath = path.posix.join(rendererRoot, 'render.stdout.log');
    const stderrPath = path.posix.join(rendererRoot, 'render.stderr.log');
    const command = [
      'set +e',
      'export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"',
      'ONECEO_NPM_GLOBAL_ROOT="$(npm root -g 2>/dev/null || true)"',
      'ONECEO_NODE_PATH="/usr/local/lib/node_modules"',
      'if [ -n "$ONECEO_NPM_GLOBAL_ROOT" ]; then ONECEO_NODE_PATH="${ONECEO_NODE_PATH}:${ONECEO_NPM_GLOBAL_ROOT}"; fi',
      'if [ -n "${NODE_PATH:-}" ]; then ONECEO_NODE_PATH="${ONECEO_NODE_PATH}:${NODE_PATH}"; fi',
      'export NODE_PATH="$ONECEO_NODE_PATH"',
      `: > ${shellEscape(stdoutPath)}`,
      `: > ${shellEscape(stderrPath)}`,
      `(test -d node_modules/pptxgenjs || npm install --silent --no-audit --no-fund pptxgenjs@^3.12.0) >> ${shellEscape(stdoutPath)} 2>> ${shellEscape(stderrPath)}`,
      'install_code=$?',
      'if [ "$install_code" -eq 0 ]; then',
      `  node ${shellEscape(scriptPath)} ${shellEscape(specPath)} ${shellEscape(projectRoot)} ${shellEscape(outputPath)} ${shellEscape(reportPath)} ${shellEscape(visualQaReportPath)} ${shellEscape(screenshotRoot)} >> ${shellEscape(stdoutPath)} 2>> ${shellEscape(stderrPath)}`,
      '  render_code=$?',
      'else',
      '  render_code=$install_code',
      'fi',
      `cat ${shellEscape(stdoutPath)}`,
      `cat ${shellEscape(stderrPath)} >&2`,
      'printf "\\nONECEO_PPT_HTML_COMMAND_EXIT %s\\n" "$render_code"',
      'exit 0',
    ].join('\n');
    const result = await e2bConnector.runCommand(input.sandboxId, command, {
      cwd: rendererRoot,
      timeoutMs: 240_000,
    });

    const commandExitMarker = asText(result.stdout)
      .split('\n')
      .find((line) => line.startsWith('ONECEO_PPT_HTML_COMMAND_EXIT '));
    const commandExitCode = commandExitMarker ? Number(commandExitMarker.slice('ONECEO_PPT_HTML_COMMAND_EXIT '.length)) : result.exitCode;
    if (result.exitCode !== 0 || commandExitCode !== 0) {
      return {
        status: 'failed',
        stage: 'render',
        warnings: [],
        repairHints: ['Inspect HTML deck renderer stderr and repair ppt-html-deck before retrying.'],
        errors: [asText(result.stderr) || asText(result.stdout) || 'ppt_html_deck_render_failed'],
      };
    }

    const marker = asText(result.stdout)
      .split('\n')
      .find((line) => line.startsWith('ONECEO_PPT_HTML_RENDER_RESULT '));
    const parsed = marker ? JSON.parse(marker.slice('ONECEO_PPT_HTML_RENDER_RESULT '.length)) : {};
    if (asText(parsed.status) !== 'completed') {
      return {
        status: 'failed',
        stage: asText(parsed.stage) || 'visual_qa',
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        repairHints: Array.isArray(parsed.repairHints) ? parsed.repairHints : ['Fix the HTML deck project and retry.'],
        errors: Array.isArray(parsed.errors) ? parsed.errors.map((item: unknown) => JSON.stringify(item)) : ['ppt_html_deck_visual_qa_failed'],
        reportPath: toWorkspaceRelative(workspaceRoot, asText(parsed.reportPath) || reportPath),
        visualQaReportPath: toWorkspaceRelative(workspaceRoot, asText(parsed.visualQaReportPath) || visualQaReportPath),
      };
    }
    await touchSandbox(input.sandboxId, 'ppt_html_render');

    return {
      status: 'completed',
      pptxPath: toWorkspaceRelative(workspaceRoot, asText(parsed.pptxPath) || outputPath),
      reportPath: toWorkspaceRelative(workspaceRoot, asText(parsed.reportPath || parsed.exportReportPath) || reportPath),
      htmlManifestPath: toWorkspaceRelative(workspaceRoot, asText(parsed.htmlManifestPath) || path.posix.join(projectRoot, 'manifest.json')),
      visualQaReportPath: toWorkspaceRelative(workspaceRoot, asText(parsed.visualQaReportPath) || visualQaReportPath),
      exportReportPath: toWorkspaceRelative(workspaceRoot, asText(parsed.exportReportPath || parsed.reportPath) || reportPath),
      slideCount: Number(parsed.slideCount) || validated.slideCount,
      exportMode: asText(parsed.exportMode) || 'rasterized_html_screenshots',
      editablePptx: false,
      aspectRatio: asText(parsed.aspectRatio) || validated.aspectRatio,
      slideWidthIn: geometry.widthIn,
      slideHeightIn: geometry.heightIn,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      repairHints: Array.isArray(parsed.repairHints) ? parsed.repairHints : [],
    };
  }
}

export const pptRenderToolService = new PptRenderToolService();
