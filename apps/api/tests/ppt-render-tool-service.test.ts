import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildHtmlDeckRendererScript, buildRendererScript } from '../src/services/ppt-render-tool-service';

function installPptxGenStub(dir: string, options: { captureImages?: boolean } = {}) {
  const moduleDir = path.join(dir, 'node_modules', 'pptxgenjs');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(
    path.join(moduleDir, 'package.json'),
    JSON.stringify({ name: 'pptxgenjs', version: '0.0.0', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(moduleDir, 'index.js'),
    `
const fs = require('node:fs');
const path = require('node:path');
class Slide {
  constructor() { this.background = null; }
  addText(value) {
    if (typeof value !== 'string' && !Array.isArray(value)) {
      throw new Error('addText received non-string value: ' + typeof value);
    }
    if (typeof value === 'string' && value.includes('[object Object]')) {
      throw new Error('addText received object placeholder text');
    }
  }
  addShape() {}
  addImage(input) {
    ${options.captureImages ? "fs.appendFileSync(path.join(process.cwd(), 'image-calls.jsonl'), JSON.stringify(input) + '\\n');" : ''}
  }
}
class PptxGen {
  constructor() { this.layout = ''; this.author = ''; this.company = ''; this.subject = ''; this.title = ''; this.lang = ''; this.theme = {}; this.ShapeType = PptxGen.ShapeType; }
  addSlide() { return new Slide(); }
  async writeFile() {}
}
PptxGen.ShapeType = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', line: 'line' };
module.exports = PptxGen;
`
  );
}

test('renderer script keeps addText inputs string-like for simple ppt instructions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-render-test-'));
  const moduleDir = path.join(dir, 'node_modules', 'pptxgenjs');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(
    path.join(moduleDir, 'package.json'),
    JSON.stringify({ name: 'pptxgenjs', version: '0.0.0', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(moduleDir, 'index.js'),
    `
class Slide {
  constructor() { this.background = null; }
  addText(value) {
    if (typeof value !== 'string' && !Array.isArray(value)) {
      throw new Error('addText received non-string value: ' + typeof value);
    }
    if (typeof value === 'string' && value.includes('[object Object]')) {
      throw new Error('addText received object placeholder text');
    }
  }
  addShape() {}
  addImage() {}
}
class PptxGen {
  constructor() { this.layout = ''; this.author = ''; this.company = ''; this.subject = ''; this.title = ''; this.lang = ''; this.theme = {}; this.ShapeType = PptxGen.ShapeType; }
  addSlide() { return new Slide(); }
  async writeFile() {}
}
PptxGen.ShapeType = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', line: 'line' };
module.exports = PptxGen;
`
  );
  fs.writeFileSync(path.join(dir, 'render-pptx.mjs'), buildRendererScript());
  fs.writeFileSync(
    path.join(dir, 'input.json'),
    JSON.stringify({
      deck: {
        title: '中国春节',
        status: 'pre_render_draft',
        purpose: '介绍中国春节',
        audience: '通用观众',
        slideCount: 3,
      },
      theme: {
        colorTokens: {
          text: '#333333',
          primary: '#c3272b',
          background: '#f5f0e6',
        },
        aestheticPreset: 'kraft-paper',
      },
      slides: [
        {
          index: 1,
          title: '中国春节',
          pageType: 'cover',
          visualRole: 'hero-dark',
          coreMessage: '传统节日',
          layoutFamily: 'hero-cover',
        },
        {
          index: 2,
          title: '春节习俗',
          pageType: 'content',
          visualRole: 'light',
          coreMessage: '传统活动',
          layoutFamily: 'lead-image-side-text',
          contentBlocks: [
            { type: 'detail', content: '贴春联、放鞭炮、吃年夜饭体现春节的家庭团圆与辞旧迎新。' },
            { type: 'example', content: '不同地区会延伸出庙会、舞龙舞狮、拜年礼俗等公共活动。' },
          ],
        },
        {
          index: 3,
          title: '谢谢',
          pageType: 'closing',
          visualRole: 'light',
          coreMessage: '感谢观看',
          layoutFamily: 'big-quote',
          contentBlocks: [{ type: 'bigQuote', content: '春节快乐' }],
        },
      ],
      sources: [],
      openQuestions: [],
    })
  );

  const output = execFileSync(
    process.execPath,
    ['render-pptx.mjs', 'input.json', 'deliverables/output.pptx', 'deliverables/report.json'],
    { cwd: dir, encoding: 'utf8' }
  );

  assert.match(output, /ONECEO_PPT_RENDER_RESULT/);
});

test('renderer script reports material, density, and layout quality gates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-render-test-'));
  const moduleDir = path.join(dir, 'node_modules', 'pptxgenjs');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(
    path.join(moduleDir, 'package.json'),
    JSON.stringify({ name: 'pptxgenjs', version: '0.0.0', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(moduleDir, 'index.js'),
    `
class Slide {
  constructor() { this.background = null; }
  addText(value) {
    if (typeof value !== 'string' && !Array.isArray(value)) {
      throw new Error('addText received non-string value: ' + typeof value);
    }
    if (typeof value === 'string' && value.includes('[object Object]')) {
      throw new Error('addText received object placeholder text');
    }
  }
  addShape() {}
  addImage() {}
}
class PptxGen {
  constructor() { this.layout = ''; this.author = ''; this.company = ''; this.subject = ''; this.title = ''; this.lang = ''; this.theme = {}; this.ShapeType = PptxGen.ShapeType; }
  addSlide() { return new Slide(); }
  async writeFile() {}
}
PptxGen.ShapeType = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', line: 'line' };
module.exports = PptxGen;
`
  );
  fs.writeFileSync(path.join(dir, 'render-pptx.mjs'), buildRendererScript());
  fs.writeFileSync(
    path.join(dir, 'input.json'),
    JSON.stringify({
      deck: {
        title: '元宵节介绍',
        purpose: '介绍元宵节民俗',
        audience: '通用观众',
        slideCount: 3,
      },
      theme: {
        colorTokens: {
          text: '#3a1511',
          primary: '#d71920',
          background: '#fff4e1',
        },
      },
      slides: [
        {
          index: 1,
          title: '什么是元宵节？',
          pageType: 'content',
          visualRole: 'light',
          coreMessage: '元宵节是春节后的第一个重要传统节日',
          layoutFamily: 'lead-image-side-text',
          contentBlocks: [{ type: 'detail', text: '农历正月十五庆祝。' }],
          imageSlots: [
            {
              url: 'https://example.com/yuanxiao-word-template-31kuan.jpg',
              alt: '元宵节电子手抄报 WORD格式 可打印 31款',
            },
          ],
        },
        {
          index: 2,
          title: '特色美食',
          pageType: 'comparison',
          visualRole: 'dark',
          coreMessage: '汤圆和元宵承载团圆寓意',
          layoutFamily: 'before-after',
          contentBlocks: [
            { type: 'detail', text: '北方多称元宵，滚制成型，口感扎实。' },
            { type: 'detail', text: '南方多称汤圆，包制成型，口感软糯。' },
          ],
        },
        {
          index: 3,
          title: '现代庆祝方式',
          pageType: 'content',
          visualRole: 'light',
          coreMessage: '各地举办庆祝活动',
          layoutFamily: 'lead-image-side-text',
          contentBlocks: [{ type: 'detail', text: '灯光秀、文化展览等。' }],
        },
      ],
      sources: [],
      openQuestions: [],
    })
  );

  execFileSync(process.execPath, ['render-pptx.mjs', 'input.json', 'deliverables/output.pptx', 'deliverables/report.json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'deliverables', 'report.json'), 'utf8'));
  const warningCodes = report.warnings.map((warning: any) => warning.code);

  assert.ok(warningCodes.includes('low_quality_image_skipped'));
  assert.ok(warningCodes.includes('low_density_slide'));
  assert.ok(warningCodes.includes('layout_semantic_downgraded'));
  assert.equal(report.status, 'completed');
});

test('renderer script repairs underfilled visual structures instead of drawing empty shells', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-render-test-'));
  const moduleDir = path.join(dir, 'node_modules', 'pptxgenjs');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(
    path.join(moduleDir, 'package.json'),
    JSON.stringify({ name: 'pptxgenjs', version: '0.0.0', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(moduleDir, 'index.js'),
    `
class Slide {
  constructor() { this.background = null; }
  addText(value) {
    if (typeof value !== 'string' && !Array.isArray(value)) {
      throw new Error('addText received non-string value: ' + typeof value);
    }
  }
  addShape() {}
  addImage() {}
}
class PptxGen {
  constructor() { this.layout = ''; this.author = ''; this.company = ''; this.subject = ''; this.title = ''; this.lang = ''; this.theme = {}; this.ShapeType = PptxGen.ShapeType; }
  addSlide() { return new Slide(); }
  async writeFile() {}
}
PptxGen.ShapeType = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', line: 'line' };
module.exports = PptxGen;
`
  );
  fs.writeFileSync(path.join(dir, 'render-pptx.mjs'), buildRendererScript());
  fs.writeFileSync(
    path.join(dir, 'input.json'),
    JSON.stringify({
      deck: {
        title: '元宵节介绍',
        purpose: '介绍元宵节民俗',
        audience: '通用观众',
        slideCount: 3,
      },
      theme: {
        colorTokens: {
          text: '#3a1511',
          primary: '#d71920',
          background: '#fff4e1',
        },
      },
      slides: [
        {
          index: 1,
          title: '万盏花灯映夜空',
          pageType: 'content',
          visualRole: 'light',
          coreMessage: '赏灯是元宵节最核心的民俗',
          layoutFamily: 'image-grid',
          contentBlocks: [
            { type: 'detail', text: '灯会从城市广场延伸到街巷社区' },
            { type: 'example', text: '宫灯、走马灯、花卉灯共同构成节日景观' },
          ],
        },
        {
          index: 2,
          title: '现代元宵节庆祝活动',
          pageType: 'comparison',
          visualRole: 'dark',
          coreMessage: '庆祝方式从家庭团圆扩展到公共文化活动',
          layoutFamily: 'before-after',
          contentBlocks: [{ type: 'detail', text: '传统：赏灯、猜灯谜、吃元宵\n现代：舞龙舞狮、城市灯会、非遗展演' }],
        },
        {
          index: 3,
          title: '千年传承',
          pageType: 'timeline',
          visualRole: 'light',
          coreMessage: '元宵节习俗经历了从宫廷到民间的演变',
          layoutFamily: 'pipeline',
          contentBlocks: [
            { type: 'detail', text: '汉代已有正月十五观灯活动，并逐步形成节日仪式' },
            {
              type: 'bullets',
              items: [
                { text: '唐宋时期城市夜游和灯市兴盛' },
                { label: '民间', content: '赏灯逐渐成为公共娱乐' },
              ],
            },
          ],
        },
      ],
      sources: [],
      openQuestions: [],
    })
  );

  const output = execFileSync(
    process.execPath,
    ['render-pptx.mjs', 'input.json', 'deliverables/output.pptx', 'deliverables/report.json'],
    { cwd: dir, encoding: 'utf8' }
  );
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'deliverables', 'report.json'), 'utf8'));

  assert.match(output, /ONECEO_PPT_RENDER_RESULT/);
  assert.equal(report.slideCount, 3);
  assert.ok(
    report.warnings.some((warning: any) => warning.code === 'image_grid_without_images_rendered_as_cards')
  );
  assert.ok(
    !report.warnings.some((warning: any) => warning.code === 'comparison_without_two_sides_rendered_as_cards')
  );
});

