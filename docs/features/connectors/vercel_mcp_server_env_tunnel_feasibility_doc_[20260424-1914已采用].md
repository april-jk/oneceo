# Vercel MCP Server 鐜鍙橀噺鍖栦笌鍐呯綉绌块€忓彲琛屾€ф枃妗?[20260424-1914宸查噰鐢╙

## 20260424-状态更新

本文件中的内网穿透与 public URL 配置仍可参考；其中关于普通 Vercel OAuth endpoint、PKCE、userinfo、revoke token、VERCEL_MCP_REMOTE_URL 的内容已被 Vercel Integration 授权方案替代。

鏇存柊鏃堕棿锛?026-04-24

## 1. 鑳屾櫙涓庣洰鏍?
褰撳墠鐩爣鏄疄鐜颁竴鏉＄ǔ瀹氬彲閮ㄧ讲鐨?Vercel MCP Server 閾捐矾锛?
`Agent -> oneceo Vercel MCP Server -> Vercel REST API`

浣犲綋鍓嶅凡缁忛€氳繃鍐呯綉绌块€忔妸鏈湴 Web 寮€鍙戠鍙ｆ毚闇插埌鍏綉銆傝鍦板潃鍙簲浣滀负鏈湴鑱旇皟鍏ュ彛锛屼笉鑳藉啓姝昏繘浠ｇ爜鎴栬璁℃枃妗ｄ腑鐨勫浐瀹氶厤缃€傚悗缁儴缃插埌鏈嶅姟鍣ㄦ椂锛屽簲鍙浛鎹㈢幆澧冨彉閲忥紝涓嶆敼涓氬姟浠ｇ爜銆?
鏈柟妗堟枃妗ｅ彧璁ㄨ Vercel MCP Server 鐨勫彲琛屾€с€佺幆澧冨彉閲忚璁°€佹湰鍦?ngrok/鐢熶骇閮ㄧ讲宸紓銆佸叧閿摼璺笌楠屾敹鏍囧噯銆備唬鐮佸疄鐜伴渶鍦ㄤ綘纭鏈枃妗ｅ悗鍐嶈繘鍏ャ€?
## 2. 瀹樻柟渚濇嵁

Vercel 瀹樻柟璧勬枡鏀寔鏈柟妗堟垚绔嬶細

1. Vercel REST API
   - 瀹樻柟鏂囨。锛?https://vercel.com/docs/rest-api>
   - REST API 鍩虹鍦板潃涓?`https://api.vercel.com`銆?   - 璇锋眰浣跨敤 `Authorization: Bearer <TOKEN>`銆?   - 鍥㈤槦璧勬簮璁块棶鍙€氳繃 query string 杩藉姞 `teamId`銆?
2. Sign in with Vercel / Authorization Server API
   - 瀹樻柟鏂囨。锛?https://vercel.com/docs/sign-in-with-vercel/authorization-server-api>
   - Authorization Endpoint锛歚https://vercel.com/oauth/authorize`
   - Token Endpoint锛歚https://api.vercel.com/login/oauth/token`
   - Revoke Token Endpoint锛歚https://api.vercel.com/login/oauth/token/revoke`
   - User Info Endpoint锛歚https://api.vercel.com/login/oauth/userinfo`

3. Vercel MCP Server 鑳藉姏
   - 瀹樻柟鏂囨。锛?https://vercel.com/docs/mcp/vercel-mcp/tools>
   - 瀹樻柟 MCP 宸ュ叿瑕嗙洊鏂囨。鎼滅储銆佸洟闃熴€侀」鐩€侀儴缃层€佹棩蹇楃瓑鑳藉姏銆?   - 瀹樻柟鎻愰啋锛歁CP 宸ュ叿鎵ц搴斿惎鐢?human confirmation锛屽苟娉ㄦ剰 prompt injection 椋庨櫓銆?
4. 鑷畾涔?MCP Server 鍙儴缃插埌 Vercel
   - 瀹樻柟鏂囨。锛?https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel>
   - Vercel 鏀寔閮ㄧ讲鑷畾涔?MCP Server锛屽苟鍙粨鍚?Vercel Functions銆丱Auth銆侀瑙堥儴缃插拰闃叉姢鑳藉姏銆?
