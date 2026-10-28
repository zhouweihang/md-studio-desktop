/**
 * electron-builder 配置。
 *
 * 为什么不放在 package.json 的 `build` 字段：签名方式要随环境变化——CI 上配置了证书就签、
 * 本地或没有密钥的克隆就跳过。JSON 写不出这种分支，而 `azureSignOptions` 一旦存在就必须
 * 真的能连上 Azure Trusted Signing，否则构建直接失败。
 *
 * 密钥与证书全部通过环境变量进入，本文件只决定“用哪种方式”：
 *   Windows  Azure Trusted Signing（AZURE_SIGNING_* 四个值齐全）
 *            或 WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD（.pfx，electron-builder 自动识别）
 *   macOS    CSC_LINK + CSC_KEY_PASSWORD（Developer ID .p12）
 *            + APPLE_API_KEY[_ID] + APPLE_API_ISSUER（公证，缺了只签名不公证）
 */

/**
 * @param {NodeJS.ProcessEnv} source
 * @returns {null | { endpoint: string, codeSigningAccountName: string, certificateProfileName: string, publisherName: string, fileDigest: string, timestampDigest: string }}
 */
function azureSigningOptions(source) {
  const endpoint = source.AZURE_SIGNING_ENDPOINT;
  const codeSigningAccountName = source.AZURE_SIGNING_ACCOUNT;
  const certificateProfileName = source.AZURE_SIGNING_PROFILE;
  const publisherName = source.AZURE_SIGNING_PUBLISHER;
  if (!endpoint || !codeSigningAccountName || !certificateProfileName || !publisherName) {
    return null;
  }
  return {
    endpoint,
    codeSigningAccountName,
    certificateProfileName,
    publisherName,
    fileDigest: 'SHA256',
    timestampDigest: 'SHA256'
  };
}

const azureSigning = azureSigningOptions(process.env);

module.exports = {
  appId: 'com.zhouweihang.mdstudiodesktop',
  productName: 'MD-Studio Desktop',
  copyright: 'Copyright © 2026 zhouweihang',
  artifactName: '${name}-${version}-${os}-${arch}.${ext}',
  directories: {
    output: 'release'
  },
  files: ['out/**/*', 'package.json'],
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    // 只在四个值齐全时挂上 Azure，否则沿用 electron-builder 的默认证书发现（没有就不签）
    ...(azureSigning ? { azureSignOptions: azureSigning } : {})
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true
  },
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64']
      },
      {
        target: 'zip',
        arch: ['x64', 'arm64']
      }
    ],
    category: 'public.app-category.productivity',
    // 公证的前提是硬化运行时 + 正确的 entitlements；没有公证密钥时 electron-builder 只告警跳过
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    notarize: true
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Office',
    maintainer: 'zhouweihang <3601486135@qq.com>'
  }
};