test('renderer script records low-density body slides without blocking export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-render-test-'));
  installPptxGenStub(dir);
  fs.writeFileSync(path.join(dir, 'render-pptx.mjs'), buildRendererScript());
  fs.writeFileSync(
    path.join(dir, 'input.json'),
    JSON.stringify({
      deck: {
        title: '空洞正文测试',
        purpose: '验证质量门',
        audience: '内部团队',
        slideCount: 2,
      },
      theme: {
        colorTokens: {
          text: '#1f2328',
          primary: '#0969da',
          background: '#ffffff',
        },
      },
      slides: [
        {
          index: 1,
          title: '封面',
          pageType: 'cover',
          coreMessage: '质量门测试',
          layoutFamily: 'hero-cover',
        },
        {
          index: 2,
          title: '正文页',
          pageType: 'content',
          coreMessage: '内容很少',
          layoutFamily: 'lead-image-side-text',
          contentBlocks: [{ type: 'detail', text: '一句话。' }],
        },
      ],
      sources: [],
      openQuestions: [],
    })
  );

  execFileSync(process.execPath, ['render-pptx.mjs', 'input.json', 'deliverables/output.pptx', 'deliverables/report.json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'deliverables', 'report.json'), 'utf8'));

  assert.equal(report.status, 'completed');
  assert.ok(report.warnings.some((warning: any) => warning.code === 'low_density_slide'));
});