鍥犳锛宱neceo 鑷缓 Vercel MCP Server 鍐嶈皟鐢?Vercel REST API 鏄彲琛岃矾寰勩€?
## 3. 褰撳墠宸ョ▼浜嬪疄

褰撳墠浠撳簱宸茬粡瀛樺湪 Vercel connector 涓荤嚎璁捐涓庨儴鍒嗗疄鐜帮細

1. Vercel OAuth-only 鏂规鏂囨。
   - `docs/features/connectors/vercel_internal_mcp_wrapper_oauth_only_execution_plan_[20260422-2201宸查噰鐢╙.md`

2. OAuth 鐐瑰嚮杩炴帴淇鏂囨。
   - `docs/features/connectors/vercel_oauth_connect_click_flow_fix_doc_[20260423-2321宸查噰鐢╙.md`

3. streamable_http 鏈湴 bridge 淇鏂囨。
   - `docs/features/connectors/vercel_streamable_http_local_bridge_fix_doc_[20260424-0008宸查噰鐢╙.md`

4. 鐜版湁鍏抽敭浠ｇ爜浣嶇疆
   - `apps/api/src/connectors/definitions/vercel.ts`
   - `apps/api/src/routes/internal-vercel-mcp-routes.ts`
   - `apps/api/src/services/vercel-mcp-service.ts`
   - `apps/api/src/services/vercel-rest-client.ts`
   - `apps/api/src/services/vercel-token-refresh-service.ts`
   - `apps/api/src/connectors/bridges/vercel-stdio-bridge.ts`
   - `apps/api/src/services/connector-registry.ts`

褰撳墠闂鐨勬牳蹇冧笉鏄€淰ercel REST API 鏄惁鍙鈥濓紝鑰屾槸鏈湴寮€鍙戞椂濡備綍璁?sandbox/runtime 鍐呯殑 bridge 鑳借闂埌 oneceo API 鐨?internal MCP endpoint銆?
## 4. 涓轰粈涔堜笉鑳藉啓姝?ngrok 鍦板潃

ngrok 鍏嶈垂鍩熷悕閫氬父浼氬彉鍖栵紝鍐欐浼氬鑷达細

1. 鏈湴閲嶅惎 ngrok 鍚庨厤缃け鏁堛€?2. OAuth redirect URI 涓?Vercel App 閰嶇疆涓嶄竴鑷淬€?3. sandbox bridge 浠嶈姹傛棫鍦板潃銆?4. 鐢熶骇閮ㄧ讲鏃跺繀椤绘敼浠ｇ爜锛岃繚鑳岀幆澧冮殧绂汇€?
鍥犳鎵€鏈夊叕缃戝叆鍙ｅ繀椤婚€氳繃鐜鍙橀噺琛ㄨ揪銆?
## 5. 鎺ㄨ崘鐜鍙橀噺璁捐

### 5.1 鍏叡鍩虹鍦板潃

寤鸿缁熶竴浣跨敤浠ヤ笅璇箟锛?
```env
# 鐢ㄦ埛娴忚鍣ㄨ闂?oneceo Web 鐨勫叕缃戝湴鍧€銆傛湰鍦拌仈璋冩椂濉?ngrok Web 鍦板潃锛岀敓浜у～姝ｅ紡鍓嶇鍩熷悕銆?FRONTEND_URL=https://<public-web-host>

# API 鐨勫叕缃戝湴鍧€銆傜敓浜у缓璁寚鍚戠湡瀹?API 鍩熷悕锛涙湰鍦拌仈璋冨彲鎸変唬鐞嗘柟妗堥€夋嫨鏄惁绛変簬 FRONTEND_URL銆?ONECEO_API_PUBLIC_URL=https://<public-api-host>
```

