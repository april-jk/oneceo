# OSAC 连接 mapping_stale 修复记录

日期：2026-02-23

## 背景
编排侧通过 KVM relay 连接 OSAC 时出现 `mapping_stale (active_healthy)`，连接获取超时。

## 现象
- OSAC 日志显示存在长时间存活的 `active` 连接（`mappingId=portmap:sess_...:18080`），新连接被拒绝。
- `osac.lock` 中记录 PID（示例：1045），OSAC 实例实际仍在运行。

## 原因
旧 OSAC 实例未退出，导致 `active` 连接一直健康，OSAC 只允许单连接，导致新连接 `mapping_stale`。

## 修复步骤（非破坏性）
1. 读取 PID：`cat /opt/.altus/opencode/osac.lock`
2. 终止旧进程：`kill <pid>`
3. 删除锁文件：`rm -f /opt/.altus/opencode/osac.lock`
4. 重新启动 OSAC：
   - `OSAC_AUTH_TOKEN=... OSAC_LOG_DIR=/opt/.altus/opencode/log OSAC_LOG_TO_STDOUT=false OSAC_LISTEN_ADDR=:18080 nohup ./osac > /opt/.altus/opencode/log/osac.stdout.log 2>&1 &`

## 验证
- `ss -lntp | grep 18080` 显示 OSAC 监听
- OSAC 日志出现新的连接与 `OPENCODE_HTTP_REQUEST` 处理记录

## 备注
若需并发多客户端连接，需调整 OSAC 的 bridge 逻辑（当前设计仅允许单一活跃连接）。