test('renderer script blocks private image hosts before fetching', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-render-test-'));
  installPptxGenStub(dir);
  fs.writeFileSync(path.join(dir, 'render-pptx.mjs'), buildRendererScript());
  fs.writeFileSync(
    path.join(dir, 'input.json'),
    JSON.stringify({
      deck: {
        title: '图片安全测试',
        purpose: '验证私网图片拦截',
        audience: '内部团队',
        slideCount: 2,
      },
      theme: {
        colorTokens: {
          text: '#1f2328',
          primary: '#0969da',
          background: '#ffffff',
        },
      },
      slides: [
        {
          index: 1,
          title: '封面',
          pageType: 'cover',
          coreMessage: '图片安全测试',
          layoutFamily: 'hero-cover',
        },
        {
          index: 2,
          title: '充分正文',
          pageType: 'content',
          coreMessage: '内容块足够时允许继续渲染',
          layoutFamily: 'big-number',
          contentBlocks: [
            { type: 'detail', text: '第一条内容包含足够信息，解释为什么需要图片安全边界。' },
            { type: 'evidence', text: '第二条内容说明私网地址必须在 fetch 前被拦截。' },
          ],
          imageSlots: [{ url: 'http://127.0.0.1:8080/private.png', alt: 'private' }],
        },
      ],
      sources: [],
      openQuestions: [],
    })
  );

  execFileSync(process.execPath, ['render-pptx.mjs', 'input.json', 'deliverables/output.pptx', 'deliverables/report.json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'deliverables', 'report.json'), 'utf8'));
  const warningCodes = report.warnings.map((warning: any) => warning.code);

  assert.equal(report.status, 'completed');
  assert.ok(warningCodes.includes('image_download_blocked_host'));
});

test('renderer script records blocked required slide images without blocking export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-render-test-'));
  installPptxGenStub(dir);
  fs.writeFileSync(path.join(dir, 'render-pptx.mjs'), buildRendererScript());
  fs.writeFileSync(
    path.join(dir, 'input.json'),
    JSON.stringify({
      deck: {
        title: '图片缺失阻断测试',
        purpose: '验证图片质量门',
        audience: '内部团队',
        slideCount: 2,
      },
      theme: {
        colorTokens: {
          text: '#1f2328',
          primary: '#0969da',
          background: '#ffffff',
        },
      },
      slides: [
        {
          index: 1,
          title: '封面',
          pageType: 'cover',
          coreMessage: '图片应该存在',
          layoutFamily: 'hero-cover',
          imageSlots: [{ url: 'http://localhost:3000/cover.png', alt: 'local image' }],
        },
        {
          index: 2,
          title: '充分正文',
          pageType: 'content',
          coreMessage: '内容块足够，失败只应来自封面图片缺失',
          layoutFamily: 'lead-image-side-text',
          contentBlocks: [
            { type: 'detail', text: '第一条内容包含足够信息，避免正文页低密度误判。' },
            { type: 'evidence', text: '第二条内容用于确认 required_image_missing 才是阻断原因。' },
          ],
        },
      ],
      sources: [],
      openQuestions: [],
    })
  );

  execFileSync(process.execPath, ['render-pptx.mjs', 'input.json', 'deliverables/output.pptx', 'deliverables/report.json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'deliverables', 'report.json'), 'utf8'));
  const warningCodes = report.warnings.map((warning: any) => warning.code);

  assert.equal(report.status, 'completed');
  assert.ok(warningCodes.includes('image_download_blocked_host'));
  assert.ok(report.warnings.some((warning: any) => warning.code === 'required_image_missing'));
});

