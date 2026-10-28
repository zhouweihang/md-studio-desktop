import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 打包配置里的签名分支：有证书才签，没证书必须还能构建。
 *
 * 这里真的起一个 node 进程读配置，而不是 import：electron-builder 读的就是这个文件导出的对象，
 * 这样才能覆盖“读取时按环境决定”的行为。
 */

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 这些变量会改变签名分支，测试前统一清掉，避免受开发机环境影响。 */
const SIGNING_VARS = [
  'AZURE_SIGNING_ENDPOINT',
  'AZURE_SIGNING_ACCOUNT',
  'AZURE_SIGNING_PROFILE',
  'AZURE_SIGNING_PUBLISHER',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'WIN_CSC_LINK',
  'CSC_LINK'
];

function loadConfig(extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SIGNING_VARS.includes(key)) env[key] = value;
  }
  Object.assign(env, extra);
  const output = execFileSync(
    process.execPath,
    ['-e', "process.stdout.write(JSON.stringify(require('./electron-builder.cjs')))"],
    { cwd: projectDir, env, encoding: 'utf8' }
  );
  return JSON.parse(output) as Record<string, any>;
}

const AZURE_ALL = {
  AZURE_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net',
  AZURE_SIGNING_ACCOUNT: 'mdstudio-signing',
  AZURE_SIGNING_PROFILE: 'mdstudio-desktop',
  AZURE_SIGNING_PUBLISHER: 'CN=zhouweihang, O=zhouweihang, C=CN'
};

describe('electron-builder 签名配置', () => {
  it('没有证书时不挂 Azure，打包不会被签名卡住', () => {
    const config = loadConfig();
    expect(config.win.azureSignOptions).toBeUndefined();
    expect(config.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
  });

  it('Azure 四件套齐全时注入 azureSignOptions', () => {
    const config = loadConfig(AZURE_ALL);
    expect(config.win.azureSignOptions).toEqual({
      endpoint: AZURE_ALL.AZURE_SIGNING_ENDPOINT,
      codeSigningAccountName: AZURE_ALL.AZURE_SIGNING_ACCOUNT,
      certificateProfileName: AZURE_ALL.AZURE_SIGNING_PROFILE,
      publisherName: AZURE_ALL.AZURE_SIGNING_PUBLISHER,
      fileDigest: 'SHA256',
      timestampDigest: 'SHA256'
    });
  });

  it('Azure 只配一半时按未配置处理（半套密钥不该让整条构建失败）', () => {
    const { AZURE_SIGNING_PROFILE: _ignored, ...partial } = AZURE_ALL;
    const config = loadConfig(partial);
    expect(config.win.azureSignOptions).toBeUndefined();
  });

  it('只有 .pfx 时交给 electron-builder 的默认证书发现', () => {
    const config = loadConfig({ WIN_CSC_LINK: 'base64-cnVsbA==', WIN_CSC_KEY_PASSWORD: 'secret' });
    expect(config.win.azureSignOptions).toBeUndefined();
  });

  it('macOS 始终要求硬化运行时并尝试公证（无密钥时 electron-builder 自行跳过）', () => {
    const config = loadConfig();
    expect(config.mac.hardenedRuntime).toBe(true);
    expect(config.mac.notarize).toBe(true);
    expect(config.mac.entitlements).toBe('build/entitlements.mac.plist');
    expect(config.mac.entitlementsInherit).toBe('build/entitlements.mac.inherit.plist');
    expect(config.mac.target.map((item: { target: string }) => item.target)).toEqual(['dmg', 'zip']);
  });
});
