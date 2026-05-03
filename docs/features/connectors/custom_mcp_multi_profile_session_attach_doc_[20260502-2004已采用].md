# Custom MCP 多 Profile 会话并挂方案 [20260502-2004已采用]

## 1. 鑳屾櫙

褰撳墠鑷畾涔?MCP 鐨勭鐞嗚兘鍔涘凡缁忓厑璁哥敤鎴峰垱寤哄涓?`custom_mcp` profile锛屼絾浠诲姟浼氳瘽 attach 灞備粛鎶?`custom_mcp` 褰撴垚鍗曚釜杩炴帴鍣ㄥ疄渚嬪鐞嗐€傜粨鏋滄槸锛氬悓涓€浼氳瘽涓墦寮€绗簩涓嚜瀹氫箟 MCP 鏃讹紝浼氳鐩栫涓€涓嚜瀹氫箟 MCP 鐨勭粦瀹氾紝鍓嶇寮€鍏充篃琛ㄧ幇涓轰簰鏂ャ€?
杩欎笉绗﹀悎 Custom MCP 鐨勫疄闄呬娇鐢ㄦ柟寮忋€傜敤鎴峰彲鑳藉悓鏃堕渶瑕佹寕杞借彍璋?MCP銆佹枃妗?MCP銆佷紒涓氬唴閮ㄥ伐鍏?MCP 绛夊涓繙绋?MCP server銆傚畠浠兘灞炰簬 `custom_mcp` 绫诲瀷锛屼絾鍦ㄤ細璇濊繍琛屾椂搴斿綋鏄涓嫭绔?provider銆?
## 2. 褰撳墠鏍瑰洜

### 2.1 鏁版嵁搴撳敮涓€閿寜 connector_key 浜掓枼

褰撳墠 `task_session_connector_bindings` 鐨勫敮涓€绱㈠紩鏄細

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_connector_bindings_session_connector
  ON task_session_connector_bindings(task_session_id, connector_key);