test('renderer script blocks IPv6 private and mapped private image hosts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-render-test-'));
  installPptxGenStub(dir);
  fs.writeFileSync(path.join(dir, 'render-pptx.mjs'), buildRendererScript());
  fs.writeFileSync(
    path.join(dir, 'input.json'),
    JSON.stringify({
      deck: {
        title: 'IPv6 私网阻断测试',
        purpose: '验证 IPv6 地址边界',
        audience: '内部团队',
        slideCount: 2,
      },
      theme: {
        colorTokens: {
          text: '#1f2328',
          primary: '#0969da',
          background: '#ffffff',
        },
      },
      slides: [
        {
          index: 1,
          title: '封面',
          pageType: 'cover',
          coreMessage: '封面无需图片也可继续',
          layoutFamily: 'hero-cover',
        },
        {
          index: 2,
          title: '正文',
          pageType: 'content',
          coreMessage: '内容块足够时允许继续渲染',
          layoutFamily: 'lead-image-side-text',
          contentBlocks: [
            { type: 'detail', text: '第一条内容包含足够信息，解释为什么 IPv6 私网地址也要拦截。' },
            { type: 'evidence', text: '第二条内容说明地址格式变化不能绕过图片安全边界。' },
          ],
          imageSlots: [{ url: 'http://[::ffff:127.0.0.1]/private.png', alt: 'mapped private ipv6 image' }],
        },
      ],
      sources: [],
      openQuestions: [],
    })
  );

  execFileSync(process.execPath, ['render-pptx.mjs', 'input.json', 'deliverables/output.pptx', 'deliverables/report.json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'deliverables', 'report.json'), 'utf8'));
  const warningCodes = report.warnings.map((warning: any) => warning.code);

  assert.equal(report.status, 'completed');
  assert.ok(warningCodes.includes('image_download_blocked_host'));
  assert.ok(report.warnings.some((warning: any) => warning.code === 'required_image_missing'));
});

