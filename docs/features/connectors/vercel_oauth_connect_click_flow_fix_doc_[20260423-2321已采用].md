# Vercel OAuth 鐐瑰嚮杩炴帴娴佺▼淇鏂囨。 [20260423-2321宸查噰鐢╙

## 20260424-状态更新

本文件修复的是旧 Sign in with Vercel 点击链路。当前 Vercel MCP 授权已迁移到 Vercel Integration install flow，本文件仅作为历史问题记录，不再作为新实现依据。

## 1. 闂鑳屾櫙

鐢ㄦ埛鍙嶉 Vercel MCP 杩炴帴鍣ㄧ偣鍑烩€滆繛鎺モ€濆悗娌℃湁鎴愬姛锛屽苟涓旇〃鐜颁负鐐瑰嚮鍚庢病鏈夋槑鏄炬巿鏉冩搷浣滃氨鐩存帴杩涘叆鍥炶皟/杩炴帴鐘舵€侊紝鎬€鐤戝綋鍓嶅疄鐜版病鏈夊仛蹇呰鍒ゆ柇鑰岀洿鎺ュ洖璋冦€?
鏈闂灞炰簬鏃㈡湁 Vercel internal MCP OAuth-only 鏂规鐨勪慨澶嶏紝涓嶆敼鍙樹富鏂规锛?
`Agent -> oneceo internal Vercel MCP server -> Vercel REST API`

渚濇嵁鏂囨。锛?
- `docs/features/connectors/vercel_internal_mcp_wrapper_oauth_only_execution_plan_[20260422-2201宸查噰鐢╙.md`

## 2. 褰撳墠閾捐矾妫€鏌ョ粨璁?
### 2.1 鍚庣鍥炶皟涓嶆槸鏃犲垽鏂洿鎺ラ€氳繃

鍚庣 OAuth callback 褰撳墠浼氬仛浠ヤ笅鏍￠獙锛?
1. `connector_auth_requests` 涓繀椤诲瓨鍦ㄥ搴?`state`銆?2. `request.userId` 蹇呴』绛変簬褰撳墠鐧诲綍鐢ㄦ埛銆?3. `request.connectorKey` 蹇呴』绛変簬褰撳墠 connector銆?4. `request.profileId` 蹇呴』瀛樺湪锛屽苟涓?profile callback 鍦烘櫙鍖归厤銆?5. 璇锋眰鏈繃鏈熴€?6. PKCE 鍦烘櫙蹇呴』瀛樺湪骞朵娇鐢?`code_verifier` 鎹?token銆?7. token 浜ゆ崲鍚庡繀椤绘嬁鍒?`access_token`銆?8. Vercel callback 鍚庝細璋冪敤 `userinfo` 濉厖 `displayName/profileName`銆?
瀵瑰簲浠ｇ爜锛?
- `apps/api/src/services/user-connector-service.ts`
- `apps/api/src/routes/connector-routes.ts`

### 2.2 MCP tool call 涔熸湁鎺堟潈涓庣粦瀹氭鏌?
Vercel internal MCP tool call 鍓嶄細妫€鏌ワ細

1. 褰撳墠 task session 鏄惁鎸傝浇瀵瑰簲 Vercel connector profile銆?2. profile id 鏄惁涓庤繍琛屾椂涓婁笅鏂囦竴鑷淬€?3. profile 鏄惁瀛樺湪銆?4. profile `authStatus` 鏄惁涓?`authorized`銆?
瀵瑰簲浠ｇ爜锛?
- `apps/api/src/services/vercel-mcp-service.ts`

鍥犳锛屾湰娆′紭鍏堜慨澶嶇偣涓嶆槸鍚庣鈥滄棤鍒ゆ柇鐩存帴鎺堟潈鈥濓紝鑰屾槸鍓嶇鍚姩 OAuth 鐨勫垎鏀€夋嫨涓庤璁℃枃妗ｄ笉涓€鑷淬€?
## 3. 鍙戠幇鐨勯棶棰?
### 3.1 璁捐瑕佹眰

宸查噰鐢ㄨ璁℃枃妗ｈ姹傦細

