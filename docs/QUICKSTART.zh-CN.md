# Ciallo～傻瓜也能装的快速开始

[English](QUICKSTART.md)

欢迎来到 Wherever Station。别被“节点、订阅、Agent、Provider”这些词吓到：第一次使用只需要完成一条最适合你的路线，不用把所有功能都配置一遍。

## 先选你的起点

- 手里已经有 `vless://`、`hysteria2://`、`tuic://`、`ss://` 等链接：安装后直接选择**导入节点**。
- 已经在使用 S-UI 或 2S-UI：选择**连接外部面板**，读取面板提供的客户端分享链接。
- 希望同时看 VPS 状态或部署托管节点：先在 Komari 接入 Agent，再回到 Wherever Station 选择**接入 VPS**。

只想整理节点和生成订阅时，不需要 Agent。

## 从 Komari 插件市场安装

在 Komari 的 **插件管理 → 插件市场 → 安装源** 添加：

`https://raw.githubusercontent.com/chikacya/wherever-station/main/v1.json`

刷新市场，安装 Wherever Station，审核权限并启用。以后有新版本时，同一安装源会显示新发布包，由你决定何时更新。

## 一键引导安装

准备好一个已经能通过 HTTPS 打开的 Komari，然后在自己的电脑终端运行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chikacya/wherever-station/main/install.sh)
```

脚本会：

1. 获取最新 GitHub Release；
2. 下载插件 ZIP 和 `SHA256SUMS`；
3. 校验文件完整性；
4. 询问 Komari 地址和管理员账号；
5. 隐藏输入密码，上传并启用插件。

它会在批准前列出 `node`、`allowRoutes` 和 `allowSystemRPC` 权限。密码只写入权限为 `0700` 的临时目录，安装结束立即清理，不会作为命令行参数传递。

如果不喜欢直接执行网络脚本，可以先下载、查看，再运行：

```bash
curl -fsSLO https://raw.githubusercontent.com/chikacya/wherever-station/main/install.sh
less install.sh
bash install.sh
```

仅下载并校验发布包：

```bash
bash install.sh --download-only
```

安装指定版本：

```bash
bash install.sh --version 0.67.0
```

## 不用脚本也很简单

1. 打开项目的 [Releases](https://github.com/chikacya/wherever-station/releases)。
2. 下载 `wherever-station-<版本>.zip`。
3. 在 Komari 的插件管理中上传 ZIP。
4. 阅读并批准权限，然后启用 **Wherever Station**。
5. 从 Komari 侧栏打开插件。

插件没有单独的域名：它直接使用 Komari 地址。安装完成后可从侧栏进入，也可使用 `https://你的-Komari-域名/api/admin/plugin/proxy-console/pages/admin.html` 全屏打开。订阅地址在新建订阅后自动生成；只有订阅使用不同公网域名时，才需要在“设置 → 公共根地址”中覆盖。

## 第一次导入节点

1. 打开**节点**。
2. 点击**导入节点**。
3. 粘贴一条或多条 URI，也可以粘贴 Base64 订阅或 Clash/Mihomo YAML。
4. 点击解析预览，确认名称和协议。
5. 保存。

接着打开**订阅**，创建订阅、勾选刚才的节点并保存。根据设备选择 Anywhere、Mihomo、Surge、Loon、sing-box 或通用 URI 地址。Ciallo～第一条订阅完成啦！

## 接入 VPS 时要注意

Komari 主控和 Agent 必须使用彼此兼容的版本。不要让 Agent 在主控尚未升级时独自跨版本自动更新；出现“主机指标正常、服务状态暂不可用”时，优先核对两者版本。升级或回退 Komari Agent 不需要重启 sing-box 或 Nowhere。

部署托管节点前仍需确认公网地址、端口和防火墙。Wherever Station 不会擅自修改云安全组，也不会自动接管已有代理配置。

## 卡住了怎么办

- 插件打不开：先看 Komari 插件管理中的运行状态和错误。
- 状态一直不可用：确认 Agent 在线，并检查主控与 Agent 版本兼容性。
- 客户端连不上：进程运行不等于端口已放行，请检查云防火墙和主机防火墙。
- 订阅源失败：确认 Komari 主控能访问该 URL，并检查服务商是否限制来源 IP。

更完整的说明见[部署指南](DEPLOYMENT.zh-CN.md)、[使用指南](USER_GUIDE.zh-CN.md)和[排错指南](TROUBLESHOOTING.zh-CN.md)。