test('html deck renderer uses 4:3 geometry when requested', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-html-render-test-'));
  installPptxGenStub(dir, { captureImages: true });
  const playwrightDir = path.join(dir, 'node_modules', 'playwright');
  fs.mkdirSync(playwrightDir, { recursive: true });
  fs.writeFileSync(path.join(playwrightDir, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0', main: 'index.js' }));
  fs.writeFileSync(
    path.join(playwrightDir, 'index.js'),
    `
const fs = require('node:fs');
exports.chromium = {
  async launch() {
    return {
      async newContext(options) {
        fs.writeFileSync('viewport.json', JSON.stringify(options.viewport));
        return {
          async newPage() {
            return {
              async goto() {},
              async waitForTimeout() {},
              async evaluate(fn, arg) {
                if (arg) {
                  return {
                    textLength: 12,
                    scrollWidth: arg.fallbackWidth,
                    scrollHeight: arg.fallbackHeight,
                    clientWidth: arg.fallbackWidth,
                    clientHeight: arg.fallbackHeight,
                    bodyChildren: 1,
                    slideId: 'slide-1',
                    slideIndex: '1',
                    backgroundColor: 'rgb(255, 255, 255)',
                    fontFamily: 'Aptos',
                    styleTagCount: 2,
                    stylesheetLinkCount: 0,
                    renderedHtmlPath: arg.renderedHtmlPath,
                    sourceCssApplied: arg.sourceCssApplied,
                    sourceMode: arg.sourceMode,
                    sharedCssApplied: arg.sharedCssApplied,
                    slideCssApplied: arg.slideCssApplied
                  };
                }
                return '可见文本';
              },
              async screenshot({ path }) { fs.writeFileSync(path, 'png'); },
              async close() {}
            };
          },
          async close() {}
        };
      },
      async close() {}
    };
  }
};
`
  );
  fs.mkdirSync(path.join(dir, 'slides'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><style>.slide{background:#fff;font-family:Aptos}</style></head><body></body></html>');
  fs.writeFileSync(path.join(dir, 'slides', '001-cover.html'), '<div data-slide-id="slide-1" data-slide-index="1">Cover</div>');
  fs.writeFileSync(path.join(dir, 'render-html-deck.mjs'), buildHtmlDeckRendererScript());
  fs.writeFileSync(
    path.join(dir, 'spec.json'),
    JSON.stringify({
      taskType: 'ppt_html_deck',
      deck: { title: '四比三', slideCount: 1, aspectRatio: '4:3' },
      slides: [{ id: 'slide-1', index: 1, slideArchetype: 'cover', htmlFile: 'slides/001-cover.html' }],
      sources: [],
      openQuestions: [],
    })
  );

  execFileSync(
    process.execPath,
    ['render-html-deck.mjs', 'spec.json', dir, 'export/deck.pptx', 'export/export-report.json', 'export/visual-qa-report.json', 'screenshots'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(dir, 'node_modules') } }
  );
  const viewport = JSON.parse(fs.readFileSync(path.join(dir, 'viewport.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'export', 'export-report.json'), 'utf8'));
  const imageCalls = fs.readFileSync(path.join(dir, 'image-calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

  assert.deepEqual(viewport, { width: 1024, height: 768 });
  assert.equal(report.aspectRatio, '4:3');
  assert.equal(report.editablePptx, false);
  assert.equal(imageCalls[0].w, 10);
  assert.equal(imageCalls[0].h, 7.5);
});

test('html deck renderer wraps slide fragments with shared index css before screenshotting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-html-render-test-'));
  installPptxGenStub(dir, { captureImages: true });
  const playwrightDir = path.join(dir, 'node_modules', 'playwright');
  fs.mkdirSync(playwrightDir, { recursive: true });
  fs.writeFileSync(path.join(playwrightDir, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0', main: 'index.js' }));
  fs.writeFileSync(
    path.join(playwrightDir, 'index.js'),
    `
const fs = require('node:fs');
const url = require('node:url');
let lastGoto = '';
exports.chromium = {
  async launch() {
    return {
      async newContext(options) {
        fs.writeFileSync('viewport.json', JSON.stringify(options.viewport));
        return {
          async newPage() {
            return {
              async goto(targetUrl) { lastGoto = targetUrl; fs.writeFileSync('goto-url.txt', targetUrl); },
              async waitForTimeout() {},
              async evaluate(fn, arg) {
                if (arg) {
                  const renderedPath = url.fileURLToPath(lastGoto);
                  const html = fs.readFileSync(renderedPath, 'utf8');
                  fs.writeFileSync('rendered-html.html', html);
                  return {
                    textLength: html.includes('核心观点') ? 4 : 0,
                    scrollWidth: arg.fallbackWidth,
                    scrollHeight: arg.fallbackHeight,
                    clientWidth: arg.fallbackWidth,
                    clientHeight: arg.fallbackHeight,
                    bodyChildren: 1,
                    slideId: 'slide-1',
                    slideIndex: '1',
                    backgroundColor: html.includes('rgb(12, 34, 56)') ? 'rgb(12, 34, 56)' : 'rgb(255, 255, 255)',
                    fontFamily: html.includes('Aptos') ? 'Aptos' : 'serif',
                    styleTagCount: (html.match(/<style/g) || []).length,
                    stylesheetLinkCount: 0,
                    renderedHtmlPath: arg.renderedHtmlPath,
                    sourceCssApplied: arg.sourceCssApplied,
                    sourceMode: arg.sourceMode,
                    sharedCssApplied: arg.sharedCssApplied,
                    slideCssApplied: arg.slideCssApplied
                  };
                }
                return '核心观点';
              },
              async screenshot({ path }) { fs.writeFileSync(path, 'png'); },
              async close() {}
            };
          },
          async close() {}
        };
      },
      async close() {}
    };
  }
};
`
  );
  fs.mkdirSync(path.join(dir, 'slides'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    [
      '<!doctype html>',
      '<html><head>',
      '<style>.slide{background:rgb(12, 34, 56);font-family:Aptos;color:white}</style>',
      '</head><body></body></html>',
    ].join('')
  );
  fs.writeFileSync(path.join(dir, 'slides', '001-cover.html'), '<section class="slide" data-slide-id="slide-1" data-slide-index="1"><h1>核心观点</h1></section>');
  fs.writeFileSync(path.join(dir, 'render-html-deck.mjs'), buildHtmlDeckRendererScript());
  fs.writeFileSync(
    path.join(dir, 'spec.json'),
    JSON.stringify({
      taskType: 'ppt_html_deck',
      deck: { title: 'CSS 注入', slideCount: 1, aspectRatio: '16:9' },
      slides: [{ id: 'slide-1', index: 1, slideArchetype: 'cover', htmlFile: 'slides/001-cover.html' }],
      sources: [],
      openQuestions: [],
    })
  );

  execFileSync(
    process.execPath,
    ['render-html-deck.mjs', 'spec.json', dir, 'export/deck.pptx', 'export/export-report.json', 'export/visual-qa-report.json', 'screenshots'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(dir, 'node_modules') } }
  );
  const renderedHtml = fs.readFileSync(path.join(dir, 'rendered-html.html'), 'utf8');
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'export', 'visual-qa-report.json'), 'utf8'));

  assert.match(renderedHtml, /<!doctype html>/i);
  assert.match(renderedHtml, /\.slide\{background:rgb\(12, 34, 56\);font-family:Aptos;color:white\}/);
  assert.match(renderedHtml, /<section class="slide" data-slide-id="slide-1" data-slide-index="1">/);
  assert.match(fs.readFileSync(path.join(dir, 'goto-url.txt'), 'utf8'), /\.oneceo-rendered-slides\/slides\/001-cover\.html$/);
  assert.equal(report.status, 'completed');
  assert.equal(report.slides[0].metrics.sourceCssApplied, true);
  assert.equal(report.slides[0].metrics.sharedCssApplied, true);
  assert.equal(report.slides[0].metrics.sourceMode, 'fragment');
});

test('html deck renderer does not block export on low contrast text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneceo-ppt-html-render-test-'));
  installPptxGenStub(dir, { captureImages: true });
  const playwrightDir = path.join(dir, 'node_modules', 'playwright');
  fs.mkdirSync(playwrightDir, { recursive: true });
  fs.writeFileSync(path.join(playwrightDir, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0', main: 'index.js' }));
  fs.writeFileSync(
    path.join(playwrightDir, 'index.js'),
    `
const fs = require('node:fs');
exports.chromium = {
  async launch() {
    return {
      async newContext() {
        return {
          async newPage() {
            return {
              async goto() {},
              async waitForTimeout() {},
              async evaluate(fn, arg) {
                if (arg) {
                  return {
                    textLength: 4,
                    scrollWidth: arg.fallbackWidth,
                    scrollHeight: arg.fallbackHeight,
                    clientWidth: arg.fallbackWidth,
                    clientHeight: arg.fallbackHeight,
                    bodyChildren: 1,
                    slideId: 'slide-1',
                    slideIndex: '1',
                    backgroundColor: 'rgb(255, 255, 255)',
                    fontFamily: 'Aptos',
                    styleTagCount: 2,
                    stylesheetLinkCount: 0,
                    renderedHtmlPath: arg.renderedHtmlPath,
                    sourceCssApplied: arg.sourceCssApplied,
                    sourceMode: arg.sourceMode,
                    sharedCssApplied: arg.sharedCssApplied,
                    slideCssApplied: arg.slideCssApplied
                  };
                }
                return '低对比度文字';
              },
              async screenshot({ path }) { fs.writeFileSync(path, 'png'); },
              async close() {}
            };
          },
          async close() {}
        };
      },
      async close() {}
    };
  }
};
`
  );
  fs.mkdirSync(path.join(dir, 'slides'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><style>.slide{background:#fff;color:#f5f5f5}</style></head><body></body></html>');
  fs.writeFileSync(path.join(dir, 'slides', '001-cover.html'), '<section class="slide" data-slide-id="slide-1" data-slide-index="1"><p>低对比度文字</p></section>');
  fs.writeFileSync(path.join(dir, 'render-html-deck.mjs'), buildHtmlDeckRendererScript());
  fs.writeFileSync(
    path.join(dir, 'spec.json'),
    JSON.stringify({
      taskType: 'ppt_html_deck',
      deck: { title: '低对比度', slideCount: 1, aspectRatio: '16:9' },
      slides: [{ id: 'slide-1', index: 1, slideArchetype: 'cover', htmlFile: 'slides/001-cover.html' }],
      sources: [],
      openQuestions: [],
    })
  );

  execFileSync(
    process.execPath,
    ['render-html-deck.mjs', 'spec.json', dir, 'export/deck.pptx', 'export/export-report.json', 'export/visual-qa-report.json', 'screenshots'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(dir, 'node_modules') } }
  );
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'export', 'export-report.json'), 'utf8'));
  const visualReport = JSON.parse(fs.readFileSync(path.join(dir, 'export', 'visual-qa-report.json'), 'utf8'));

  assert.equal(report.status, 'completed');
  assert.equal(visualReport.status, 'completed');
  assert.equal(visualReport.slides[0].metrics.sourceCssApplied, true);
  assert.equal(visualReport.fatalErrors.length, 0);
});