```

鍥犳鍚屼竴 `task_session_id` 涓嬪彧鑳藉瓨鍦ㄤ竴琛?`connector_key = custom_mcp`銆?
### 2.2 鏈嶅姟灞傜敤 connectorKey 鑱氬悎鐘舵€?
`session-connector-service.ts` 褰撳墠鎶?bindings 鑱氬悎鎴愶細

```ts
const bindingMap = new Map(bindings.map((item) => [item.connectorKey, item]));
```

杩欎細鎶婂悓涓€ connectorKey 鐨勫鏉＄粦瀹氬帇缂╂垚涓€鏉°€傚嵆浣挎暟鎹簱鍏佽澶氳锛岀姸鎬佽緭鍑轰粛浼氫涪澶卞 profile銆?
### 2.3 鍓嶇鑽夌鐢?connectorKey 鍋氬敮涓€ key

`session-connector-draft.ts` 褰撳墠缁撴瀯鏄細

```ts
entries: Record<string, SessionConnectorDraftEntry>
```

鍐欏叆鏃讹細

```ts
state.entries[connectorKey] = entry
```

鎵€浠ュ涓?Custom MCP profile 閮戒細鍐欏埌 `entries.custom_mcp`锛屽悗鍐欒鐩栧厛鍐欍€?
### 2.4 鍓嶇 ConnectorDialog 浠嶆妸 custom_mcp 褰撳崟涓?session 鐘舵€?
褰撳墠 UI 铏界劧鎶婂涓?custom MCP profile 娓叉煋涓哄琛岋紝浣嗗垽鏂姸鎬佷粛渚濊禆鍚屼竴涓?`custom_mcp` session锛?
```ts
session?.attachedProfileId === selectedProfileId
```

杩欏彧閫傚悎鈥滀竴绫昏繛鎺ュ櫒涓€涓?profile鈥濈殑妯″瀷锛屼笉閫傚悎鈥滃悓涓€杩炴帴鍣ㄧ被鍨嬪涓疄渚嬧€濈殑妯″瀷銆?
## 3. 鐩爣

1. 鍚屼竴浠诲姟浼氳瘽鍙互鍚屾椂 attach 澶氫釜 `custom_mcp` profile銆?2. 姣忎釜 Custom MCP profile 鍦ㄤ細璇濅腑鏄嫭绔?provider锛岀嫭绔?runtime 鐘舵€併€侀敊璇€乼ools銆乪nabledTools銆?3. 鍐呯疆杩炴帴鍣ㄥ GitHub銆丯otion銆丼lack銆丼upabase銆丗igma銆乂ercel 浠嶄繚鎸佸綋鍓嶁€滀竴 connectorKey 涓€缁戝畾鈥濈殑琛屼负銆?4. 涓嶅紩鍏?`custom_mcp_1`銆乣custom_mcp_2` 杩欑被铏氭嫙 connectorKey銆?5. 涓嶆敼鍙樼敤鎴?profile 瀛樺偍妯″瀷锛岀户缁鐢?`user_connector_profiles`銆?6. 鍒犻櫎鎴栧仠鐢ㄦ煇涓?custom MCP profile 鏃讹紝鍙奖鍝嶅紩鐢ㄨ profile 鐨勪細璇濈粦瀹氾紝涓嶅奖鍝嶅悓浼氳瘽鍏朵粬 custom MCP銆?
## 4. 闈炵洰鏍?
1. 涓嶆敮鎸佸悓涓€浼氳瘽閲嶅 attach 鍚屼竴涓?custom MCP profile 澶氭銆?2. 涓嶆敼鍐呯疆杩炴帴鍣ㄧ殑 profile 鍒囨崲璇箟銆?3. 涓嶅湪鏈鍋氬涓?custom MCP 鐨勫伐鍏峰悕鍐茬獊閲嶅懡鍚嶇瓥鐣ワ紱濡傛灉杩滅 MCP 宸ュ叿鍚嶅啿绐侊紝鐢?OSAC/provider 灞傛寜 providerId 鍖哄垎銆?4. 涓嶅紩鍏ユ柊鐨勮嚜瀹氫箟 MCP 瀛樺偍琛ㄣ€?
## 5. 鏂规閫夋嫨

### 5.1 閲囩敤 connector instance key

鏂板姒傚康锛歚connectorInstanceKey`銆?
瀹冧唬琛ㄢ€滄煇涓繛鎺ュ櫒鍦ㄦ煇涓細璇濋噷鐨勫叿浣撳疄渚嬧€濄€傝鍒欙細

```ts
function connectorInstanceKey(connectorKey: ConnectorKey, profileId?: string | null) {
  if (connectorKey === 'custom_mcp') {
    if (!profileId) throw new Error('custom_mcp requires profileId');
    return `custom_mcp:${profileId}`;
  }
  return connectorKey;
}
```

瑙ｉ噴锛?
1. 鍐呯疆杩炴帴鍣細`connectorInstanceKey === connectorKey`銆?2. Custom MCP锛歚connectorInstanceKey === custom_mcp:${profileId}`銆?3. 浼氳瘽缁戝畾銆佸墠绔崏绋裤€乁I 琛岀姸鎬併€丱SAC provider 鐘舵€侀兘鍥寸粫 instance key 鑱氬悎銆?4. connector registry 浠嶅彧瀛樺湪 `custom_mcp`锛屼笉姹℃煋娉ㄥ唽琛ㄣ€?
### 5.2 涓轰粈涔堜笉閲囩敤铏氭嫙 connectorKey

鎷掔粷鏂规锛?
```text
custom_mcp_howtocook
custom_mcp_docs
custom_mcp_xxx
```

