# Vercel MCP `streamable_http` 鏈湴妗ユ帴淇鏂规 [20260424-0008宸查噰鐢╙

## 20260424-状态更新

本文件的 transport/local bridge 修复思路仍有效；其中提到的 Vercel OAuth 模型现指 Vercel Integration install flow，不再指 Sign in with Vercel 普通 OAuth。

鏇存柊鏃堕棿锛?026-04-23

## 1. 鑳屾櫙涓庨棶棰?
褰撳墠 Vercel 杩炴帴鍣ㄥ湪浼氳瘽 attach / 鎭㈠闃舵浼氬嚭鐜颁互涓嬮敊璇細

- 鎶ラ敊淇℃伅锛歚unsupported mcp transport: streamable_http`
- 鍏稿瀷琛ㄧ幇锛氳繛鎺ュ櫒宸插畬鎴?OAuth锛宲rofile 涔熸湁鏈€杩戞巿鏉冩椂闂达紝浣嗕細璇濆唴 MCP 宸ュ叿涓嶅彲鐢?- 缁撴灉鐘舵€侊細binding 钀藉叆 `failed` 鎴?`pending_recover`锛屽伐鍏疯闂闃绘柇

杩欒鏄庡綋鍓嶉棶棰樹笉鏄€淰ercel OAuth 娌℃垚鍔熲€濓紝鑰屾槸锛?
1. OAuth 瀹屾垚鍚庯紝骞冲彴缁х画瑙﹀彂浼氳瘽 attach銆?2. attach 涓嬪彂缁欒繍琛屾椂鐨?provider transport 鏄?`streamable_http`銆?3. 褰撳墠 OSAC / runtime 涓婚摼涓嶆帴鍙?`streamable_http`銆?4. 鏈€缁?attach 澶辫触锛屾仮澶嶉摼璺篃浼氬弽澶嶅懡涓悓涓€涓?transport 閿欒銆?
## 2. 褰撳墠浜嬪疄

缁撳悎鐜版湁浠ｇ爜涓庡凡閲囩敤鏂规锛屽彲浠ョ‘璁わ細

1. `apps/api/src/connectors/definitions/vercel.ts` 褰撳墠鏄惧紡澹版槑锛?   - `runtime.type = 'remote'`
   - `runtime.transport = 'streamable_http'`
2. Vercel 褰撳墠骞朵笉鏄洿杩炲畼鏂?MCP锛岃€屾槸鍏堢粡杩?oneceo 鍐呴儴 Vercel MCP 鍖呰灞傘€?3. `apps/api/src/services/session-connector-service.ts` 瀵?`runtimeConfig.type === 'local'` 宸茬粡绋冲畾涓嬪彂 `local_stdio`銆?4. Supabase 宸茬粡鍦ㄥ綋鍓嶄粨搴撳唴鐢ㄢ€滄湰鍦?stdio bridge 杞彂涓婃父 `streamable_http`鈥濈殑鏂瑰紡瑙ｅ喅浜嗗悓绫婚棶棰橈紝涓旀柟妗堝凡閲囩敤锛?   - 鍙傝€冩枃妗ｏ細`docs/agent鐮斿彂鏂囨。/20260405_Supabase_MCP_鏂规浜宊涓嶆敼OSAC鏈湴妗ユ帴瀹炴柦鏂囨。_[20260405-1829宸查噰鐢╙.md`
   - 鍙傝€冨疄鐜帮細`apps/api/src/connectors/bridges/supabase-stdio-bridge.ts`

鍥犳锛孷ercel 褰撳墠鎶ラ敊涓?Supabase 褰撴椂鐨勯棶棰樺睘浜庡悓涓€绫婚棶棰橈細涓嶆槸涓婃父 MCP 涓嶅彲鐢紝鑰屾槸杩愯鏃?transport 鑳藉姏杈圭晫涓嶅尮閰嶃€?
## 3. 鏂规缁撹

鏈閲囩敤涓?Supabase 涓€鑷寸殑鍗曚竴璺緞鏂规锛?
1. 涓嶄慨鏀?OSAC銆?2. 涓嶈姹?runtime 鏂板鍘熺敓 `streamable_http` 鏀寔銆?3. 涓嶆妸 Vercel 鏀规垚鍙︿竴绉嶅崗璁互瑙勯伩闂銆?4. 淇濇寔鐜版湁 鈥淰ercel OAuth -> oneceo internal MCP wrapper鈥?鏋舵瀯涓嶅彉銆?5. 浠呭皢鈥滆繍琛屾椂鐪嬪埌鐨?transport鈥濇敼涓?`local_stdio`锛屽苟鐢?sandbox 鍐呮湰鍦?bridge 璐熻矗杞彂鍒颁笂娓?`streamable_http` 绔偣銆?
璋冩暣鍚庣殑涓婚摼璺负锛?
`API -> OSAC -> local_stdio(vercel bridge) -> streamable_http -> oneceo internal Vercel MCP`

杩欐潯閾捐矾涓?Supabase 宸查噰鐢ㄦ柟妗堜繚鎸佷竴鑷达紝绗﹀悎鈥滄渶鐭矾寰勪慨澶嶃€佷笉涓柇鐜版湁鏋舵瀯銆佷笉寮曞叆鍙屼富閾锯€濈殑瑕佹眰銆?
## 4. 涓轰粈涔堜笉閲囩敤鍏朵粬鏂规

### 4.1 涓嶄慨鏀?OSAC 鏀寔 `streamable_http`

涓嶉噰鐢ㄣ€傚師鍥狅細

1. 杩欐槸璺ㄧ郴缁熷崗璁兘鍔涘彉鏇达紝鑼冨洿鏄庢樉澶т簬鏈淇鐩爣銆?2. 褰撳墠浠撳簱宸叉湁 Supabase 鎴愮啛鑼冨紡鍙鐢紝娌℃湁蹇呰涓哄崟涓€杩炴帴鍣ㄦ墿澶ф敼閫犻潰銆?3. 璇ユ柟鍚戜細鎻愰珮鎭㈠閾捐矾銆乺untime 娉ㄥ唽銆佽娴嬩笌鍥炲綊鎴愭湰銆?
### 4.2 涓嶆妸 Vercel 鏀规垚 `remote_sse`

涓嶉噰鐢ㄣ€傚師鍥狅細

1. 褰撳墠 Vercel 涓绘灦鏋勫凡缁忔敹鏁涗负 oneceo internal MCP wrapper銆?2. 鏈闂鐨勭洿鎺ョ煕鐩炬槸鈥渞untime 涓嶆帴鍙?`streamable_http`鈥濓紝涓嶆槸鈥淰ercel 蹇呴』浣跨敤 SSE鈥濄€?3. 鐢ㄦ埛鏄庣‘瑕佹眰鍙傝€?Supabase 瑙ｅ喅鏂规锛屽洜姝ゅ簲澶嶇敤鈥滄湰鍦?bridge 鍖栤€濊矾寰勶紝鑰屼笉鏄澶栧垏鍗忚銆?
### 4.3 涓嶄繚鐣欏弻璺緞鍏煎

涓嶉噰鐢ㄣ€傚師鍥狅細

1. 涓嶅厑璁搁暱鏈熷悓鏃朵繚鐣欌€滅洿杩?remote `streamable_http`鈥濅笌鈥渓ocal bridge鈥濅袱濂椾富閫昏緫銆?2. 鍙岃矾寰勪細璁?attach銆佹仮澶嶃€佹棩蹇椼€侀棶棰樻帓鏌ュ叏閮ㄥ彉澶嶆潅銆?3. 褰撳墠鐩爣鏄敹鍙ｉ棶棰橈紝涓嶆槸鎵╁睍閰嶇疆闈€?
## 5. 鐩爣

鏈柟妗堢殑鐩爣鏄細

1. Vercel attach 涓嶅啀鍚?runtime 涓嬪彂 `streamable_http`銆?2. Vercel attach / recovery 鍦?runtime 渚х粺涓€琛ㄧ幇涓?`local_stdio`銆?3. 杩炴帴鍣ㄥ畬鎴?OAuth 鍚庯紝attach 鑳界ǔ瀹氳繘鍏?`connected`銆?4. `pending_recover` 鐘舵€佺殑 Vercel binding 鍦ㄦ仮澶嶆椂涓嶅啀閲嶅鎾炰笂 transport 閿欒銆?5. 鍦ㄤ細璇濅腑鐪熷疄鎵ц鑷冲皯涓€椤?Vercel MCP tool 璋冪敤鎴愬姛銆?
楠屾敹鏍囧噯锛?
1. attach 鍝嶅簲涓嶅啀鍖呭惈 `unsupported mcp transport: streamable_http`
2. `task_session_connector_bindings.runtime_transport = local_stdio`
3. `runtime_status` 鏈€缁堣繘鍏?`connected`
4. session MCP tools 鍙垪鍑轰笖鑷冲皯涓€娆?`tools/call` 鎴愬姛

## 6. 浠ｇ爜鏀归€犺寖鍥?
## 6.1 鏂板 Vercel 鏈湴 stdio bridge

鏂板鏂囦欢锛?
1. `apps/api/src/connectors/bridges/vercel-stdio-bridge.ts`

鑱岃矗锛?
1. 閫氳繃 `stdin/stdout` 鏆撮湶 MCP JSON-RPC 鑳藉姏銆?2. 鎺ユ敹杩愯鏃跺彂鏉ョ殑 `initialize`銆乣tools/list`銆乣tools/call` 绛夎姹傘€?3. 浠?HTTP 鏂瑰紡鎶婅繖浜涜姹傝浆鍙戝埌 oneceo internal Vercel MCP endpoint銆?4. 瀵逛笂娓?`streamable_http` 鍝嶅簲鍋氭爣鍑?MCP 鍥炲啓銆?5. 璐熻矗閿欒閫忎紶銆佽秴鏃舵帶鍒躲€佸繀瑕佺殑浼氳瘽澶寸淮鎶ゃ€?
鐜鍙橀噺寤鸿锛?
1. `VERCEL_INTERNAL_MCP_URL`
2. `VERCEL_BRIDGE_RUNTIME_AUTH`
3. `VERCEL_INTERNAL_TOKEN`
4. `VERCEL_BRIDGE_TIMEOUT_MS`
5. `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`锛堝褰撳墠鐜闇€瑕佷唬鐞嗭級

瀹炵幇瑕佹眰锛?
1. 鍙傝€?`supabase-stdio-bridge.ts` 鐨勫疄鐜扮粨鏋勶紝涓嶉噸鏂板彂鏄庝竴濂楁ˉ鎺ユā寮忋€?2. bridge 鍙仛鍗忚杞彂涓庡繀瑕佺姸鎬佺淮鎶わ紝涓嶆壙鎺ヤ笟鍔￠€昏緫銆?3. 鏁忔劅淇℃伅杈撳嚭鍓嶅繀椤昏劚鏁忋€?4. 涓婃父澶辫触鏃跺繀椤昏繑鍥炲彲璇婃柇閿欒锛岀姝㈠悶閿欐垨娉涘寲鎴愭棤涓婁笅鏂囨姤閿欍€?
## 6.2 璋冩暣 connector-registry锛屽皢 Vercel 鐗╁寲涓?`local`

淇敼鏂囦欢锛?
1. `apps/api/src/services/connector-registry.ts`

鏀归€犺姹傦細

1. 鍙傝€?Supabase 鍒嗘敮锛屼负 Vercel 鏂板 `buildVercelStdioBridgeCommand` 涓?bridge env 缁勮閫昏緫銆?2. `materializeRuntimeConfig()` 鍦?`connectorKey === 'vercel'` 鏃惰繑鍥烇細
   - `type = 'local'`
   - `command = ['node', '-e', buildVercelStdioBridgeCommand()]`
   - `environment = { ... }`
3. 鐢?registry 璐熻矗鎶婂綋鍓?session / user / profile 鎵€闇€鐨勫唴閮ㄨ璇佷俊鎭敞鍏?bridge 鐜銆?4. 鍏朵粬杩炴帴鍣ㄨ涓轰繚鎸佷笉鍙樸€?
绾︽潫锛?
1. 涓嶄繚鐣?Vercel 鐜版湁 direct remote `streamable_http` 涓昏矾寰勩€?2. 涓嶅紩鍏ユ寜鐜鍒囧洖 remote 鐨勮嚜鍔ㄥ垎鏀€?
## 6.3 浼氳瘽 attach 灞傜粺涓€澶嶇敤鐜版湁 `local_stdio` 閫昏緫

娑夊強鏂囦欢锛?
1. `apps/api/src/services/session-connector-service.ts`

瑕佹眰锛?
1. 涓嶅啀璁?Vercel attach 璧?remote `streamable_http` 璇箟銆?2. 鐩存帴澶嶇敤鐜版湁 `runtimeConfig.type === 'local' -> local_stdio` 鍒嗘敮銆?3. attach銆佹仮澶嶃€佽皟璇曟棩蹇椾腑璁板綍鐨?transport 蹇呴』涓?runtime 鐪熸鏀跺埌鐨勪竴鑷达紝鍗?`local_stdio`銆?
璇存槑锛?
1. 杩欎竴灞傚師鍒欎笂涓嶆柊澧?Vercel 涓撳睘琛ヤ竵閫昏緫銆?2. Vercel 鐨?transport 淇搴斾富瑕佸湪 registry 鐗╁寲闃舵瀹屾垚锛宎ttach 灞傚彧娑堣垂缁熶竴鍚庣殑 runtime config銆?
## 6.4 鍚屾鏇存柊 Vercel connector 瀹氫箟璇存槑

娑夊強鏂囦欢锛?
1. `apps/api/src/connectors/definitions/vercel.ts`
2. 濡傛湁蹇呰锛屽啀鍚屾 `apps/web/client/src/lib/connector-guides.ts`

瑕佹眰锛?
1. 鏂囨涓婃槑纭€淰ercel 閫氳繃骞冲彴鍐呴儴 MCP 鍖呰灞傛帴鍏ワ紝骞剁敱骞冲彴鏈湴 bridge 鎻愪緵缁?runtime鈥濄€?2. 閬垮厤鍚庣画寮€鍙戣€呰浠ヤ负 Vercel 浠嶅簲鐩存帴浠?remote `streamable_http` 娉ㄥ唽缁?runtime銆?3. 涓嶆敼鍙樼敤鎴蜂晶 OAuth 蹇冩櫤锛屼笉鏆撮湶涓嶅繀瑕佺殑搴曞眰 transport 缁嗚妭銆?
## 6.5 鎭㈠閾捐矾淇濇寔闂幆锛屼笉缁曡繃鐜版湁鐘舵€佹満

娑夊強鑼冨洿锛?
1. `session-mcp-recovery-service`
2. attach 瑙﹀彂鎭㈠鐨勭浉鍏冲叆鍙?
瑕佹眰锛?
1. 涓嶆柊澧炵粫杩囨仮澶嶈〃鍜屾仮澶嶄换鍔＄殑鈥滀复鏃剁洿杩炩€濆疄鐜般€?2. `pending_recover` 鐨?Vercel binding 鍦ㄤ笅娆℃仮澶嶆椂锛屽簲鎸夋柊 `local_stdio bridge` 鏂规閲嶆柊 attach銆?3. 鎭㈠瀹屾垚鍚庯紝鐘舵€佹姇褰变笌宸ュ叿蹇収蹇呴』鍥炲埌鐜版湁闂幆銆?
## 7. 璇︾粏鎵ц姝ラ

闃舵 A锛歜ridge 钀藉湴

1. 鏂板 `vercel-stdio-bridge.ts`
2. 鍙傝€?Supabase bridge 瀹屾垚 HTTP 杞彂銆佽秴鏃躲€侀敊璇€忎紶銆佸繀瑕佷細璇濆ご缁存姢

闃舵 B锛歳egistry 鐗╁寲鍒囨崲

1. 鍦?`connector-registry.ts` 澧炲姞 Vercel local bridge 鍒嗘敮
2. 鍘绘帀 Vercel attach 缁х画璧?remote `streamable_http` 鐨勪富璺緞

闃舵 C锛氫細璇濅笌鎭㈠楠岃瘉

1. 閫氳繃鐜版湁 attach 鎺ュ彛閲嶆柊杩炴帴 Vercel
2. 楠岃瘉 `pending_recover -> connected`
3. 楠岃瘉 `tools/list` 涓庤嚦灏戜竴娆?`tools/call`

闃舵 D锛氭枃妗ｄ笌瑙傛祴鍚屾

1. 鏇存柊 Vercel 鐩稿叧璁捐鏂囨。鐘舵€佷笌寮曠敤
2. 澧炲姞 bridge 鐩稿叧璋冭瘯鏃ュ織
3. 纭繚鏃ュ織涓笉鍑虹幇鏄庢枃 token

## 8. 娴嬭瘯鏂规

闇€瑕佹柊澧炴垨璋冩暣鐨勬祴璇曪細

1. `apps/api/tests/connector-registry.test.ts`
   - 鏂█ Vercel runtime config 琚墿鍖栦负 `type=local`
   - 鏂█ command 鎸囧悜 Vercel bridge
   - 鏂█ env 娉ㄥ叆绗﹀悎棰勬湡
2. `apps/api/tests/session-connector-service.test.ts`
   - 鏂█ Vercel attach transport 涓?`local_stdio`
3. 鏂板 `apps/api/tests/vercel-stdio-bridge.test.ts`
   - 鏂█璇锋眰鍙纭浆鍙戝埌 internal MCP URL
   - 鏂█涓婃父閿欒鍙€忎紶
   - 鏂█蹇呰浼氳瘽澶存垨璇锋眰涓婁笅鏂囪姝ｇ‘淇濈暀
4. 鎭㈠閾捐矾鑱旇皟
   - 鏂█鍘熸湰 `pending_recover` 鐨?Vercel binding 鑳芥仮澶嶅埌 `connected`

鑱旇皟楠屾敹璺緞锛?
1. 鍒涘缓鎴栧鐢ㄥ凡鏈?Vercel profile
2. 瀹屾垚 OAuth
3. 瑙﹀彂 attach
4. 妫€鏌?binding 鐨?`runtime_transport`
5. 鍦ㄤ細璇濆唴瑙﹀彂鐪熷疄 Vercel 宸ュ叿璋冪敤

## 9. 椋庨櫓涓庡簲瀵?
椋庨櫓 1锛歜ridge 杩涚▼寮傚父閫€鍑?
1. 鐜拌薄锛歱rovider attach 鍚庣煭鏃堕棿鏂紑
2. 搴斿锛歛ttach 鏃堕噸鏂版媺璧?bridge锛屽苟鎶婂け璐ヨ涔夐€忎紶缁欐仮澶嶉摼璺?
椋庨櫓 2锛歩nternal MCP 瀵归潪鍒濆鍖栬姹傚瓨鍦ㄤ細璇濆ご瑕佹眰

1. 鐜拌薄锛歚initialize` 鎴愬姛锛屼絾鍚庣画 `tools/list` / `tools/call` 鎶?4xx
2. 搴斿锛氬弬鑰?Supabase bridge锛屽湪 bridge 鍐呯淮鎶ゅ苟澶嶇敤涓婃父杩斿洖鐨勪細璇濇爣璇?
椋庨櫓 3锛氬唴閮ㄨ璇佸ご娉ㄥ叆涓嶅畬鏁?
1. 鐜拌薄锛歜ridge 鍙闂?URL锛屼絾涓婃父杩斿洖閴存潈澶辫触
2. 搴斿锛氱敱 registry 缁熶竴璐熻矗 env 娉ㄥ叆锛岄伩鍏嶆妸璁よ瘉缁勮鏁ｈ惤鍒板澶?
## 10. 闈炵洰鏍?
鏈涓嶅仛锛?
1. 涓嶄慨鏀?OSAC 鍗忚涓?transport 鏋氫妇
2. 涓嶆敼 Vercel OAuth 妯″瀷
3. 涓嶆敼 oneceo internal MCP wrapper 鐨勪笟鍔¤涔?4. 涓嶆柊澧炩€滃け璐ュ悗鑷姩鎹㈠彟涓€绉?transport鈥濈殑鍏滃簳閫昏緫
5. 涓嶇粫寮€鐜版湁鎭㈠閾捐矾銆佺姸鎬佽〃銆佸伐鍏峰揩鐓ф満鍒?
## 11. 缁撹

褰撳墠 `unsupported mcp transport: streamable_http` 鐨勬纭慨澶嶆柟鍚戯紝涓嶆槸缁х画璁?runtime 鐩存帴鍚?`streamable_http`锛岃€屾槸澶嶇敤 Supabase 宸查獙璇佺殑鏂规锛屾妸 Vercel runtime 涓婚摼鏀跺彛涓猴細

`local_stdio bridge -> 涓婃父 streamable_http`

杩欐牱鍙互鍦ㄤ笉鏀?OSAC銆佷笉鏀?Vercel OAuth 鏋舵瀯銆佷笉寮曞叆鍙屼富閾剧殑鍓嶆彁涓嬶紝鐩存帴瑙ｅ喅 attach 涓庢仮澶嶉樁娈电殑 transport 涓嶅吋瀹归棶棰樸€?
## 12. 璇勫鍗犱綅

1. 褰撳墠鐘舵€侊細`[20260424-0008宸查噰鐢╙`
2. 宸叉牴鎹湰鏂规杩涘叆浠ｇ爜瀹炵幇闃舵銆?3. 鍚庣画鑻ユ柟妗堣鏇挎崲銆佹殏鍋滄垨搴熷純锛岄渶瑕佺户缁悓姝ユ洿鏂版枃妗ｇ姸鎬佷笌鐩稿叧寮曠敤銆?