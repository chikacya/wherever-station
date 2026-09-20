# 第三方声明

[English](THIRD_PARTY_NOTICES.md)

Wherever Station 本身使用 GPL-3.0-only。以下项目是在插件中分发或用于构建插件、且采用独立许可证的第三方组件。

管理界面由下列未修改的 npm 包构建。运行代码由 Vite 打包进 `pages/assets`，其版权与许可证仍归各自作者所有。

| 包 | 用途 | 许可证 |
| --- | --- | --- |
| React / React DOM | 组件渲染 | MIT |
| TanStack Table | 节点表格模型 | MIT |
| dnd-kit | 可访问的拖放交互 | MIT |
| Lucide React | SVG 界面图标 | ISC |
| qrcode.react | 本地生成订阅二维码 | ISC |
| Vite / React plugin | 构建工具，不作为运行服务发布 | MIT |
| Vitest | 测试工具 | MIT |
| js-yaml | 安全解析 Clash/Mihomo 订阅 YAML | MIT |
| argparse | js-yaml 运行依赖 | Python-2.0 |

发布包会随 npm 依赖保留对应的版权和许可证文本。本声明不重新分发外部服务、面板、代理内核或客户端应用。

可选的“IP 画像”操作会在所选服务器上下载并运行经过 SHA256 固定校验的 `dy0422/ipcheck-plus`，该脚本不打包进插件。此项目使用 MIT 许可证，源代码和许可证见 <https://github.com/dy0422/ipcheck-plus>。

可选的外部面板节点地区识别会先通过 Cloudflare DNS-over-HTTPS 解析连接域名，再把得到的公网 IP 发送到托管的 [country.is](https://country.is/) API。不会向 country.is 发送 Provider Token 或分享 URI。country.is 以 MIT License 开源。
