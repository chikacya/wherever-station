# Nowhere 代际适配口径

日期：2026-10-13。来源：用户本次决定，以及官方 v3.0.0 Release 与协议文档。

## 已确定的产品范围

- 不再投入 NW1 适配。
- NW2 按冻结的存量系列维护，以 Nowhere 2.2.1 为唯一配置和能力基线。不再扩展 2.0.x、2.1.x、2.2.0 的独立兼容分支或回归矩阵。
- NW2 保留 32–64 字符小写 hex 密钥、现有 Morph、Mux、原生 next 与遥测契约。
- NW3 使用独立适配器和配置契约，不通过 NW2 的版本范围自动开放。
- 软件 Release 版本用于下载、校验和与实例身份；协议代际用于配置、客户端和遥测兼容判断。保留实际版本信息，不把旧实例伪装为 2.2.1。

已在 0.74.1 测试包实现 NW2 基线、NW3 Portal / Egress 配置和生命周期、Vector 链接与被动遥测。旧配置不自动重写，存量服务不自动升级。

## NW3 已核实的适配变化

| 范围 | v3.0.0 契约及实现要求 |
| --- | --- |
| 连接 | 固定 ALPN `nw3`，与 NW2 不兼容，没有协商或回退。迁移须核对整条流量路径和第三方客户端。 |
| 密钥 | Portal、Vector、Egress 均要求恰好 32 字符小写 hex。NW2 的合法长密钥不能直接带入 NW3。 |
| Morph | 默认开启，采用 NW3 专属派生；不能复用 NW2 的兼容判断。 |
| 配置 | endpoint path 选择 carrier；Vector 使用 `in=`，Portal 使用 `out=`；移除 split `up/down`、TLS Mux 和原生 `next`。 |
| 角色 | 新增 Egress，通过主动 QUIC 连接提供远程出口；Portal 可选 direct、SOCKS5 或 Egress。Egress 中断时不回退到 direct。 |
| 遥测 | 身份和六项逻辑统计：TCP/UDP 上传字节、下载字节、活跃 Flow。旧订阅、生命周期事件和资源采样不能沿用。 |
| 证书 | 系统 CA 与名称校验或准确的 SHA256 pin；Morph 不替代证书校验。 |

实现顺序：收敛 NW2 基线；增加 NW3 独立配置与能力适配；更新生命周期、分享 URI 和客户端筛选；增加 NW3 遥测；以真实二进制验证安装、连接、迁移失败与回退后再开放写操作。预留位按官方契约处理，不据此推断所有未来软件版本已兼容。

## 官方依据

- [Nowhere v3.0.0 Release](https://github.com/NodePassProject/Nowhere/releases/tag/v3.0.0)
- [v3.0.0 interoperability](https://github.com/NodePassProject/Nowhere/blob/v3.0.0/docs/interoperability.md)
- [v3.0.0 configuration](https://github.com/NodePassProject/Nowhere/blob/v3.0.0/docs/configuration.md)
- [v3.0.0 telemetry](https://github.com/NodePassProject/Nowhere/blob/v3.0.0/docs/telemetry.md)

2026-10-13 补充：0.74.3 增加 NW2 → NW3 显式升级迁移入口，读取实际配置、预览转换、核对客户端、失败回退后再更新订阅。继续保留 NW2 管理入口，后续 NW3 发布新版或存量全部迁移后另行决定清理。批量更新仍按同代际执行。