鍘熷洜锛?
1. 浼氭薄鏌?`ConnectorKey` 绫诲瀷鍜?connector registry銆?2. profile 鍚嶇О鍙樻洿浼氬奖鍝?key 绋冲畾鎬с€?3. connector guide銆丱Auth銆佹潈闄愩€佸璁′細琚揩璇嗗埆鍔ㄦ€?connectorKey銆?4. 鍒犻櫎 profile 鍚庡巻鍙蹭細璇濋毦浠ユ仮澶嶅叾鐪熷疄绫诲瀷銆?
### 5.3 涓轰粈涔堜笉鏂板缓 custom_mcp_session_bindings 琛?
鎷掔粷鏂规锛氱粰 custom MCP 鍗曠嫭寤轰竴寮犵粦瀹氳〃銆?
鍘熷洜锛?
1. 浼氫骇鐢熶袱濂?attach/recover/runtime/event 閫昏緫銆?2. OSAC 鎭㈠閾捐矾宸茬粡鍥寸粫 `task_session_connector_bindings` 寤虹珛銆?3. 褰撳墠闂鏈川鏄粦瀹氬敮涓€韬唤涓嶅锛屼笉鏄渶瑕佹柊涓氬姟琛ㄣ€?
## 6. 鏁版嵁搴撴敼閫?
### 6.1 鏂板瀛楁

缁?`task_session_connector_bindings` 澧炲姞锛?
```sql
ALTER TABLE task_session_connector_bindings
  ADD COLUMN IF NOT EXISTS connector_instance_key TEXT;
```

鍥炲～锛?
```sql
UPDATE task_session_connector_bindings
SET connector_instance_key =
  CASE
    WHEN connector_key = 'custom_mcp' AND profile_id IS NOT NULL
      THEN connector_key || ':' || profile_id
    ELSE connector_key
  END
WHERE connector_instance_key IS NULL OR connector_instance_key = '';
```

### 6.2 鍞竴绱㈠紩璋冩暣

鏂板鍞竴绱㈠紩锛?
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_connector_bindings_session_instance
  ON task_session_connector_bindings(task_session_id, connector_instance_key);
```

鏃х储寮曞鐞嗭細

```sql
DROP INDEX IF EXISTS idx_task_session_connector_bindings_session_connector;
```

琛ュ厖鏅€氱储寮曪細

```sql
CREATE INDEX IF NOT EXISTS idx_task_session_connector_bindings_session_connector
  ON task_session_connector_bindings(task_session_id, connector_key);
