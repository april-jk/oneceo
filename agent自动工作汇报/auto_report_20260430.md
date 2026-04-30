## 2026-04-30

- 修复 oneceo.space 默认部署域名绑定链路：Railway 自定义域名除了 CNAME 外，还需要写入 ownership TXT 验证记录，后端现在会读取 `verificationDnsHost` / `verificationToken` 并同步到 Cloudflare。
- 修复部署面板状态收敛：`pending_dns` / `pending_certificate` 会继续触发 live refresh，Railway 证书生效后平台状态会更新为 `active`，并统一展示 `oneceo.space 默认域名已生效`。
- 验证会话 `737373f7-7f5a-4e31-b3f5-f78126045931`：Railway custom domain 已 verified，平台部署接口返回 `domainStatus=active`，浏览器可打开 `https://app-737373f7-7f5-dd76de-3bc30f.oneceo.space/`。
- 修复部署统计域名错位：Umami 绑定和注入配置现在优先使用 oneceo.space public URL / publicDomain，旧 Railway websiteName 会在 live refresh 时收敛为 oneceo.space。验证该会话统计接口返回 `tracking`，`pageviews=7`、`visits=7`、`visitors=6`。