璇存槑锛?
1. 褰撳墠浠撳簱宸叉湁 `FRONTEND_URL`锛岀敤浜?OAuth redirect URI 瑙ｆ瀽銆丆ORS 鐧藉悕鍗曠瓑銆?2. `ONECEO_API_PUBLIC_URL` 鏄缓璁柊澧炵殑璇箟鍙橀噺锛岀敤浜庨伩鍏嶆妸 internal MCP URL 璇粦鍒?Web 鍩熷悕銆?3. 濡傛灉鏈湴寮€鍙戝彧鏆撮湶 Web 绔彛 3000锛屼笖 Vite 宸叉妸 `/api` 浠ｇ悊鍒版湰鍦?API 4000锛屽垯 `ONECEO_API_PUBLIC_URL` 鍙互鏆傛椂绛変簬 `FRONTEND_URL`銆?4. 鐢熶骇鐜涓嶅缓璁緷璧?Vite 浠ｇ悊锛宍ONECEO_API_PUBLIC_URL` 搴旂洿鎺ユ寚鍚?API 鏈嶅姟鍏綉鍩熷悕鎴栧弽鍚戜唬鐞嗗悗鐨?API 鍏ュ彛銆?
### 5.2 Vercel OAuth 閰嶇疆

```env
VERCEL_CONNECTOR_CLIENT_ID=<vercel-oauth-client-id>
VERCEL_CONNECTOR_CLIENT_SECRET=<vercel-oauth-client-secret>
VERCEL_CONNECTOR_REDIRECT_URI=/vercel/callback
VERCEL_CONNECTOR_SCOPES=
```

瑙ｆ瀽瑙勫垯锛?
1. `VERCEL_CONNECTOR_REDIRECT_URI` 鎺ㄨ崘淇濇寔鐩稿璺緞銆?2. 鏈嶅姟绔€氳繃 `FRONTEND_URL + VERCEL_CONNECTOR_REDIRECT_URI` 鐢熸垚瀹屾暣鍥炶皟鍦板潃銆?3. Vercel OAuth App 鍚庡彴閰嶇疆鐨?redirect URI 蹇呴』涓庢渶缁堢敓鎴愬湴鍧€涓€鑷淬€?
鏈湴鑱旇皟绀轰緥锛?
```env
FRONTEND_URL=https://<your-ngrok-host>
VERCEL_CONNECTOR_REDIRECT_URI=/vercel/callback
```

鏈€缁堝洖璋冨湴鍧€涓猴細

```txt
https://<your-ngrok-host>/vercel/callback
```

### 5.3 oneceo Internal MCP 閰嶇疆

```env
ONECEO_INTERNAL_TOKEN=<strong-random-token>
VERCEL_INTERNAL_MCP_URL=${ONECEO_API_PUBLIC_URL}/api/internal/connectors/vercel/mcp
VERCEL_BRIDGE_TIMEOUT_MS=30000
```

璇存槑锛?
1. `ONECEO_INTERNAL_TOKEN` 鐢ㄤ簬淇濇姢鍐呴儴 MCP 璺敱銆?2. `VERCEL_INTERNAL_MCP_URL` 鏄?sandbox/runtime 鍐?Vercel bridge 璁块棶 oneceo internal MCP 鐨勫湴鍧€銆?3. 杩欎釜鍦板潃蹇呴』浠?sandbox/runtime 鍙闂€?4. 涓嶈兘鍦?sandbox 閾捐矾涓娇鐢?`http://127.0.0.1:4000` 鎴?`http://localhost:4000` 鎸囧悜瀹夸富鏈猴紝鍥犱负 sandbox 鍐呯殑 localhost 鎸囧悜 sandbox 鑷繁銆?
### 5.4 鏈湴 ngrok 寮€鍙戞帹鑽愰厤缃?
濡傛灉鍙妸 Web 绔彛 3000 鏆撮湶鍑哄幓锛屽苟涓?Vite `/api` 浠ｇ悊鍒版湰鍦?API 4000锛?
```env
FRONTEND_URL=https://<your-ngrok-host>
ONECEO_API_PUBLIC_URL=https://<your-ngrok-host>
VERCEL_INTERNAL_MCP_URL=https://<your-ngrok-host>/api/internal/connectors/vercel/mcp
VERCEL_CONNECTOR_REDIRECT_URI=/vercel/callback
ONECEO_INTERNAL_TOKEN=<local-random-token>
```