```

鍘熷洜锛氭煡璇㈡煇绫昏繛鎺ュ櫒浠嶉渶瑕佹寜 `task_session_id + connector_key` 鏌ュ鏉°€?
### 6.3 鏁版嵁绾︽潫

搴旂敤灞傚繀椤讳繚璇侊細

1. `connector_key = custom_mcp` 鏃讹紝`profile_id` 蹇呭～銆?2. `connector_key = custom_mcp` 鏃讹紝`connector_instance_key = custom_mcp:${profile_id}`銆?3. 闈?`custom_mcp` 杩炴帴鍣ㄧ殑 `connector_instance_key = connector_key`銆?
涓嶅缓璁涓€闃舵娣诲姞澶嶆潅 CHECK 绾︽潫锛屽洜涓虹幇鏈?SQLite/PG 鏈湴寮€鍙戝拰杩佺Щ鑴氭湰鍙兘涓嶅畬鍏ㄤ竴鑷淬€傚厛鍦?DAO/service 灞傚己鍒躲€?
## 7. 鍚庣鏈嶅姟鏀归€?
### 7.1 DAO 鏂规硶鏀归€?
`taskSessionConnectorBindingDAO.upsert` 闇€瑕佹寜 instance key upsert锛?
杈撳叆澧炲姞锛?
```ts
connectorInstanceKey?: string;
```

鍐呴儴瑙勮寖鍖栵細

```ts
const instanceKey = buildConnectorInstanceKey(connectorKey, profileId);
```

鏇存柊鏉′欢浠庯細

```ts
taskSessionId + connectorKey
```

鏀逛负锛?
```ts
taskSessionId + connectorInstanceKey
```

### 7.2 updateRuntime / detach 鏀归€?
褰撳墠閮ㄥ垎杩愯鏃舵洿鏂版寜锛?
```ts
updateRuntime(taskSessionId, connectorKey, patch)
```

杩欎細璇洿鏂板悓浼氳瘽鎵€鏈?custom MCP锛屽繀椤绘敼涓猴細

```ts
updateRuntimeByInstance(taskSessionId, connectorInstanceKey, patch)
```

鎴栦紭鍏堜娇鐢?`bindingId`锛?
```ts
updateRuntimeByBindingId(bindingId, patch)
```

鎺ㄨ崘瀹炵幇璺緞锛氳繍琛屾椂 attach 宸茬粡鎷垮埌 `binding.id`锛屽悗缁け璐?鎴愬姛鏇存柊鍏ㄩ儴鏀圭敤 `bindingId`锛屽噺灏?key 璇敤銆?
### 7.3 attach lock 鏀归€?
褰撳墠閿侊細

```ts
attachLockKey(taskSessionId, connectorKey)
```

搴旀敼涓猴細

```ts
attachLockKey(taskSessionId, connectorInstanceKey)
```

鏁堟灉锛氬悓涓€浼氳瘽鍙互骞惰鎴栭『搴?attach 涓嶅悓 Custom MCP profile锛屼絾鍚屼竴涓?profile 涓嶄細閲嶅 attach銆?
### 7.4 providerId 淇濇寔绋冲畾

褰撳墠 providerId锛?
```ts
task_session:${taskSessionId}:connector:${connectorKey}:profile:${profileId}
```

杩欎釜鏍煎紡宸茬粡鍖呭惈 profileId锛屽彲浠ョ户缁娇鐢ㄣ€傞渶瑕佺‘淇濇墍鏈夋棩蹇椼€乺untime map銆乺ecovery job 浣跨敤璇?providerId 涓?connectorInstanceKey 瀵归綈銆?
### 7.5 listSessionConnectors 杩斿洖缁撴瀯

鐜版湁 `SessionConnectorStatus[]` 鏄寜 connector catalog 杈撳嚭锛屼竴涓?connectorKey 涓€椤广€備负浜嗘敮鎸?custom MCP 澶氬疄渚嬶紝鏈変袱绉嶈緭鍑虹瓥鐣ワ細

閲囩敤绛栫暐 A锛氫繚鎸佸唴缃繛鎺ュ櫒涓€椤癸紝custom MCP 棰濆杈撳嚭 profile 瀹炰緥椤广€?
```ts
type SessionConnectorStatus = {
  connectorKey: ConnectorKey;
  connectorInstanceKey: string;
  profileId?: string | null;
  isConnectorInstance?: boolean;
  // existing fields...
}
```

杈撳嚭绀轰緥锛?
```json
[
  { "connectorKey": "github", "connectorInstanceKey": "github" },
  { "connectorKey": "notion", "connectorInstanceKey": "notion" },
  {
    "connectorKey": "custom_mcp",
    "connectorInstanceKey": "custom_mcp:08ff...",
    "selectedProfileId": "08ff...",
    "attachedProfileId": "08ff...",
    "name": "howtocook-mcp",
    "attached": true
  },
  {
    "connectorKey": "custom_mcp",
    "connectorInstanceKey": "custom_mcp:ab12...",
    "selectedProfileId": "ab12...",
    "attachedProfileId": "ab12...",
    "name": "docs-mcp",
    "attached": true
  }
]
```

娉ㄦ剰锛氳繛鎺ュ櫒涓績绠＄悊椤典粛浠?profile API 灞曠ず鍒楄〃锛屼笉渚濊禆 session connector status 浣滀负 profile 鏉ユ簮銆?
### 7.6 鎭㈠閾捐矾鏀归€?
鎭㈠浠诲姟 key 蹇呴』鍖呭惈 instance锛?
```ts
recoveryKey = `${taskSessionId}:${connectorInstanceKey}:${orchestratorSessionId}`
```

鎭㈠鎵弿 `task_session_connector_bindings` 鏃讹紝涓嶅啀鍋囪鍚屼竴涓?connectorKey 鍙湁涓€鏉°€傛瘡鏉?desiredState=attached 鐨?binding 閮藉簲鐙珛鎭㈠銆?
### 7.7 connector guide

`task_session_connector_guides` 褰撳墠涔熸槸 `task_session_id + connector_key` 鍞竴銆侰ustom MCP 澶氬疄渚嬩笉闇€瑕佹瘡涓?profile 鐢熸垚涓嶅悓 guide锛岀涓€闃舵浠嶆寜 `custom_mcp` 绫诲瀷鍏辩敤涓€浠?guide銆?
鍥犳鏈涓嶆敼 `task_session_connector_guides` 鍞竴閿€?
## 8. API 濂戠害鏀归€?
### 8.1 attach 璇锋眰

淇濇寔鐜版湁杈撳叆锛?
```json
{
  "connectorKey": "custom_mcp",
  "profileId": "08ff9923-7772-4f70-b700-837918ff3b37",
  "desiredState": "attached"
}
```

鍚庣鍐呴儴鐢熸垚锛?
```json
{
  "connectorInstanceKey": "custom_mcp:08ff9923-7772-4f70-b700-837918ff3b37"
}
```

### 8.2 detach 璇锋眰

蹇呴』鎼哄甫 profileId 鎴?connectorInstanceKey銆傚墠绔紭鍏堜紶 profileId锛屼繚鎸佷笌鐜版湁璋冪敤鍏煎锛?
```json
{
  "connectorKey": "custom_mcp",
  "profileId": "08ff9923-7772-4f70-b700-837918ff3b37",
  "desiredState": "detached"
}
```

濡傛灉 `custom_mcp` detach 涓嶅甫 profileId锛屽悗绔繀椤绘嫆缁濓紝涓嶈兘榛樿 detach 鍏ㄩ儴銆?
閿欒锛?
```json
{
  "code": "custom_mcp_profile_required",
  "message": "Detach custom MCP requires profileId."
}
```

### 8.3 list response

鏂板瀛楁锛?
```ts
connectorInstanceKey: string;
isConnectorInstance?: boolean;
```

鍐呯疆杩炴帴鍣ㄥ墠绔彲浠ュ拷鐣ヨ瀛楁銆侰ustom MCP UI 蹇呴』浣跨敤瀹冧綔涓?React row key 鍜屽紑鍏崇姸鎬?key銆?
## 9. 鍓嶇鏀归€?
### 9.1 鑽夌缁撴瀯鍗囩骇

褰撳墠锛?
```ts
entries: Record<string, SessionConnectorDraftEntry>
```

鍗囩骇涓猴細

```ts
entries: Record<string, SessionConnectorDraftEntry>
```

瀛楁鍚嶄笉鍙橈紝浣?key 浠?connectorKey 鏀逛负 connectorInstanceKey銆?
鏂板鏂规硶锛?
```ts
buildConnectorDraftKey(connectorKey, profileId)
```

瑙勫垯锛?
1. 鍐呯疆杩炴帴鍣細`github`銆乣notion`銆?2. Custom MCP锛歚custom_mcp:${profileId}`銆?
涓轰簡鍏煎鏃?localStorage锛?
1. 璇诲彇鍒?`entries.custom_mcp` 涓旀湁 `profileId` 鏃讹紝杩佺Щ鍒?`entries["custom_mcp:${profileId}"]`銆?2. 杩佺Щ鍚庡垹闄ゆ棫 `entries.custom_mcp`銆?3. 涓嶅甫 profileId 鐨勬棫 custom_mcp 鑽夌鐩存帴涓㈠純锛屽洜涓烘棤娉曠‘瀹氬疄渚嬨€?
### 9.2 璇曠敤涓€涓?
鈥滆瘯鐢ㄤ竴涓嬧€濆啓鍏ヨ崏绋挎椂涓嶅啀瑕嗙洊 `entries.custom_mcp`锛岃€屾槸鍐欏叆锛?
```ts
entries[`custom_mcp:${profile.profileId}`]
```

濡傛灉鐢ㄦ埛杩炵画璇曠敤澶氫釜 Custom MCP锛屾柊寤哄璇濇椂搴斿叏閮ㄨ繘鍏ヨ崏绋挎寕杞介泦鍚堬紝鑰屼笉鏄簰鏂ャ€?
### 9.3 ConnectorDialog 鍒楄〃

Custom MCP profile 琛岀殑 checked 鐘舵€佹敼涓猴細

```ts
attachedByInstanceKey.get(`custom_mcp:${profileId}`)?.attached === true
```

鐐瑰嚮寮€鍏虫椂锛?
```ts
handleAttach("custom_mcp", profileId, checked ? "detach" : "attach")
```

React key 浣跨敤锛?
```ts
rowKey = `custom_mcp:${profile.profileId}`
```

涓嶅啀浣跨敤鍗曚釜 `session` 鍒ゆ柇鍏ㄩ儴 custom MCP 鐘舵€併€?
### 9.4 绠＄悊椤靛崱鐗?
杩炴帴鍣ㄤ腑蹇冭嚜瀹氫箟 MCP 鍗＄墖闇€瑕佸睍绀猴細

1. 褰撳墠 profile 鏄惁宸叉寕杞藉埌鐩爣浼氳瘽銆?2. 澶氫釜 profile 鍙互鍚屾椂鏄剧ず宸叉寕杞姐€?3. 鈥滆瘯鐢ㄤ竴涓嬧€濇寜閽笉褰卞搷鍏朵粬宸叉寕杞?profile銆?
## 10. OSAC / Hosted Provider 杩愯鏃?
### 10.1 娉ㄥ唽 provider

姣忎釜 custom MCP profile 娉ㄥ唽涓€涓?provider锛?
```json
{
  "providerId": "task_session:{taskSessionId}:connector:custom_mcp:profile:{profileId}",
  "connectorKey": "custom_mcp",
  "connectorInstanceKey": "custom_mcp:{profileId}",
  "transport": "backend_rpc"
}
```

### 10.2 hosted provider RPC

hosted provider 鏀跺埌璋冪敤鏃讹紝蹇呴』浠?providerId 鎴?metadata 涓В鏋?profileId銆備笉寰楀啀鍙€氳繃 `connectorKey=custom_mcp` 鏌ュ敮涓€ binding銆?
鏍￠獙椤哄簭锛?
1. 瑙ｆ瀽 providerId 寰楀埌 taskSessionId銆乧onnectorKey銆乸rofileId銆?2. 鏌ヨ `task_session_connector_bindings` 涓搴?connectorInstanceKey銆?3. 纭 binding desiredState=attached銆?4. 纭 profile 灞炰簬 session owner銆?5. 瑙ｅ瘑璇?profile headers銆?6. 浠ｇ悊杩滅▼ MCP銆?
## 11. 鍒犻櫎涓庡仠鐢ㄨ鍒?
鍒犻櫎 custom MCP profile 鏃讹細

1. 鎵惧埌鎵€鏈?`connector_key=custom_mcp AND profile_id=:profileId` 鐨?binding銆?2. 灏嗚繖浜?binding 鏍囪涓?`desired_state=detached`銆乣runtime_status=disconnected`銆?3. 瀵规瘡涓湁 runtimeProviderId 鐨?binding 鍙戣捣 detach provider銆?4. 涓嶅奖鍝嶅悓涓€浼氳瘽閲屽叾浠?custom MCP profile銆?
鍋滅敤 profile 鏃讹細

