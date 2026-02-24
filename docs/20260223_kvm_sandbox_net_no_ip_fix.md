# KVM sandbox-net 无 IP 导致 DHCP 失败的修复记录

日期：2026-02-23

## 背景
编排侧通过 KVM relay 获取 sandbox VM 的 IP 时失败（"VM has no available IPv4 address"），OSAC 连接获取超时，导致 OpenCode HTTP 隧道无法验证。

## 现象与定位
- libvirt `dnsmasq` 日志提示：`DHCP packet received on virbr-sbx which has no address`
- `virsh net-dhcp-leases sandbox-net` 无任何租约
- `ip addr show dev virbr-sbx` 无 IPv4
- `virsh net-dumpxml sandbox-net` 显示网桥配置存在 `172.28.0.1/24`

结论：`virbr-sbx` 网桥 IPv4 地址丢失，导致 DHCP 无法绑定接口。

## 修复（非破坏性）
在 KVM host 上执行：

```bash
ip addr add 172.28.0.1/24 dev virbr-sbx
ip link set virbr-sbx up
```

为触发 guest 重新发起 DHCP 请求，临时切换 VM 的网卡链路：

```bash
virsh domif-setlink test_session_manual_use vnet161 down
sleep 2
virsh domif-setlink test_session_manual_use vnet161 up
```

## 验证
- `ip addr show dev virbr-sbx` 已出现 `172.28.0.1/24`
- `virsh net-dhcp-leases sandbox-net` 出现 `172.28.0.171/24` 的租约

## 备注
该修复保证当前会话可获取 IP。若重启后再次丢失，可考虑：
- `virsh net-destroy sandbox-net` 后 `virsh net-start sandbox-net`（会短暂影响网络）
- 增加 systemd 保障脚本在 libvirt 启动后补齐 `virbr-sbx` IP