鍚屾椂 Web Vite dev server 蹇呴』鍏佽 ngrok Host銆?
寤鸿涓嶈鎶婃煇涓复鏃?ngrok host 鍐欐鍒?`vite.config.ts`銆傛洿濂界殑鏂瑰紡鏄柊澧炵幆澧冨彉閲忥細

```env
WEB_DEV_ALLOWED_HOSTS=.ngrok-free.app
```

鐒跺悗鐢?Vite 閰嶇疆璇诲彇骞惰拷鍔犲埌 `server.allowedHosts`銆?
濡傛灉鏆傛椂涓嶆敼浠ｇ爜锛屼篃鍙互涓存椂鍦?`allowedHosts` 涓姞鍏?`.ngrok-free.app`銆備絾闀挎湡鏂规搴旇蛋鐜鍙橀噺銆?
### 5.5 鐢熶骇閮ㄧ讲鎺ㄨ崘閰嶇疆

鐢熶骇鐜寤鸿鍒嗙鍓嶇鍩熷悕鍜?API 鍩熷悕锛?
```env
FRONTEND_URL=https://app.example.com
ONECEO_API_PUBLIC_URL=https://api.example.com
VERCEL_INTERNAL_MCP_URL=https://api.example.com/api/internal/connectors/vercel/mcp
VERCEL_CONNECTOR_REDIRECT_URI=/vercel/callback
ONECEO_INTERNAL_TOKEN=<production-secret>
```

鐢熶骇鐜杩橀渶瑕侊細

1. API CORS 鍏佽 `FRONTEND_URL`銆?2. Vercel OAuth App redirect URI 閰嶇疆涓?`https://app.example.com/vercel/callback`銆?3. `VERCEL_INTERNAL_MCP_URL` 鎵€鍦?API 璺敱鍙厑璁稿唴閮?token 璁块棶銆?4. 鏃ュ織涓嶅緱杈撳嚭 OAuth access token銆乺efresh token銆乮nternal token銆乺untime auth token銆?
## 6. 鐩爣閾捐矾璁捐

### 6.1 鐢ㄦ埛鎺堟潈閾捐矾

```txt
鐢ㄦ埛鐐瑰嚮杩炴帴 Vercel
-> Web 璋冪敤 /api/connectors/vercel/oauth/start
-> API 鍒涘缓 state + PKCE + profile
-> 娴忚鍣ㄨ烦杞?Vercel Authorization Endpoint
-> Vercel 鍥炶皟 FRONTEND_URL + /vercel/callback
-> Web 璋冪敤 /api/connectors/vercel/oauth/callback
-> API 鎹㈠彇 access token / refresh token
-> API 璋?userinfo 濉厖 profile
-> 淇濆瓨鍔犲瘑鍚庣殑 secret
```

### 6.2 Session attach 閾捐矾

```txt
鐢ㄦ埛鎶?Vercel profile attach 鍒?session
-> connector-registry materialize Vercel runtime config
-> 鐢熸垚 local_stdio bridge command
-> 娉ㄥ叆 VERCEL_INTERNAL_MCP_URL / ONECEO_INTERNAL_TOKEN / runtime auth
-> OSAC 娉ㄥ唽 MCP provider
-> sandbox/runtime 鍚姩 local stdio bridge
-> bridge 閫氳繃鍏綉 URL 璇锋眰 oneceo internal MCP
-> internal MCP 鍐嶇敤鐢ㄦ埛 OAuth token 璋?Vercel REST API
```

### 6.3 Tool call 閾捐矾

```txt
Agent 璋?vercel_list_projects
-> runtime 璋?local_stdio bridge
-> bridge POST VERCEL_INTERNAL_MCP_URL
-> internal-vercel-mcp-routes 鏍￠獙 internal token + runtime auth
-> vercel-mcp-service 鏍￠獙 session/profile 缁戝畾
-> vercel-rest-client 璋?https://api.vercel.com
-> 杩斿洖 MCP JSON-RPC result
```

## 7. v1 宸ュ叿鑼冨洿