1. 宸?attach 鐨?binding 鏍囪涓?failed 鎴?unavailable銆?2. 鏂?attach 璇锋眰鐩存帴鎷掔粷銆?3. 鍓嶇瀵瑰簲 profile 琛屾樉绀轰笉鍙敤鐘舵€併€?
## 12. 杩佺Щ姝ラ

1. 鏁版嵁搴撴柊澧?`connector_instance_key`銆?2. 鍥炲～鐜版湁鏁版嵁銆?3. 鏂板 `task_session_id + connector_instance_key` 鍞竴绱㈠紩銆?4. 鍒犻櫎鏃у敮涓€绱㈠紩锛岄噸寤烘櫘閫氱储寮曘€?5. DAO upsert/update/detach 鍏ㄩ儴鍒囧埌 instance key 鎴?bindingId銆?6. 鏈嶅姟灞傜姸鎬佽仛鍚堟敼涓烘敮鎸?custom MCP 澶?binding銆?7. 鍓嶇 draft key 杩佺Щ銆?8. ConnectorDialog 鍜?CustomMcpManagementPanel 鏀逛负 instance 鐘舵€佸垽鏂€?9. 鎭㈠浠诲姟 recoveryKey 澧炲姞 instance 缁村害銆?10. 琛ラ綈娴嬭瘯銆?
## 13. 娴嬭瘯娓呭崟

