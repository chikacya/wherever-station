# 部署指南

[English](DEPLOYMENT.md)

本文从一台已经能通过 HTTPS 访问的 Komari 主控机开始。示例域名和 Token 都需要替换为自己的值。

## 1. 准备条件

- Komari `1.4.3` 或更新版本。
- Komari 插件管理权限。
- 浏览器、订阅客户端和 Agent 都能访问的稳定 HTTPS 域名。
- 需要监控或远程操作的服务器已经安装 Komari Agent。
- 托管部署需要 Linux、systemd 和 Python 3；证书操作需要 OpenSSL。

Komari 主控机不需要同时承载代理。URI 导入、外部订阅、Provider 同步和订阅输出不依赖 Agent。

## 2. 准备 Komari

按照 [Komari 官方安装文档](https://komari-document.pages.dev/install/quick-start)完成部署。先配置有效的 HTTPS 反向代理并确认管理后台可访问，再安装插件。

不要把只准备监听 `127.0.0.1` 的 Komari 端口直接暴露到公网。认证、HTTPS、备份和网络访问控制都应先在 Komari 层完成。

### 地址从哪里来

Wherever Station 不注册域名，也不另起一个 Web 服务。用户先为 Komari 准备一个可访问的 Origin，例如 `https://monitor.example.com`：通常做法是让域名的 A/AAAA 记录指向主控 VPS，再由 Caddy、Nginx 等反向代理把 HTTPS 请求转发到 Komari 的本机监听端口。仅在内网测试时也可以使用 `http://IP:端口`，但跨网络访问和订阅分发建议使用稳定的 HTTPS 域名。

插件安装后复用这个 Origin，不需要再申请一套地址：

| 用途 | 地址 | 访问范围 |
| --- | --- | --- |
| Komari 中的插件页 | `https://monitor.example.com/admin/plugin-page?short=proxy-console&file=pages%2Fadmin.html` | 需要管理员登录 |
| 无 Komari 侧栏的全屏页 | `https://monitor.example.com/api/admin/plugin/proxy-console/pages/admin.html` | 需要管理员登录 |
| 公开订阅 | `https://monitor.example.com/proxy/sub/<token>` | 持有订阅 Token 的客户端 |

侧栏入口由 Komari 根据插件清单生成；全屏入口由插件界面的“全屏打开”按钮生成；订阅 Token 和完整订阅地址由 Wherever Station 在创建订阅后生成。路径中的 `proxy-console` 是为原地升级保留的内部兼容标识，不是另一个产品或服务。

## 3. 安装 Wherever Station

在 Komari 的 **插件管理 → 插件市场 → 安装源** 中添加：

`https://raw.githubusercontent.com/chikacya/wherever-station/main/v1.json`

保存后刷新插件市场，选择 Wherever Station 安装并审核权限。以后发布新版本时，仍从同一安装源手动更新；安装源只负责展示和下载已发布的版本。

交互式向导会下载最新 Release、校验 SHA256、登录 Komari 并完成上传与启用：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chikacya/wherever-station/main/install.sh)
```

不希望执行网络脚本时，使用下面的手动流程。也可以先下载脚本并检查内容，详见[快速开始](QUICKSTART.zh-CN.md)。

1. 从项目 GitHub Releases 下载 `wherever-station-<version>.zip`。
2. 在 Komari 插件管理中上传 ZIP。
3. 检查清单并批准所需权限。
4. 启用插件，确认状态为运行中。
5. 从 Komari 侧栏打开 **Wherever Station**。

插件申请以下权限：

| 权限 | 用途 |
| --- | --- |
| `node` | 在 Komari 插件运行时中使用文件、加密、URL 和 HTTP 等 Node 兼容模块 |
| `allowRoutes` | 提供公开订阅路由和管理页面 |
| `allowSystemRPC` | 读取 Komari 客户端与指标、提交/读取远程任务，以及同步服务器流量计划 |

这些权限使插件能够在 Komari 内执行管理员级操作。只安装可信来源的发布包，升级时应重新检查权限变化。

## 4. 接入 Agent

可以使用 Wherever Station 的 **服务器 → 接入新 VPS**，也可以在 Komari 客户端管理中手动创建。使用自动发现时，把 Komari 发现密钥粘贴到向导，在目标服务器执行页面生成的官方 Agent 命令。密钥只在浏览器中参与生成命令，不写入 Wherever Station 状态。

手动创建客户端后的最小命令为：

```bash
./komari-agent \
  --endpoint "https://monitor.example.com" \
  --token "YOUR_AGENT_TOKEN" \
  --month-rotate 1
