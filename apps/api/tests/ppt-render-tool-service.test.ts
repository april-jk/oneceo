import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildRendererScript } from '../src/services/ppt-render-tool-service';

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
          contentBlocks: [{ type: 'paragraph', content: '贴春联、放鞭炮、吃年夜饭' }],
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
            { type: 'detail', text: '唐宋时期城市夜游和灯市兴盛，赏灯成为公共娱乐' },
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
