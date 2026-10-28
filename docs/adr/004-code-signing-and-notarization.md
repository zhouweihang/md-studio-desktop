# ADR-004: 发布包代码签名与 macOS 公证

> Status: Accepted | Date: 2026-10-28 | Deciders: 项目所有者（zhouweihang） | 关联 RFC-001 §6（交付与验证）、ADR-003（发布仓库） | 影响：决定发布包如何签名、密钥放哪、CI 如何判定“签成功”、以及哪些警告其实消不掉

## Context

发布仓库的三端安装包目前是**未签名**的（工作流显式设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`）。后果：

- **macOS**：Gatekeeper 直接拦截，用户必须“右键 → 打开”或在系统设置里放行；`spctl` 判定为未公证。
- **Windows**：SmartScreen 显示“未知发布者”，需要用户点“仍要运行”。
- 两个警告都会折损首次安装转化率，也是本项目对外发布前必须处理的一项。

约束与事实（2026-10 核实）：

1. **证书不能进仓库**。CI 里只能通过 GitHub Secrets 注入；本地没有密钥时必须还能构建（否则 fork 与贡献者无法验证打包）。
2. **macOS 公证需要 Apple Developer Program 年费会员**，并用 `notarytool` 上传；`notarytool` 支持 Apple ID + App 专用密码、API Key（.p8）、或钥匙串 profile 三种凭据。
3. **Windows 从 2023-06 起，OV/EV 证书的私钥必须存放在硬件模块**，CI 无法直接持有 `.pfx`。现实路线只有两类：CA 的云签名服务（DigiCert KeyLocker、SSL.com eSigner 等），或 **Azure Trusted Signing**（微软托管，按 $9.99/月起，electron-builder 26 原生支持 `win.azureSignOptions`）。
4. **SmartScreen 是信誉机制，不是开关**。签名能去掉“未知发布者”，但信誉随下载量累积；electron-builder 文档明确说明 OV/EV 在 SmartScreen 上已同等对待，EV 不再立即获得信誉。**不能承诺“签名后立刻零警告”**——只能承诺签名有效、证书链可验证，并把剩余风险写清楚。
5. Gatekeeper 则是确定性判定：Developer ID 签名 + 公证 + 票据 stapled 之后，首次打开不再弹“无法验证开发者”。

## Decision

1. **macOS 走完整的 Developer ID + 公证**：`hardenedRuntime: true`，使用 `build/entitlements.mac.plist` 与 `build/entitlements.mac.inherit.plist`（`allow-jit` / `allow-unsigned-executable-memory` / `disable-library-validation`，Electron 在硬化运行时下缺了会崩溃），`notarize: true`，凭据优先用 **API Key**（`APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`），因为 Apple ID 方式需要 App 专用密码、更容易因二次验证失效。
2. **Windows 优先 Azure Trusted Signing**，通过 `win.azureSignOptions`（endpoint / account / certificate profile / publisher）签名；同时保留 `.pfx` 作为退路（`WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`，由 electron-builder 默认证书发现接管）。两条路互斥，Azure 配置齐全时优先。
3. **签名配置从 `package.json` 移到 `md-studio/electron-builder.cjs`**：`azureSignOptions` 一旦存在，electron-builder 就必然调用 Azure，没有密钥的构建会失败——所以必须按环境决定是否注入。`.cjs` 里只做“有没有配置”的判断，不写任何密钥。
4. **缺密钥时降级为未签名构建，并显式告知**：工作流把签名方式写进 Job Summary；macOS 无证书时继续设 `CSC_IDENTITY_AUTO_DISCOVERY=false`，避免在钥匙串里空找。未签名产物仍然上传，供没有证书的克隆使用。
5. **CI 必须验证“签名真的生效”**：配置了签名材料时，
   - Windows 用 `Get-AuthenticodeSignature` 校验安装包与 `win-unpacked` 下的主程序，`Status` 必须是 `Valid`；
   - macOS 用 `codesign --verify --deep --strict` + 证书 `Authority=Developer ID Application` 校验，并额外用 `xcrun stapler validate` 与 `spctl --assess` 确认公证票据已 stapled、Gatekeeper 放行。
   验证失败即构建失败——避免“看起来打了签名参数、实际产出未签名”的静默事故。
6. **密钥只存在于 GitHub Secrets / Variables**：

   | 名称 | 类型 | 用途 |
   |---|---|---|
   | `MAC_CSC_LINK` | secret | Developer ID Application `.p12` 的 base64（单行，`base64 -w0` 产出） |
   | `MAC_CSC_KEY_PASSWORD` | secret | 上述 `.p12` 的导出密码 |
   | `APPLE_API_KEY_P8` | secret | App Store Connect API Key `.p8` 全文 |
   | `APPLE_API_KEY_ID` | secret | API Key ID |
   | `APPLE_API_ISSUER` | secret | Issuer ID（UUID） |
   | `AZURE_SIGNING_ENDPOINT` | variable | 例 `https://eus.codesigning.azure.net` |
   | `AZURE_SIGNING_ACCOUNT` | variable | Trusted Signing 账户名 |
   | `AZURE_SIGNING_PROFILE` | variable | 证书配置（Certificate Profile）名 |
   | `AZURE_SIGNING_PUBLISHER` | variable | 证书 subject 的 DN，必须与证书一致 |
   | `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | secret | Entra 应用凭据，供 `Invoke-TrustedSigning` 的 EnvironmentCredential 使用 |
   | `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD` | secret | 可选退路：`.pfx` 证书 |

7. **发布纪律**：打 `v*` tag 前确认上表已配齐；`workflow_dispatch` 可随时跑未签名的验证构建。签名只在发布仓库的 CI 里发生，主仓库不保存任何证书。

## Consequences

- 产物分三档：签名 + 公证（macOS 完整路径）、仅签名（Windows Azure/pfx、或 macOS 只配了证书）、未签名（无密钥）。Job Summary 会写明当次属于哪一档。
- macOS 首次启动不再出现“无法打开，因为无法验证开发者”；Windows 去掉“未知发布者”，但 SmartScreen 的信誉提示是否消失取决于下载量累积，需要在发布说明里如实告知用户。
- 密钥轮换（证书续期、Azure 客户端密码过期）只需改 Secrets，不动代码；`publisherName` 变更时同步改 `AZURE_SIGNING_PUBLISHER`。
- 公证会给 macOS 发布增加几分钟（Apple 侧排队），`dist:mac` 仍然是单 job，超时上限 360 分钟足够。
- 未配置 `APPLE_API_KEY_P8` 时 electron-builder 只告警跳过公证（`skipped macOS notarization`），不会中断构建——这是刻意的降级，不是遗漏。

## Alternatives considered

- **只配 `.pfx`（signtool）**：2023 年之后的证书私钥在硬件里，CI 拿不到可用的 `.pfx`；能拿到的多来自云签名服务，而那些服务需要自己的签名客户端，不是一条 `CSC_LINK` 能覆盖的。保留为退路而非主路径。
- **Apple ID + App 专用密码**：可行，但凭据长期有效且绑定个人账号，二次验证/改密后 CI 静默失效；API Key 可单独吊销、权限更窄。
- **自托管 runner 挂 USB 硬件令牌**：能同时解决 Windows/macOS，但要维护一台常在线、可信任的机器，成本远高于 Azure Trusted Signing 的月费。
- **不签名，靠文档教用户绕过**：macOS 上需要用户逐版本手动放行，Windows 上等于没有发布者身份；与本项目“本地优先、可放心安装”的定位冲突。
- **签名后声称“警告已全部消除”**：与 Microsoft 的信誉机制不符，属于误导性文案；ADR 明确只承诺签名有效与 macOS 确定性放行。
