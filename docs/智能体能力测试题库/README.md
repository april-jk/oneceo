# 智能体能力测试题库

## 部署链路专项

- [20260428_部署链路成本分级回归SOP_[20260428-1918已采用].md](./20260428_部署链路成本分级回归SOP_%5B20260428-1918%E5%B7%B2%E9%87%87%E7%94%A8%5D.md)

本目录用于集中存放 Altus 与其他智能体能力评估相关的测试问题、题组方案、评分规则与回归记录。

## 当前索引

- [20260420_Altus智能体能力测试体系设计_[20260420-1327已采用].md](/Users/watson/codingProj/oneceo/docs/智能体能力测试题库/20260420_Altus智能体能力测试体系设计_[20260420-1327已采用].md)
- [20260420_Altus智能体能力评分标准_[20260420-1327已采用].md](/Users/watson/codingProj/oneceo/docs/智能体能力测试题库/20260420_Altus智能体能力评分标准_[20260420-1327已采用].md)
- [20260420_Altus智能体测试结果存储规范_[20260420-1327已采用].md](/Users/watson/codingProj/oneceo/docs/智能体能力测试题库/20260420_Altus智能体测试结果存储规范_[20260420-1327已采用].md)
- [20260420_Altus首批长期复用测试题库_[20260420-1327已采用].md](/Users/watson/codingProj/oneceo/docs/智能体能力测试题库/20260420_Altus首批长期复用测试题库_[20260420-1327已采用].md)
- [20260420_Altus测试集执行SOP_[20260420-1457已采用].md](/Users/watson/codingProj/oneceo/docs/智能体能力测试题库/20260420_Altus测试集执行SOP_[20260420-1457已采用].md)
- [题库种子/README.md](/Users/watson/codingProj/oneceo/docs/智能体能力测试题库/题库种子/README.md)
- [模板/README.md](/Users/watson/codingProj/oneceo/docs/智能体能力测试题库/模板/README.md)
- [结果归档/README.md](/Users/watson/codingProj/oneceo/docs/智能体能力测试题库/结果归档/README.md)

## 适用范围

- 智能体能力测试题
- 按能力域拆分的题组
- 评分 rubric
- 回归测试记录

## 建议组织方式

- 按能力主题拆分文档，例如：
  - 意图识别
  - 澄清追问
  - 工具选择
  - 执行闭环
  - 修复重试
  - 误调用拦截
  - 多轮连续性
- 正式测试设计文档继续放在 `docs/单元测试文档/`，这里更偏向题库与评测素材沉淀。

## 每份题库文档建议包含

1. 测试目标
2. 题目编号
3. 用户输入
4. 预期行为
5. 禁止行为
6. 验证证据
7. 评分方式

## 命名建议

- 题库/方案文档：`yyyymmdd_主题_[尚未采用].md`
- 已采用后：`yyyymmdd_主题_[yyyymmdd-hhmm已采用].md`
- 回归记录可直接按日期与主题命名，确保能从文件名看出测试范围。