### 13.1 鍚庣鍗曞厓娴嬭瘯

1. 鍚屼竴 taskSession attach 涓や釜涓嶅悓 custom MCP profile锛岀敓鎴愪袱鏉?binding銆?2. 閲嶅 attach 鍚屼竴涓?profile锛屼笉鏂板閲嶅 binding锛屽彧鏇存柊鍘?binding銆?3. detach 涓€涓?custom MCP profile锛屼笉褰卞搷鍙︿竴涓€?4. 闈?custom MCP 浠嶄繚鎸佸悓涓€ connectorKey 鍙兘涓€鏉?binding銆?5. listSessionConnectors 杩斿洖涓や釜 custom_mcp instance 鐘舵€併€?6. recovery job 瀵逛袱涓?custom MCP profile 鍒嗗埆鎭㈠銆?7. 鍒犻櫎 profile 鍙?detach 瀵瑰簲 profile 鐨?bindings銆?
### 13.2 鍓嶇娴嬭瘯

1. 鑽夌涓繛缁€夋嫨涓や釜 Custom MCP profile锛屼笉浜掔浉瑕嗙洊銆?2. ConnectorDialog 鍚屾椂鏄剧ず涓や釜 custom MCP 寮€鍏充负寮€鍚€?3. 鍏抽棴鍏朵腑涓€涓紑鍏筹紝鍙︿竴涓繚鎸佸紑鍚€?4. 鈥滆瘯鐢ㄤ竴涓嬧€濆涓?profile 鍚庯紝鏂板缓瀵硅瘽淇濈暀澶氫釜鑽夌鎸傝浇椤广€?5. 鏃?localStorage `entries.custom_mcp` 鑷姩杩佺Щ鍒?`entries.custom_mcp:{profileId}`銆?
### 13.3 闆嗘垚娴嬭瘯

