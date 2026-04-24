import { runLanguageMatrix } from './language-matrix-runner.mjs';

const NON_DEPLOYABLE_CASES = [
  {
    id: 'ND-HTML-01',
    description: 'HTML 邮件模板不应误部署',
    prompt:
      '请帮我写一个 HTML 邮件模板，用于报价通知邮件。只需要输出源码文件，不需要做网站，也不要部署。',
    workspaceIndicators: [/\.(html?)$/i],
  },
  {
    id: 'ND-JS-01',
    description: 'JavaScript 工具脚本不应误部署',
    prompt:
      '请写一个 JavaScript 脚本，用来读取本地 JSON 文件并输出统计结果。不要做网站，也不要部署。',
    workspaceIndicators: [/\.(js|mjs|cjs)$/i],
  },
  {
    id: 'ND-NODE-01',
    description: 'Node.js CLI 不应误部署',
    prompt:
      '请写一个 Node.js CLI 工具，用来批量重命名文件。不要做网页，也不要部署。',
    workspaceIndicators: [/package\.json/i, /(cli|rename|index|main)\.(js|ts)/i],
  },
  {
    id: 'ND-PY-01',
    description: 'Python 数据处理脚本不应误部署',
    prompt:
      '请写一个 Python 脚本，读取 CSV 并输出统计报告。不要做网站，也不要部署。',
    workspaceIndicators: [/\.(py)$/i],
  },
  {
    id: 'ND-JAVA-01',
    description: 'Java Console 程序不应误部署',
    prompt:
      '请写一个 Java 控制台程序，模拟库存管理。不要做网页，也不要部署。',
    workspaceIndicators: [/(pom\.xml|build\.gradle|src\/main\/java)/i],
  },
  {
    id: 'ND-PHP-01',
    description: 'PHP CLI 脚本不应误部署',
    prompt:
      '请写一个 PHP 命令行脚本，用于日志汇总。不要做网站，也不要部署。',
    workspaceIndicators: [/\.php$/i],
  },
];

runLanguageMatrix({
  matrixId: 'non-deployable-script-language-matrix',
  classification: 'non_deployable_script',
  cases: NON_DEPLOYABLE_CASES,
}).catch((error) => {
  console.error('[non-deployable-script-language-matrix] failure', error);
  process.exit(1);
});
