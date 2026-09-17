# 协议与输出支持

[English](PROTOCOLS.md)

Wherever Station 将“保存节点”和“为特定客户端转换配置”分开处理。这样既能保存较新或客户端专属协议，也不会误导用户认为所有目标格式都能表达它们。

## 无损 URI 输出

Raw、Base64、Anywhere 和 Loon 输出会保留任何形如 `<scheme>://...` 的内容。未知 scheme 的 URI 不会被语义解析或改写，因此 `sudoku://`、`snell://` 或未来的新协议也可以原样交给支持它的客户端。

“可透传”不代表客户端一定支持。预检会把目录内的原生协议标为 `native`，未列出的协议标为 `unknown`；两种情况都不会修改原 URI。

当前目录记录的客户端原生 URI 包括：

| 客户端 | 已记录的 scheme |
| --- | --- |
| Anywhere | `nowhere`、`vless`、`hysteria2`、`hy2`、`trojan`、`anytls`、`ss`、`socks5`、`socks`、`sudoku`、`http`、`https`、`quic`、`naive` |
| Loon | `ss`、`ssr`、`vmess`、`vless`、`trojan`、`http`、`https`、`socks5`、`socks`、`wireguard`、`hysteria2`、`hy2`、`anytls` |

可执行的能力合同位于 [`tools/protocol-capabilities.js`](../tools/protocol-capabilities.js)。

## 结构化转换

Mihomo YAML、sing-box JSON 和 Surge 配置需要语义转换。只有适配器能够完整表达相关 URI 参数时，Wherever Station 才会输出该节点。不支持的协议或参数组合会被明确计入跳过项，而不是猜测配置。

| 输出格式 | 可转换的 URI scheme |
| --- | --- |
| Mihomo | `vless`、`vmess`、`hysteria2`、`tuic`、`anytls`、`trojan`、`ss`、`socks5`、`socks`、`http`、`https` |
| sing-box | `vless`、`vmess`、`hysteria2`、`tuic`、`anytls`、`trojan`、`ss`、`socks5`、`socks`、`http`、`https` |
| Surge | `vmess`、`hysteria2`、`tuic`、`anytls`、`trojan`、`ss`、`socks5`、`socks`、`http`、`https` |

Clash/Mihomo YAML 导入遵守同一原则：能够无损还原必要参数的条目进入节点库，其余条目返回逐项错误。若服务商提供原始分享 URI，应优先导入 URI。

支持协议不代表支持它的全部参数。共用的[转换合同](../tools/conversion-contract.js)会拒绝未知字段、重复查询参数、冲突别名、不支持的 YAML 嵌套选项，以及目标输出无法保留的证书指纹。被拒绝转换的节点仍可通过 URI 输出。已知 URI 的重命名只修改片段名称（或 VMess 显示名称），不改写连接参数。

sing-box 会拒绝故障转移、负载均衡代理组和隐式中国大陆直连策略，不再改变它们的行为。Surge 接受手动选择和自动测速组，拒绝含有歧义分隔符的值。VMess 转换不会自动关闭证书校验。分发结构化订阅前，请检查订阅预检结果。

CI 与标签发布共用验证流程：运行时、前端及 Python 测试、参数变异测试、三套模拟浏览器验收，以及固定 sing-box 1.13.18 的配置检查。浏览器测试使用临时本地静态服务，不连接托管服务器。内核检查验证配置语法，不代表网络连通性；Surge 和 Loon 没有随仓库提供的可执行验证器。

## 面板与模板边界

S-UI 和 2S-UI 连接会导入面板 API 暴露的客户端分享链接。没有可用客户端链接的入站可能不会出现，也可能成为待修复草稿；仅凭面板运行状态无法安全推断凭据。

内置 sing-box 部署预设只覆盖少量经过测试的常见组合，不是通用 sing-box 配置编辑器。高级入站、路由、证书和新内核功能应在专业 sing-box 面板中配置，再通过分享 URI 或面板连接导入。
