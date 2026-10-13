# Wherever Station 工作约定

## 正式发布

用户已要求：每次向 public 仓库正式发布后，同步升级其已授权 Komari 实例上的插件版本，不能仅上传 GitHub 安装包。

发布完成条件：public CI 和 Release 成功，正式 ZIP 的 SHA256 与发布校验文件、插件源目录一致；使用正式发布包通过 `tools/deploy-plugin.cjs` 安装到已授权 Komari，核对实际插件版本等于发布版本且 enabled/running 正常，并检查原有实例、节点链接与订阅保留。凭据和私有部署配置留在仓库外，不提交到 public。

发布插件不代表授权批量升级或迁移用户 VPS 上的 Nowhere 内核。核验部署时只执行必要的只读查询。

## Nowhere 范围

NW2 按 2.2.1 存量基线维护，NW3 独立适配。保留 NW2 管理及显式 NW2 → NW3 升级迁移入口。后续 NW3 发布新版或存量全部迁移后，再按用户决定清理 NW2 入口，不提前自动删除。批量更新目前仅执行同代际更新。
