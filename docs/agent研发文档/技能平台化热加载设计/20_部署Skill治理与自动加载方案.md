# 20 部署 Skill 治理与自动加载方案 [20260418-2048已采用]

更新时间：2026-04-18

## 1. 文档目的

本文是 Skills 平台侧的补充实施文档，目标是把“部署 skill”从普通平台 skill 升级为可治理的系统级 skill 资产。

它回答三个问题：

1. deployment skill 在 skill 平台里应该长什么样
2. 管理后台应该如何治理它
3. Altus runtime 应该如何自动加载它而不回退到硬编码 prompt

## 2. 与现有主线的关系

本方案建立在当前已采用主线上：

1. [15_Altus复合存储渐进式Skills使用方案.md](./15_Altus复合存储渐进式Skills使用方案.md)
2. [16_管理后台复合存储Skills添加方案.md](./16_管理后台复合存储Skills添加方案.md)
3. [17_管理后台复合存储Skills文件夹导入方案.md](./17_管理后台复合存储Skills文件夹导入方案.md)
4. [18_前台用户复合存储Skills处理方案.md](./18_前台用户复合存储Skills处理方案.md)
5. [19_复合存储渐进式Skills方案.md](./19_复合存储渐进式Skills方案.md)

也就是说，本次不是重做 Skills 平台，而是在现有能力上补足“系统级 deployment skill 的治理语义”。

## 3. 当前缺口

当前平台 skill 已经支持：

1. 创建 / 更新 / 发布 revision
2. 资源索引与资源正文
3. 文件夹导入
4. Altus runtime 的 catalog / activation / resource materialization

但 deployment skill 还缺少三类能力：

1. 系统角色标识
   - 当前 skill 只是一个普通 skill，缺少“我就是部署编排”的平台角色语义
2. 自动加载元数据
   - 当前自动加载逻辑更像输入侧行为，skill 本身没有治理元数据表达
3. 管理后台可见性
   - 管理员无法直观看见“这个 skill 会在哪些系统动作中被自动加载”

## 4. 目标模型

### 4.1 deployment skill 是系统级 platform skill

它应具备以下固定语义：

1. `scope = system`
2. `category = deployment`
3. `systemRole = deployment_orchestrator`
4. `adminManaged = true`
5. `autoActivation.enabled = true`
6. `autoActivation.triggers = ['deploy', 'redeploy', 'rollback', 'status']`
7. `required = true`

说明：

1. `required=true` 的含义不是“不能编辑”
2. 而是“部署链路需要始终能解析到一个 published deployment skill”
3. 允许改 revision，但不允许把这个系统角色彻底删空

### 4.2 正文和资源仍沿用复合存储模型

deployment skill 继续使用现有复合存储结构：

1. entry 负责 activation body
2. resources 负责 references / templates / examples
3. 数据库存说明型资源
4. 存储桶放脚本或重型资产

这里不需要再发明新存储模型。

## 5. 建议的数据表达

如果当前 `platform_skills` / `platform_skill_revisions` 还没有足够字段，推荐增加一个最小治理元数据对象，而不是把 deployment 语义散落在多个 if/else。

建议表达为 revision 可读、skill 可聚合的元数据：

```json
{
  "systemRole": "deployment_orchestrator",
  "adminManaged": true,
  "required": true,
  "autoActivation": {
    "enabled": true,
    "triggers": ["deploy", "redeploy", "rollback", "status"]
  }
}
```

原则：

1. `systemRole` 用于解析唯一系统技能角色
2. `autoActivation` 用于表达自动挂载场景
3. `required` 用于后台阻止危险禁用

如果短期不想改 schema，也至少应在 skill service 层引入统一治理配置映射，避免多处散写。

## 6. 管理后台治理要求

### 6.1 列表页

`skills 管理` 列表页至少要能展示：

1. 是否系统级 skill
2. `systemRole`
3. 是否自动加载
4. 当前 published revision
5. 影响动作范围

deployment skill 在列表中应有明显标识，例如：

1. `系统`
2. `自动加载`
3. `部署链路`

### 6.2 详情页

详情页至少新增或明确以下内容：

1. 治理卡片
   - `systemRole`
   - `required`
   - `autoActivation.triggers`
2. revision 卡片
   - 当前 published revision
   - draft revision
   - 最近发布时间
3. 资源卡片
   - runtime references
   - 平台契约 references
4. 影响面卡片
   - deploy
   - redeploy
   - rollback
   - status

实现约束补充：

1. 管理后台 `SkillManagementSection` 中的治理选项加载与视图状态持久化都属于既有主流程能力，后续合并或重构时必须同时保留，不能以其中一侧覆盖另一侧。

### 6.3 风险操作限制

对 deployment skill 应增加限制：

1. 不允许直接 archive 唯一 published deployment skill
2. 不允许移除 `systemRole=deployment_orchestrator` 后仍保持自动加载开启
3. 若没有新的 published revision，不允许把旧 revision 下线

## 7. Altus runtime 接入要求

### 7.1 catalog 阶段

runtime 仍按现有模型生成：

1. `managedSkillCatalog`
2. `managedSkillActivationContext`

但 deployment skill 的自动选择逻辑要从“写死 skill slug”改成“解析系统角色”。

### 7.2 选择顺序

推荐顺序：

1. 判断当前请求是不是 deployment action
2. 从可用平台 skills 中解析：
   - `systemRole=deployment_orchestrator`
   - `status=active`
   - 存在 published revision
3. 注入该 revision
4. 再走现有 selections 去重逻辑