1. Vercel OAuth 鍏ュ彛鍙傜収 Slack 鐨?connector-level OAuth銆?2. Vercel 鍓嶇璇︽儏椤佃蛋 OAuth card 妯″紡銆?3. 鍥炶皟鎴愬姛鍚庡鐢?connector-level OAuth銆乺untime refresh銆乻ession attach銆?
### 3.2 浠ｇ爜鐜扮姸

褰撳墠鍓嶇瀛樺湪涓や釜鍒ゆ柇锛?
1. `shouldUseUnifiedConnectorCard`
   - 宸叉妸 `vercel` 鏀捐繘缁熶竴 OAuth 鍗＄墖銆?2. `shouldUseConnectorLevelOauth`
   - 鍙寘鍚?`notion` 涓?`slack`锛屾病鏈夊寘鍚?`vercel`銆?
缁撴灉鏄細

1. 鐢ㄦ埛鍦?Vercel 缁熶竴鍗＄墖鐐瑰嚮杩炴帴銆?2. `handleOAuth` 娌℃湁杩涘叆 connector-level OAuth 鍒嗘敮銆?3. 鍓嶇鍏堟墽琛?`persistProfile`锛屾湰鍦板垱寤?淇濆瓨涓€涓?Vercel profile銆?4. 鍐嶉€氳繃 profile-level OAuth start 鍙戣捣鎺堟潈銆?5. 鍥?Vercel 浣跨敤鍥哄畾鍥炶皟 `/vercel/callback`锛屽悗绔疄闄呭彂閫佺粰 Vercel 鐨?redirect uri 涓嶅甫 `profileId` 鏌ヨ鍙傛暟銆?6. 鍥炶皟杩涘叆鍓嶇鏃舵病鏈?`profileId`锛屽墠绔張鎶婂畠褰撴垚 connector-level callback 瀹屾垚銆?
杩欏舰鎴愪簡鈥減rofile-level start + connector-level callback鈥濈殑娣风敤閾捐矾銆傝櫧鐒跺悗绔彲浠ラ€氳繃 `state` 鎵惧洖 profile锛屼絾杩欎笌璁捐鐩爣涓嶄竴鑷达紝涔熶細瀵艰嚧鐐瑰嚮杩炴帴鏃剁敤鎴锋劅鐭ユ贩涔憋細鍏堝垱寤烘湰鍦?profile锛屽啀杩涘叆澶栭儴鎺堟潈锛涘鏋?Vercel 宸茬粡鎺堟潈杩囪 App锛屽畼鏂逛細绔嬪嵆璺冲洖鍥炶皟椤碉紝鐢ㄦ埛灏变細鎰熻鈥滄病鏈変换浣曟搷浣滃氨鐩存帴鍥炶皟鈥濄€?
## 4. 淇鐩爣

鏈鍙仛鏈€鐭矾寰勪慨澶嶏細

1. Vercel 鐐瑰嚮杩炴帴蹇呴』杩涘叆 connector-level OAuth start銆?2. Vercel OAuth start 鐢卞悗绔粺涓€鏌ユ壘鎴栧垱寤洪粯璁?profile銆?3. 鍓嶇涓嶅湪鐐瑰嚮杩炴帴鏃舵彁鍓?`persistProfile`銆?4. Vercel callback 缁х画璧?connector-level callback锛岄€氳繃 `state` 鍙嶆煡鐪熷疄 request/profile銆?5. session attach 鍙湪 callback 杩斿洖 `authStatus === "authorized"` 鍚庢墽琛屻€?6. 鐢ㄦ埛鐐瑰嚮鈥滃彇娑堟巿鏉?鏂紑鎺堟潈鈥濆悗锛屼笅涓€娆＄偣鍑绘巿鏉冨繀椤婚噸鏂拌繘鍏?Vercel consent page锛岃€屼笉鏄洿鎺ラ潤榛樺洖璋冦€?
涓嶆柊澧炲吋瀹归摼璺紝涓嶅紩鍏?token 鎵嬪～鍏ュ彛锛屼笉鏀瑰彉 internal MCP runtime 璁捐銆?
## 5. 淇敼鏂规

### 5.1 鍓嶇 OAuth 鍒嗘敮淇