1. 浣跨敤涓や釜 mock MCP server锛屽垎鍒繑鍥炰笉鍚?tools/list銆?2. 鍚屼竴浼氳瘽 attach 涓や釜 profile銆?3. OSAC MCP map 涓瓨鍦ㄤ袱涓?providerId銆?4. Altus 鑳界湅鍒颁袱缁?tools銆?5. 璋冪敤绗竴涓?MCP tool 涓嶅奖鍝嶇浜屼釜 MCP provider 鐘舵€併€?
## 14. 椋庨櫓涓庡鐞?
### 14.1 鏃х粦瀹氭暟鎹?
椋庨櫓锛氭棫 custom_mcp binding 娌℃湁 profileId銆?
澶勭悊锛氳繖绫?binding 鏃犳硶鎭㈠鍒板叿浣?profile锛屽簲鏍囪涓?detached锛屽苟璁板綍杩佺Щ鏃ュ織銆備笉鑳界寽娴嬮粯璁?profile锛屽惁鍒欏彲鑳芥寕閿欑敤鎴烽厤缃€?
### 14.2 鍓嶇鏃ц崏绋?
椋庨櫓锛氭棫鑽夌鍙湁 `entries.custom_mcp`銆?
澶勭悊锛氬鏋?entry 鏈?profileId锛岃嚜鍔ㄨ縼绉伙紱娌℃湁 profileId锛屼涪寮冭 entry銆?
### 14.3 宸ュ叿鍚嶅啿绐?
椋庨櫓锛氫袱涓?MCP server 鏆撮湶鍚屽悕 tool銆?
澶勭悊锛氱涓€闃舵涓嶅湪 oneceo 灞傞噸鍛藉悕锛屼緷璧?OSAC providerId 鍖哄垎 provider tools銆傝嫢 UI 灞曠ず宸ュ叿鍒楄〃锛屽繀椤诲悓鏃舵樉绀?provider/profile 鍚嶇О銆?
### 14.4 鎭㈠閾捐矾璇鐩?
椋庨櫓锛氫粛鏈夋棫浠ｇ爜鎸?connectorKey 鏇存柊 runtime锛屼細瑕嗙洊鍚屼細璇濆叾浠?custom MCP銆?
澶勭悊锛氬疄鐜伴樁娈靛繀椤诲叏鏂囨悳绱㈠苟鏇挎崲浠ヤ笅妯″紡锛?
```text
updateRuntime(taskSessionId, connectorKey)
bindingMap.get(connectorKey)
attachLockKey(taskSessionId, connectorKey)
entries[connectorKey]
removeSessionConnectorDraftEntry(connectorKey)
```