### 7.3 冲突规则

如果未来出现多个 deployment 相关 skills：

1. 自动加载只加载唯一 `systemRole=deployment_orchestrator`
2. 其他辅助 skills 仍需手动选择或由更高层编排显式附加

这样才能避免 deployment 自动链路失控。

## 8. 资源组织建议

deployment skill 的资源建议固定出一个清晰骨架：

1. `references/runtime-classifier.md`
2. `references/deploy-repair-loop.md`
3. `references/railway-contract.md`
4. `references/umami-contract.md`
5. `references/static-html-js.md`
6. `references/nodejs.md`
7. `references/python.md`
8. `references/java.md`
9. `references/php.md`

说明：

1. `railway-contract.md` 和 `umami-contract.md` 不是为了让 skill 执行底层平台逻辑
2. 而是为了告诉 Altus 哪些问题属于平台资源修复边界，不能继续在 workspace 里瞎改

## 9. 为什么这件事必须走 Skills 管理后台

因为 deployment skill 本质上是“平台部署知识库”，不是一次性 prompt 片段。

放在管理后台治理有三个直接收益：

1. 变更可审计
   - 谁改了哪些语言指导
   - 哪个 revision 在生产生效
2. 变更可回滚
   - 某次 deployment skill 改坏了，能直接回退 revision
3. 扩展可控
   - 新语言、新脚本形态、新设计模式通过发布 revision 即可进入主链

## 10. 实施建议

### Step 1：补齐治理元数据

## 11. 回归补充约束

部署 skill 的自动加载已经不是单纯的“输入识别”细节，而是部署主链的真实入口之一，因此后续回归必须覆盖聊天触发链路：

1. 以普通会话消息发送“帮我部署当前项目”。
2. 校验 runtime 最终走到 `deployment_orchestrator` 自动挂载链路，而不是只验证直接调用部署 API。
3. 若部署面板进入 `public_settling`，但已经返回可探测的 `publicUrl` / `publicDomain` / provider URL，则回归脚本应继续执行公网探测与后续验证，不应仅因为状态仍在收敛中就提前超时失败。

这样做的目的，是保证“部署 skill 自动挂载”与“部署结果对外可验证”两条链路一起被验证，而不是只测到半截。

## 11.1 平台能力失败分流补充（2026-05-10）

deployment skill 需要新增一条明确治理规则：

1. 当部署工具返回 `repair.category=platform_capability` 时，表示失败点位于平台预检环境，而不是工作区源码
2. 命中该类别后，deployment skill 不得继续引导 Altus 修改 `package.json`、`oneceo.manifest.json`、`vite.config.ts`、固定 healthcheck 壳或安装 Playwright 依赖
3. deployment skill 只能汇报平台阻塞、等待平台能力恢复，或在恢复后重新触发部署工具

这条规则的目的，是把“强模板策略”真正延伸到部署修复阶段，避免平台基础设施错误再次被误路由成工作区代码修复。

## 11.2 风险确认后的部署意图继承（2026-05-10）

deployment skill 自动加载还需要补一条运行时约束：

1. 若上一条用户消息已经是显式部署动作
2. 当前轮只是对 `deploy.production` / `deploy.preview` 风险确认问题的回答
3. 用户回复是“确认”“确认继续”“继续”这类确认语句

则 runtime 必须恢复上一条显式部署意图的 `deployRequested / deploymentAllowed / capabilityKind`，继续挂载 `deployment_orchestrator`。

这条规则只适用于“有待回答的部署风险确认问题”场景，不适用于普通多轮闲聊。也就是说，系统仍然保留“模糊当前轮不能平白继承历史部署动作”的主规则，只是在风险确认闭环里允许继承。

在平台 skill 数据层或 service 聚合层补齐：

1. `systemRole`
2. `required`
3. `autoActivation`

补充执行要求：

1. 启动期 schema readiness 必须把 `platform_skills.metadata_json` 视为必需列，缺失时直接触发迁移
2. `platformSkillService.ensureSeeded()` 在读取 seed skill 时，如果命中 `metadata_json` 缺列错误，必须先完成定向 schema 修复，再重试 seed 读取
3. 不能把“等环境手动迁移后再恢复”作为唯一修复路径，否则管理后台会在首个 skills 请求上直接失败

### Step 2：后台可见化

在管理后台 `skills 管理` 页面显示上述元数据，并对 deployment skill 增加危险操作保护。

### Step 3：runtime 解析升级

把自动挂载逻辑升级为：

1. 按 deployment action 触发
2. 按 `systemRole=deployment_orchestrator` 解析
3. 不再依赖散落的硬编码 slug 判断

### Step 4：语言资源化

把部署指导按语言和契约拆成 resources，由管理员在后台直接改 revision。

## 11. 验收标准

满足以下条件即视为平台侧完成：

1. 管理后台能识别 deployment skill 是系统级、自动加载、必需的 skill
2. deployment skill 的正文与语言资源可通过 revision 治理
3. Altus 在部署场景会自动加载当前 published deployment skill
4. 修改 deployment skill revision 后，不需要再修改 prompt 硬编码即可影响后续部署 run
5. deployment skill 无法被误 archive 或误下线导致部署链路失去指导层

## 12. 结论

Skills 平台不应该只把 deployment skill 当成一个“普通内容对象”。

它应当被明确定义为：

1. 系统级
2. 自动加载
3. 管理端治理
4. revision 驱动

只有这样，“未来通过改 deployment skill 来适配新的语言和新的设计模式，而不是再改硬编码”这件事才真正成立。