鏂囦欢锛?
- `apps/web/client/src/components/ConnectorCenterPanel.tsx`

淇敼锛?
1. 灏?`vercel` 绾冲叆 `shouldUseConnectorLevelOauth`銆?2. `handleOAuth` 涓?Vercel 杩涘叆 connector-level OAuth 鍒嗘敮銆?3. Vercel redirectUri 浣跨敤鍥哄畾鍥炶皟璺緞 `/vercel/callback`锛屼笌鍚庣 `VERCEL_CONNECTOR_REDIRECT_URI` 瀵归綈銆?
棰勬湡琛屼负锛?
1. 鐐瑰嚮 Vercel 杩炴帴銆?2. 鍓嶇璋冪敤 `POST /api/connectors/vercel/oauth/start`銆?3. 鍚庣鍒涘缓 `connector_auth_requests`锛屼繚瀛?`state/profileId/codeVerifier/returnToSessionId`銆?4. 娴忚鍣ㄨ烦杞埌 Vercel Authorization Endpoint銆?5. Vercel 鍥炶皟 `/vercel/callback?code=...&state=...`銆?6. 鍓嶇璋冪敤 `POST /api/connectors/vercel/oauth/callback`銆?7. 鍚庣鐢?`state` 鎵惧洖 profile 骞跺畬鎴?token 浜ゆ崲銆?8. 濡傛灉鎺堟潈鎴愬姛涓斿瓨鍦ㄧ洰鏍?session锛屽啀 attach Vercel connector銆?
### 5.2 鍓嶇娴嬭瘯琛ュ厖

鏂囦欢锛?
- `apps/web/client/src/tests/connector-center-panel.test.ts`

淇敼锛?
1. 灏?`shouldUseConnectorLevelOauth("vercel")` 鏈熸湜鏀逛负 `true`銆?2. 淇濈暀鍥哄畾鍥炶皟璺緞涓庡洖璋冭瘑鍒祴璇曘€?
### 5.3 鍚庣鏆備笉鏀瑰姩

鏈妫€鏌ュ悗锛屽悗绔?OAuth callback 涓?MCP tool call 宸插叿澶囧繀瑕佹牎楠屻€傞櫎闈炲悗缁仈璋冭瘉鏄?Vercel token/userinfo 鍝嶅簲缁撴瀯涓庡綋鍓嶈В鏋愪笉涓€鑷达紝鍚﹀垯涓嶆墿澶у悗绔慨鏀硅寖鍥淬€?
### 5.4 琛ュ厖锛歏ercel 鍙栨秷鎺堟潈鍚庡繀椤诲啀娆¤繘鍏ョ湡瀹?OAuth 鎺堟潈椤?
鏍规嵁 Vercel 瀹樻柟鏂囨。锛?
1. 鐢ㄦ埛绗竴娆℃巿鏉冩椂浼氱湅鍒?consent page銆?2. 濡傛灉鐢ㄦ埛宸茬粡鎺堟潈杩囪 app锛屽悗缁巿鏉冧細绔嬪嵆閲嶅畾鍚戯紝涓嶅啀灞曠ず consent page銆?3. 濡傛灉涓氬姟涓婇渶瑕佸己鍒跺啀娆″睍绀?consent page锛屾巿鏉冭姹傚繀椤绘樉寮忓甫涓?`prompt=consent`銆?
鍥犳锛岃婊¤冻鈥滅偣鍑诲彇娑堟巿鏉冨悗锛屽啀娆＄偣鍑绘巿鏉冨繀椤婚噸鏂拌繘鍏ョ湡瀹?OAuth 鎺堟潈椤碉紝骞跺彲鍐嶆鐪嬪埌 consent page鈥濓紝闇€瑕佸悓鏃舵弧瓒筹細