## 15. 楠屾敹鏍囧噯

1. 鍚屼竴浼氳瘽鍙悓鏃?attach 鑷冲皯 3 涓?custom MCP profile銆?2. UI 涓?3 涓?custom MCP 鍗＄墖寮€鍏冲彲鍚屾椂寮€鍚€?3. 浠绘剰 detach 涓€涓紝涓嶅奖鍝嶅彟澶栦袱涓€?4. 鏂板缓浼氳瘽鑽夌鍙悓鏃舵惡甯﹀涓?custom MCP銆?5. OSAC provider 鍒楄〃涓瘡涓?custom MCP profile 鏈夌嫭绔?providerId銆?6. 鏈嶅姟閲嶅惎鎴?sandbox 鎭㈠鍚庯紝澶?custom MCP 浠嶈兘鎭㈠銆?7. 鍐呯疆杩炴帴鍣ㄨ涓轰笉鍙樸€?
## 16. 瀹炴柦杈圭晫

鏈柟妗堝睘浜庣粨鏋勬€т慨澶嶏紝涓嶅簲閲囩敤涓存椂鍏煎鏂规銆傚疄鐜版椂涓嶅緱锛?
1. 鐢ㄥ姩鎬?connectorKey 浠ｆ浛 connectorInstanceKey銆?2. 鍦ㄥ墠绔湰鍦扮‖濉炲涓?custom MCP锛屼絾鍚庣浠嶅彧瀛樹竴鏉?binding銆?3. detach custom_mcp 鏃朵笉甯?profileId銆?4. 璁?listSessionConnectors 瀵?custom_mcp 鍙繑鍥炰竴涓悎骞剁姸鎬併€?
## 17. 寰呯‘璁?
1. 鏄惁鎺ュ彈鏂板 `connector_instance_key` 瀛楁骞惰皟鏁村敮涓€绱㈠紩銆?2. 鏄惁鎺ュ彈 `listSessionConnectors` 瀵?custom MCP 杩斿洖澶氭潯 instance 鐘舵€併€?3. 鏄惁瑕佹眰鈥滆瘯鐢ㄤ竴涓嬧€濊繛缁偣鍑诲涓?MCP 鏃讹紝鏂颁細璇濋粯璁ゆ寕杞藉叏閮ㄥ凡璇曠敤椤广€?

