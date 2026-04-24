import { runLanguageMatrix } from './language-matrix-runner.mjs';

const DEPLOYABLE_CASES = [
  {
    id: 'WD-HTML-01',
    description: '纯静态 HTML 多页面网站应可部署',
    prompt:
      '请用纯 HTML、CSS 和少量原生 JavaScript 开发一个工业企业官网，包含首页、产品页、公司介绍页和联系页。不要使用后端框架，只完成完整网站代码。',
    workspaceIndicators: [/index\.html/i, /(about|company|contact|products?)\.(html?)/i],
    publicPageRegex: /company|contact|product|industrial|官网|公司|产品/i,
  },
  {
    id: 'WD-JS-01',
    description: 'JavaScript 前端网站应可部署',
    prompt:
      '请用 JavaScript 构建一个前端产品展示网站，优先使用 Vite 或等价前端工程化方式，页面需要有产品介绍、公司介绍和联系表单，只完成代码。',
    workspaceIndicators: [/package\.json/i, /(vite\.config|src\/main|src\/app|index\.html)/i],
    publicPageRegex: /product|company|contact|javascript|产品|公司|联系/i,
  },
  {
    id: 'WD-NODE-01',
    description: 'Node.js 网站应可部署',
    prompt:
      '请用 Node.js 开发一个企业官网，允许使用 Express、Koa 或 Fastify，页面需要有产品列表、公司介绍和联系信息，只完成代码。',
    workspaceIndicators: [/package\.json/i, /(server|app|index)\.(js|ts)/i],
    publicPageRegex: /product|company|contact|node|产品|公司|联系/i,
  },
  {
    id: 'WD-PY-01',
    description: 'Python 网站应可部署',
    prompt:
      '请用 Python 开发一个公司官网，可以使用 Flask、FastAPI 或 Django，页面需要有产品介绍、公司介绍和联系方式，只完成代码。',
    workspaceIndicators: [
      /(requirements\.txt|pyproject\.toml|Pipfile)/i,
      /((app|main|manage|run)\.py|app\/__init__\.py)/i,
    ],
    publicPageRegex: /product|company|contact|python|产品|公司|联系/i,
  },
  {
    id: 'WD-JAVA-01',
    description: 'Java 网站应可部署',
    prompt:
      '请用 Java 开发一个企业官网，优先使用 Spring Boot 或其他 Java Web 方案，页面需要有产品介绍、公司介绍和联系信息，只完成代码。',
    workspaceIndicators: [/(pom\.xml|build\.gradle)/i, /src\/main\/java/i],
    publicPageRegex: /product|company|contact|java|产品|公司|联系/i,
  },
  {
    id: 'WD-PHP-01',
    description: 'PHP 网站应可部署',
    prompt:
      '请用 PHP 开发一个展示型企业网站，包含首页、产品页、公司介绍和联系页，只完成代码。',
    workspaceIndicators: [/(index|home|contact)\.php/i],
    publicPageRegex: /product|company|contact|php|产品|公司|联系/i,
  },
];

runLanguageMatrix({
  matrixId: 'deployable-website-language-matrix',
  classification: 'deployable_website',
  cases: DEPLOYABLE_CASES,
}).catch((error) => {
  console.error('[deployable-website-language-matrix] failure', error);
  process.exit(1);
});