```

每个 Agent 使用独立的 Komari Token。长期运行时应把 Token 放入仅 root 可读的环境文件，并使用独立 systemd 服务。最新二进制和参数以 [Komari Agent 项目](https://github.com/komari-monitor/komari-agent)为准。

“最新 Agent”不等于“与当前主控兼容”。升级前应同时检查 Komari 主控和 Agent 的 Release notes；不能同时升级时，先保持已验证组合并关闭 Agent 自动更新。Wherever Station 会隔离单台 Agent 的状态查询失败，但无法修复两端通信协议不兼容。

`--month-rotate` 可设置为 1–31。使用月度流量时，应与 Wherever Station 中这台服务器的重置日一致。修改该参数只需重启 Agent，不需要重启 sing-box 或 Nowhere。

Agent 出现在 Komari 后，回到 Wherever Station 补充展示名、服务商、国家代码、地区和标签。Komari Agent 与 Wherever Station 服务器资料是两层对象；删除其中一项不会卸载另一项代表的软件。

## 5. 公开订阅地址

打开 **设置**，填写订阅客户端能够访问的根地址：

```text
https://monitor.example.com
```

订阅链接使用插件公开路由，不使用管理 iframe 地址。留空时沿用当前 Komari Origin。更换 Komari 域名或公网 IP 后，需要同步更新该地址，否则旧链接可能失效。

如果 Komari 管理页和订阅客户端使用同一个公网域名，通常应保持留空；只有经 CDN、独立订阅域名或不同反向代理入口提供订阅时才需要填写。这里填写的是已经存在的根地址，不会代为购买域名、修改 DNS 或申请证书。

## 6. 已有服务与托管部署

**发现节点**只读检查 systemd、进程参数和可读配置证据，不会启动、停止、重启或改写已有代理服务。证据完整的候选可以导入；参数不足的候选会成为待修复草稿，直到用户提供有效客户端 URI。

托管实例使用隔离目录和独立服务名：

```text
/var/lib/proxy-console/instances/<instance-id>/
proxy-console-singbox@<instance-id>.service
proxy-console-nowhere@<instance-id>.service
```

创建后默认停止，必须由用户明确启动。插件不会修改云安全组或主机防火墙。

## 7. 数据与备份

Komari 的数据目录由它的启动参数决定。Wherever Station 状态位于：

```text
<komari-data>/plugin-data/proxy-console/
```

应同时备份 Komari 数据库和该插件目录。如果在 Agent 上生成过证书或托管实例，还应备份：

```text
/var/lib/proxy-console/certificates/
/var/lib/proxy-console/instances/
```

Provider Token 和订阅源 URL 都属于凭据，应以同等级别保护备份。不要把状态文件、Token、私钥或订阅地址提交到 Git。

## 8. 升级与回退

1. 备份 Komari 和插件数据。
2. 在 Komari 插件管理中上传新 ZIP。
3. 检查权限变化并启用新版本。
4. 确认插件状态、服务器指标、订阅和托管实例卡片正常。

升级插件不会自动升级托管 sing-box 或 Nowhere 内核；内核升级需要单独触发并通过各自的兼容性检查。

如果插件无法启动，重新安装上一版 ZIP；若数据 schema 发生变化，还要恢复与上一版匹配的插件数据。不要通过删除 `/var/lib/proxy-console/instances/` 来回退。

## 9. 首次使用检查

- Komari 已通过有效 HTTPS 访问。
- 插件已启用并处于运行中。
- 导入节点或外部 Provider 内容可见。
- 已接入的 Agent 能上报当前指标。
- 公开订阅根地址能从目标客户端网络解析和访问。
- 订阅预检显示了预期格式和被跳过协议。
- 使用托管实例时，开放端口后通过真实连接检查。