1. 鐐瑰嚮鍙栨秷鎺堟潈鏃讹紝蹇呴』鎴愬姛璋冪敤 Vercel revoke endpoint锛屾挙閿€杩滅鎺堟潈銆?2. 涓嬩竴娆″彂璧?Vercel Authorization Endpoint 鏃讹紝蹇呴』鏄惧紡甯︿笂 `prompt=consent`銆?3. 鍙湁杩滅 revoke 鎴愬姛锛屾墠鍏佽鎶婃湰鍦?profile 鏍囪涓哄凡娓呯┖鎺堟潈銆?4. 濡傛灉杩滅 revoke 澶辫触锛屽墠绔繀椤绘槑纭姤閿欙紝涓旀湰鍦颁笉鑳戒吉瑁呮垚鈥滃凡鍙栨秷鎺堟潈鎴愬姛鈥濄€?
### 5.5 褰撳墠瀹炵幇涓殑鍏蜂綋缂哄彛

褰撳墠 `clearProfileAuth()` 鐨勯『搴忔槸锛?
1. 灏濊瘯璋冪敤 Vercel revoke endpoint銆?2. 鍗充娇 revoke 澶辫触锛屼篃缁х画鎶婃湰鍦?`secretCiphertext/authStatus/lastAuthAt` 娓呯┖銆?
鍚屾椂鍓嶇 `handleDisconnect()` 鍙 GitHub 涓撻棬鎻愮ず `remoteGrantRevoked === false`锛屽 Vercel 娌℃湁鍚岀瓑澶勭悊銆?
杩欎細瀵艰嚧锛?
1. 鐢ㄦ埛鐣岄潰鐪嬪埌鈥滃凡鍙栨秷鎺堟潈鈥濄€?2. 鏈湴鏁版嵁搴撲篃鐪嬭捣鏉ュ儚鏈巿鏉冦€?3. 浣?Vercel 杩滅鎺堟潈鍏跺疄鍙兘浠嶇劧瀛樺湪銆?4. 涓嬩竴娆＄偣鍑绘巿鏉冩椂锛孷ercel 鍥犱负浠嶈涓鸿 app 宸茶幏鎺堟潈锛岀洿鎺ラ噸瀹氬悜锛屼笉灞曠ず consent page銆?
### 5.6 鏈閽堝鍙栨秷鎺堟潈鐨勪慨澶嶅彛寰?
Vercel 鏂紑鎺堟潈鏀逛负寮轰竴鑷磋涔夛細

1. `clearProfileAuth()` 鍦?`connectorKey === "vercel"` 涓旇繙绔?revoke 澶辫触鏃讹紝鐩存帴杩斿洖閿欒銆?2. 涓嶅啀缁х画娓呯┖鏈湴鎺堟潈瀛楁銆?3. 鍓嶇灞曠ず鈥滃彇娑堟巿鏉冨け璐モ€濈殑鐪熷疄鍘熷洜銆?4. 鍙湁杩滅 revoke 鎴愬姛鍚庯紝鎵嶆竻绌烘湰鍦版巿鏉冪姸鎬併€?
杩欐牱鍙互淇濊瘉锛?
1. 鈥滄湰鍦版樉绀哄凡鏂紑鈥?涓?鈥淰ercel 杩滅鐪熺殑宸叉挙閿€鈥?涓€鑷淬€?2. 涓嬫閲嶆柊鎺堟潈鏃讹紝娴忚鍣ㄤ細閲嶆柊杩涘叆 Vercel OAuth 鎺堟潈椤碉紱鐢变簬璇锋眰甯?`prompt=consent`锛屼細鍐嶆灞曠ず consent page銆?
### 5.7 褰撳墠浼氳瘽 pending_recover 鍗′綇闂

鏈鑱旇皟鍙堝彂鐜颁竴涓細璇濇€侀棶棰橈細

1. OAuth 鎴愬姛鍚庯紝鍓嶇浼氱户缁鐩爣 session 璋冪敤 attach銆?2. 濡傛灉 attach 鏃?sandbox/runtime 杩樻病瀹屽叏 ready锛宐inding 浼氳鍐欐垚 `pending_recover`銆?3. 褰撳墠 attach 璺緞鍙繑鍥?`pending_recover`锛屾病鏈夌珛鍒昏Е鍙?`ensureSessionRecovered()`銆?4. 缁撴灉鏄綋鍓嶄細璇濋噷鐨?connector tool access 浼氬仠鐣欏湪 `blocked_until_runtime_recovers`锛屽彧鑳界瓑寰呭悗鍙?backlog 鎴栧叾浠栭摼璺鍔ㄦ仮澶嶃€?
### 5.8 鏈閽堝 pending_recover 鐨勪慨澶嶅彛寰?
涓嶆敼涓荤姸鎬佹満锛屽彧琛ラ綈褰撳墠浼氳瘽鐨勪富鍔ㄦ仮澶嶈Е鍙戯細

