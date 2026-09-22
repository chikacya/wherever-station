# 排错指南

[English](TROUBLESHOOTING.md)

## Komari Agent 在线，但没有服务器资料

Komari Agent 记录需要与 Wherever Station 的服务器资料关联。打开“服务器”，发现尚未关联的 Agent 并补充资料。若列表为空，确认 Agent 已向同一个 Komari 实例上报，然后重新加载插件。

## Agent 离线

在目标 VPS 查看 Agent 服务和最近日志：

```bash
sudo systemctl status komari-agent.service --no-pager
sudo journalctl -u komari-agent.service -n 100 --no-pager
```

常见原因包括 Endpoint 不可达、Token 已轮换、主控证书无效或系统时间错误。更新 Agent 连接不需要重启代理服务。

## 主机指标与服务状态刷新不同步

Komari 持续上报主机指标；Wherever Station 在相关页面活跃时按宿主批量查询代理服务。服务状态因此可能比 CPU 和网络指标晚一个短查询周期。某台宿主响应较慢时，页面会保留其最近采样并标记过期，不会阻塞整个服务器列表。

若主机指标正常但服务状态显示“暂不可用”，请同时核对 Komari 主控和 Agent 的版本兼容性。不要让 Agent 自动升级到主控尚不支持的通信协议；先升级主控，或将 Agent 固定到与当前主控兼容的版本。Wherever Station 会隔离单台宿主的查询失败并结束加载状态，但无法修复主控与 Agent 之间的协议不兼容。

## 外部订阅源同步失败

确认地址是完整的 `http://` 或 `https://` URL、Komari 主控可以访问、响应不超过 1 MiB，并且内容为分享 URI、Base64 列表或受支持的 Clash/Mihomo YAML。部分服务商会限制来源 IP、地区或 User-Agent。同步失败时会保留上一次成功的节点集合。

只有响应提供有效 `Subscription-Userinfo` 时才会显示套餐流量。缺少额度信息不代表节点解析失败。

## 公开订阅不可用，但节点仍在运行

所有输出节点（含代理组）属于同一台已绑定 Agent 的 VPS 时，可开启整机流量展示，默认关闭。流量包含该 VPS 的其他节点与服务，不是本订阅独占。跨 VPS 或归属不明时暂停展示；统计失败和超额都不会阻止下载。只有到期或手动停用会关闭订阅链接。

## 发现结果无法直接变成节点

Wherever Station 不会猜测凭据、公网地址、SNI、Reality 密钥或客户端链接。信息不完整的结果会成为待修复草稿。使用原面板的完整分享 URI 或已核实配置补齐后才能进入节点库；修复前不会出现在任何订阅中。

## S-UI 或 2S-UI 无法连接或导入节点

基础地址必须包含协议、端口和实际路径前缀。在面板中创建 API Token，并选择对应的面板类型；Wherever Station 不使用面板登录密码。

2S-UI 通常通过客户端暴露可导入分享链接。未绑定客户端的入站即使在面板中可见，也可能没有可导入内容。添加或绑定客户端后重新同步。若希望远端客户端删除节点时本地也删除，需要启用同步清理；否则本地节点会按设计保留。

API 正常但客户端无法连接时，应检查容器端口映射、云防火墙和主机防火墙，并用真实客户端请求验证，不能只看进程或 API 状态。

## 托管实例创建失败

先查看预检结果和实例最近错误。常见原因是端口冲突、内核缺失、版本不受支持或证书路径不可读。托管服务使用实例专属 unit：

```bash
sudo journalctl -u 'proxy-console-singbox@INSTANCE_ID.service' -n 100 --no-pager
sudo journalctl -u 'proxy-console-nowhere@INSTANCE_ID.service' -n 100 --no-pager
```

不要用系统级 `sing-box.service` 或 `nowhere.service` 代替；未托管 unit 不在实例边界内。

## Android Anywhere 拒绝二维码

使用设备区域提供的 Android Anywhere 或通用 HTTPS 二维码。不同平台对自定义 URL scheme 和 Unicode fragment 的处理不同。名称显示百分号编码时，先更新 Anywhere，再确认源 URI 的 fragment 没有被重复编码。

## 升级后页面仍是旧版

确认 Komari 已安装并运行新版本，停用 short name 相同的重复插件，然后硬刷新浏览器。若反向代理缓存了插件 API 路径，还需要清理或绕过该缓存。