寤鸿 v1 淇濇寔鐭矾寰勶紝鍙仛楂橀涓?REST 鏄犲皠绋冲畾鐨勫伐鍏凤細

1. `vercel_list_projects`
2. `vercel_get_project`
3. `vercel_list_deployments`
4. `vercel_get_deployment`
5. `vercel_get_deployment_events`
6. `vercel_list_project_domains`
7. `vercel_list_env_vars`
8. `vercel_add_project_domain`
9. `vercel_upsert_env_var`
10. `vercel_remove_env_var`
11. `vercel_redeploy_deployment`

鏆備笉绾冲叆 v1锛?
1. 婧愮爜鎵撳寘涓婁紶寮忓垱寤?deployment銆?2. 鍏ㄩ噺澶嶅埗 Vercel 瀹樻柟 MCP 宸ュ叿鐭╅樀銆?3. 缁曡繃 oneceo session/profile 缁戝畾鐨勮８ REST API 浠ｇ悊銆?
## 8. 瀹夊叏杈圭晫

蹇呴』婊¤冻锛?
1. OAuth token 鍙繚瀛樺湪 API 鏈嶅姟绔紝涓嶄笅鍙戝埌 sandbox銆?2. sandbox 鍙嬁鍒?`VERCEL_INTERNAL_MCP_URL`銆乣ONECEO_INTERNAL_TOKEN` 涓?session-scoped runtime auth銆?3. internal MCP 姣忔 tool call 蹇呴』鏍￠獙锛?   - `taskSessionId`
   - `userId`
   - `profileId`
   - session connector binding
   - profile 鎺堟潈鐘舵€?4. 鍐欐搷浣滃繀椤昏姹傛槑纭」鐩笂涓嬫枃銆?5. 淇敼鐜鍙橀噺蹇呴』鏄惧紡浼犲叆 target锛屼緥濡?`production`銆乣preview`銆乣development`銆?6. 鍒犻櫎銆佽鐩栥€佺敓浜х幆澧冨啓鎿嶄綔闇€瑕佽繘鍏ヤ汉绫荤‘璁ょ瓥鐣ャ€?7. 鏃ュ織涓姝㈣緭鍑猴細
   - Vercel access token
   - Vercel refresh token
   - Authorization header
   - `ONECEO_INTERNAL_TOKEN`
   - `x-oneceo-connector-runtime-auth`

## 9. 鏈湴鑱旇皟娴佺▼

### 9.1 鍚姩 API

```powershell
$env:FRONTEND_URL="https://<your-ngrok-host>"
$env:ONECEO_API_PUBLIC_URL="https://<your-ngrok-host>"
$env:VERCEL_INTERNAL_MCP_URL="https://<your-ngrok-host>/api/internal/connectors/vercel/mcp"
$env:VERCEL_CONNECTOR_REDIRECT_URI="/vercel/callback"
$env:ONECEO_INTERNAL_TOKEN="<local-random-token>"
$env:ONECEO_REDIS_ENABLED="false"
pnpm --filter api dev
```

### 9.2 鍚姩 Web

```powershell
$env:WEB_DEV_ALLOWED_HOSTS=".ngrok-free.app"
pnpm --filter web dev
```

濡傛灉褰撳墠浠ｇ爜灏氭湭璇诲彇 `WEB_DEV_ALLOWED_HOSTS`锛岄渶瑕佸厛琛?Vite 閰嶇疆锛涘惁鍒?Vite 浼氶樆姝?ngrok host銆?
### 9.3 鍚姩 ngrok

```powershell
ngrok http 3000
```

ngrok 杈撳嚭鐨勬柊 HTTPS 鍩熷悕鍙啓鍏ユ湰鍦?`.env` 鎴栧綋鍓?shell 鐜鍙橀噺锛屼笉鍐欏叆浠ｇ爜銆?
### 9.4 Vercel OAuth App 閰嶇疆

鍦?Vercel OAuth App 鍚庡彴閰嶇疆 redirect URI锛?
```txt
https://<your-ngrok-host>/vercel/callback
```

姣忔 ngrok host 鍙樺寲锛岄兘闇€瑕佸悓姝ユ洿鏂帮細

1. `FRONTEND_URL`
2. `ONECEO_API_PUBLIC_URL`
3. `VERCEL_INTERNAL_MCP_URL`
4. Vercel OAuth App redirect URI
5. Vite allowed host 閰嶇疆鎴?`WEB_DEV_ALLOWED_HOSTS`

## 10. 楠屾敹鏍囧噯

### 10.1 OAuth 楠屾敹

1. 鐐瑰嚮 Vercel 杩炴帴鍚庤繘鍏?Vercel OAuth 鎺堟潈椤点€?2. 鍥炶皟鍦板潃涓?`FRONTEND_URL + VERCEL_CONNECTOR_REDIRECT_URI`銆?3. callback 鍚?profile 鐘舵€佷负 `authorized`銆?4. secret 涓寘鍚姞瀵嗗悗鐨?access token / refresh token / expiresAt銆?
### 10.2 Internal MCP 楠屾敹

1. `POST /api/internal/connectors/vercel/mcp` 缂哄皯 internal token 鏃惰繑鍥?401銆?2. 缂哄皯 runtime auth 鏃惰繑鍥?401銆?3. `tools/list` 杩斿洖 v1 Vercel 宸ュ叿鍒楄〃銆?4. 闈炵粦瀹?session/profile 璋冪敤 tool 琚嫆缁濄€?
### 10.3 Session attach 楠屾敹

1. Vercel provider runtime transport 鏈€缁堜负 `local_stdio`銆?2. binding 杩涘叆 `connected`銆?3. `runtimeAttachedToolsJson` 鏈?Vercel 宸ュ叿銆?4. 涓嶅啀鍑虹幇 `unsupported mcp transport: streamable_http`銆?
### 10.4 瀹為檯宸ュ叿璋冪敤楠屾敹

1. `vercel_list_projects` 鎴愬姛杩斿洖椤圭洰鍒楄〃銆?2. 鎸囧畾 `teamId` 鏃惰兘璁块棶鍥㈤槦椤圭洰銆?3. access token 杩囨湡鍚庤兘 refresh 骞堕噸璇曚竴娆°€?4. `vercel_upsert_env_var` 缂哄皯 target 鏃舵嫆缁濇墽琛屻€?5. 鍐欐搷浣滄棩蹇楀彧璁板綍 project/key/target 绛夐潪鏁忔劅淇℃伅銆?
## 11. 椋庨櫓涓庡鐞?
### 11.1 ngrok host 鍙樺寲

椋庨櫓锛歄Auth redirect URI銆丆ORS銆乂ite allowed host銆乮nternal MCP URL 涓嶄竴鑷淬€?
澶勭悊锛氭墍鏈夊叕缃?host 閮介€氳繃 env 绠＄悊锛涙湰鍦拌仈璋冩椂寤虹珛涓€浠?`.env.local.ngrok` 鎴栧惎鍔ㄨ剼鏈泦涓缃€?
### 11.2 Web 绔彛浠ｇ悊 API 涓嶇ǔ瀹?
椋庨櫓锛歴andbox bridge 璁块棶 `FRONTEND_URL/api/internal/...` 鏃朵緷璧?Vite proxy锛孷ite 閲嶅惎鎴?Host 鎷︽埅浼氬鑷?MCP 涓嶅彲鐢ㄣ€?
澶勭悊锛氭湰鍦板彲浠ユ帴鍙楋紱鐢熶骇蹇呴』浣跨敤鐪熷疄 API 鍏綉鍏ュ彛浣滀负 `ONECEO_API_PUBLIC_URL`銆?
### 11.3 Redis 鍣煶褰卞搷鍒ゆ柇

椋庨櫓锛氭湰鍦?Redis 鏈惎鍔ㄤ絾 `ONECEO_REDIS_ENABLED=true`锛屾棩蹇椾腑澶ч噺 `[redis] get_json failed` 骞叉壈鎺掓煡銆?
澶勭悊锛氭湰鍦拌仈璋?Vercel MCP 鏃堕粯璁よ缃細

```env
ONECEO_REDIS_ENABLED=false
```

### 11.4 Token 娉勬紡

椋庨櫓锛歜ridge env銆乨ebug log銆侀敊璇搷搴旀硠婕?token銆?
澶勭悊锛氭墍鏈夊唴閮?token 鍙弬涓?header 娉ㄥ叆锛屾棩蹇楀彧杈撳嚭鏄惁瀛樺湪锛屼笉杈撳嚭鍊笺€?
## 12. 瀹炴柦浠诲姟鎷嗗垎

### 闃舵 A锛氱幆澧冨彉閲忔敹鏁?
1. 澧炲姞鎴栫‘璁?`ONECEO_API_PUBLIC_URL`銆?2. `VERCEL_INTERNAL_MCP_URL` 浼樺厛鏄惧紡璇诲彇 env銆?3. Vite `allowedHosts` 鏀寔浠?`WEB_DEV_ALLOWED_HOSTS` 杩藉姞銆?4. 鏂囨。琛ュ厖鏈湴 ngrok 涓庣敓浜ч儴缃插樊寮傘€?
### 闃舵 B锛欼nternal MCP 楠岃瘉

1. 娴嬭瘯 `tools/list`銆?2. 娴嬭瘯 runtime auth 鏍￠獙銆?3. 娴嬭瘯 session/profile binding 鏍￠獙銆?4. 娴嬭瘯 Vercel REST client 401 refresh retry銆?
### 闃舵 C锛歋ession attach 楠岃瘉

1. OAuth 鎺堟潈鎴愬姛鍚?attach Vercel銆?2. 纭 provider transport 鏄?`local_stdio`銆?3. 纭 bridge 鑳戒粠 sandbox 璁块棶 `VERCEL_INTERNAL_MCP_URL`銆?4. 纭 `vercel_list_projects` 瀹為檯璋冪敤鎴愬姛銆?
### 闃舵 D锛氱敓浜ч儴缃插噯澶?
1. 灏?`FRONTEND_URL` 鏇挎崲涓烘寮?Web 鍩熷悕銆?2. 灏?`ONECEO_API_PUBLIC_URL` 鏇挎崲涓烘寮?API 鍩熷悕銆?3. 灏?Vercel OAuth App redirect URI 鏇挎崲涓烘寮忓洖璋冨湴鍧€銆?4. 閰嶇疆 `ONECEO_INTERNAL_TOKEN` 涓虹敓浜у己闅忔満鍊笺€?5. 纭 CORS銆丆ookie銆佸弽鍚戜唬鐞嗐€丠TTPS 缁堟浣嶇疆涓€鑷淬€?
## 13. 缁撹

璇ユ柟妗堝彲琛屻€?
鍏抽敭鍒ゆ柇鏄細

1. Vercel 瀹樻柟 REST API 鑳芥敮鎾?oneceo 鑷缓 MCP wrapper銆?2. Vercel 瀹樻柟 OAuth 绔偣鑳芥敮鎾戠敤鎴锋巿鏉冦€?3. oneceo 褰撳墠 connector/session/OSAC/MCP runtime 鏋舵瀯宸茬粡鍏峰鎺ュ叆鏉′欢銆?4. 鏈湴 ngrok 鍙兘浣滀负鐜鍙橀噺涓殑鍏綉鍏ュ彛锛屼笉鑳藉啓姝汇€?5. sandbox 鍐呰闂?oneceo internal MCP 鏃讹紝蹇呴』浣跨敤 sandbox 鍙揪鐨勫叕缃?URL锛屼笉鑳戒娇鐢ㄥ涓绘満 localhost銆?
鏈枃妗ｅ綋鍓嶇姸鎬佷负 `[20260424-1914宸查噰鐢╙`銆傚凡鎸夋湰鏂囪繘鍏ヤ唬鐮佸疄鐜伴樁娈碉紱鍚庣画鑻ユ柟妗堣鏇挎崲銆佹殏鍋滄垨搴熷純锛岄渶瑕佸悓姝ユ洿鏂版枃浠跺悕銆佹爣棰樹笌寮曠敤鐘舵€併€?