1. attach 璺敱鍦ㄦ嬁鍒?`pending_recover` 鍚庯紝绔嬪嵆瀵瑰綋鍓?session 璋冪敤 `ensureSessionRecovered()`銆?2. 浼氳瘽璇︽儏璇诲彇銆佷細璇?connectors 璇诲彇銆丄ltus connector snapshot 璇诲彇鏃讹紝鍙鎷垮埌褰撳墠 sandbox session id锛屼篃浼氳ˉ鍋氫竴娆℃寜闇€鎭㈠銆?3. `ensureSessionRecovered()` 鏀逛负鍦ㄥ綋鍓嶈皟鐢ㄩ摼鍐呯瓑寰呮湰娆?recovery job 璺戝畬锛岃€屼笉鏄彧鍋?fire-and-forget銆?
杩欐牱鍙互淇濊瘉锛?
1. 褰撳墠浼氳瘽鍦?OAuth 瀹屾垚鍚庯紝涓嶄細鍥犱负鎭㈠浠诲姟鍙繘闃熷垪鍗存病浜洪┈涓婃秷璐硅€岄暱鏈熷崱鍦?`pending_recover`銆?2. Altus 鍦ㄨ鍙?connector snapshot 鏃讹紝鑳界湅鍒版仮澶嶅悗鐨勬渶鏂?runtime status锛岃€屼笉鏄户缁妸宸ュ叿鍒ゅ畾涓?blocked銆?
## 6. 楠岃瘉璁″垝

鏈€灏忛獙璇侊細

1. 杩愯鍓嶇 connector center 娴嬭瘯锛岀‘璁?Vercel 鍒ゅ畾涓?connector-level OAuth銆?2. 杩愯 Vercel OAuth 鐩稿叧 API 娴嬭瘯锛岀‘璁?PKCE銆佸浐瀹?redirect uri銆乼oken callback 浠嶉€氳繃銆?3. 澧炲姞/璋冩暣 Vercel 鍙栨秷鎺堟潈娴嬭瘯锛岀‘璁?revoke 澶辫触鏃舵湰鍦扮姸鎬佷笉浼氳鎻愬墠娓呯┖銆?
寤鸿鍛戒护锛?
1. `pnpm --filter web test -- connector-center-panel`
2. `pnpm --filter api test -- vercel-oauth-connector`
3. `pnpm --filter api test -- user-connector-service`

鎵嬪伐楠岃瘉锛?
1. 鎵撳紑杩炴帴鍣ㄤ腑蹇冦€?2. 鐐瑰嚮 Vercel 杩炴帴銆?3. 纭璇锋眰涓?connector-level start锛歚/api/connectors/vercel/oauth/start`銆?4. 纭娴忚鍣ㄨ繘鍏?Vercel Authorization Endpoint銆?5. 濡?Vercel 宸叉巿鏉冭繃璇?App锛岀洿鎺ュ洖璋冩槸 Vercel 瀹樻柟琛屼负锛涗絾鍥炶皟鍚庡繀椤荤敱鍚庣瀹屾垚 state銆丳KCE銆乼oken銆乽serinfo 鏍￠獙鍚庢墠鏄剧ず鎺堟潈鎴愬姛銆?6. 鐐瑰嚮鈥滃彇娑堟巿鏉冣€濆悗锛屽啀娆＄偣鍑烩€滄巿鏉冣€濓紝蹇呴』閲嶆柊鍑虹幇 Vercel consent page銆?
## 7. 閲囩敤鍓嶇‘璁?
濡傛灉閲囩敤鏈慨澶嶆枃妗ｏ紝鎴戝皢杩涘叆浠ｇ爜瀹炵幇闃舵锛屽苟鎶婃湰鏂囦欢鐘舵€佷粠 `[灏氭湭閲囩敤]` 鏇存柊涓?`[yyyymmdd-hhmm宸查噰鐢╙`銆?