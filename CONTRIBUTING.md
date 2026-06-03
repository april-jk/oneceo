# Contributing to OneCEO

感谢你愿意为 OneCEO 贡献代码。

## Before You Start

1. 先阅读 [README.md](/Users/watson/codingProj/oneceo/README.md) 里的环境与验证说明。
2. 若改动涉及核心链路，建议同步阅读：
   - [AGENTS.md](/Users/watson/codingProj/oneceo/AGENTS.md)
   - [docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md)
3. 仅修改与你的主题直接相关的文件，避免顺手做无关重构。

## Local Setup

```bash
pnpm install --frozen-lockfile
npm --prefix apps/admin_management install
cp apps/.env.example apps/.env
```

## Minimal Verification

提交前至少运行与你改动范围对应的最小静态检查：

```bash
pnpm --filter api type-check
pnpm --filter web check
npm --prefix apps/admin_management run type-check
```

如果改动影响多个应用，请把相关检查一起跑完。

## Pull Requests

1. 说明改了什么、为什么改。
2. 列出你本地跑过的验证命令。
3. 如果改动会影响环境变量、部署或权限模型，请在 PR 描述里明确写出。
4. 不要在 PR 中提交真实密钥、`.env` 文件、测试账号或私有凭据。

## Scope Expectations

- 小步提交，保持 diff 可审阅。
- 优先修正当前问题，不把 PR 扩散成大范围重构。
- 涉及 `docs/`、README、接口路径或环境变量时，请同步更新文档。

## Reporting Security Issues

请不要在公开 issue 中直接披露漏洞细节。安全问题请按 [SECURITY.md](/Users/watson/codingProj/oneceo/SECURITY.md) 的方式私下报告。
