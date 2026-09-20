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

内置的“IP 画像”使用独立实现、有超时边界的并发诊断流程。服务可用性检测范围参考了采用 MIT 许可证的 `MaYIHEI/paperclip` Loon IP 质量模块；上游源码和许可证见 <https://github.com/MaYIHEI/paperclip>。

可选的外部面板节点地区识别会先通过 Cloudflare DNS-over-HTTPS 解析连接域名，再把得到的公网 IP 发送到托管的 [country.is](https://country.is/) API。不会向 country.is 发送 Provider Token 或分享 URI。country.is 以 MIT License 开源。
