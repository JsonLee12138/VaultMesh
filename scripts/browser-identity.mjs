import { createHash } from "node:crypto";

// Repository-pinned public key for unpacked development and Review sideload
// ZIPs. It is public identity material, not a store signing credential.
export const developmentExtensionKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiNA5YkMlr1IgyW/d+n1bPkQsBegHPWb1P77n2BkyexUoFxJIs/PmPfKhvlBye3F1jXIwbczScuSVL7dryYSESpOHY3Zk9X5o19XsGaUFkAxiSbEDdc+15tgDuc8W22lxPyEI3z0kIb8jxWVHZPCmAFIE4X/snDhxOgUZ/SkdZFJ6R/YKT4IjBCrxMjEaYLCxzpzbrFIwf5IOkSyzzlb3+uEshXASuBXKj5/jdKrJaEP1Nzzw9XpAdvA5gvCRKqV/9tzJ+G74GtoSyp5feoY5h5d5Xqj4Jj7TudgbcIKMTGcMJslnBh7Dhwymn1Amwm7HYxps6/acIP6Mvd7A9A5EcQIDAQAB";

const alphabet = "abcdefghijklmnop";

export function extensionIdFromKey(key) {
  return [...createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16)]
    .map((byte) => `${alphabet[byte >> 4]}${alphabet[byte & 0x0f]}`)
    .join("");
}

export const developmentExtensionId = extensionIdFromKey(developmentExtensionKey);
export const firefoxExtensionId = "vaultmesh@atlantis-mk.github.io";
export const sideloadReviewDistribution = "sideload-review";

export function validFirefoxExtensionId(value) {
  return typeof value === "string"
    && value === firefoxExtensionId;
}

export function browserIdentityEnvironment(baseEnvironment = process.env, { requireRelease = false } = {}) {
  const explicitKey = baseEnvironment.WXT_CHROME_EXTENSION_KEY;
  const extensionKey = explicitKey ?? developmentExtensionKey;
  const distribution = baseEnvironment.VAULTMESH_EXTENSION_DISTRIBUTION;
  if (distribution && distribution !== sideloadReviewDistribution) {
    throw new Error(`VAULTMESH_EXTENSION_DISTRIBUTION 只支持 ${sideloadReviewDistribution}。`);
  }
  if (requireRelease
    && (!explicitKey || extensionKey === developmentExtensionKey)
    && distribution !== sideloadReviewDistribution) {
    throw new Error("商店或正式发布必须显式提供非 sideload WXT_CHROME_EXTENSION_KEY；本地 Review ZIP 必须显式选择 sideload-review。");
  }
  const derivedExtensionId = extensionIdFromKey(extensionKey);
  const extensionId = baseEnvironment.VAULTMESH_BROWSER_EXTENSION_ID ?? derivedExtensionId;
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("VAULTMESH_BROWSER_EXTENSION_ID 必须是 32 位 Chrome 扩展 ID。");
  }
  if (extensionId !== derivedExtensionId) {
    throw new Error("VAULTMESH_BROWSER_EXTENSION_ID 与 manifest key 不匹配。");
  }
  const geckoId = baseEnvironment.VAULTMESH_FIREFOX_EXTENSION_ID ?? firefoxExtensionId;
  if (!validFirefoxExtensionId(geckoId)) {
    throw new Error(`VAULTMESH_FIREFOX_EXTENSION_ID 必须固定为 ${firefoxExtensionId}。`);
  }
  return {
    ...baseEnvironment,
    WXT_CHROME_EXTENSION_KEY: extensionKey,
    VAULTMESH_BROWSER_EXTENSION_ID: extensionId,
    VAULTMESH_FIREFOX_EXTENSION_ID: geckoId,
  };
}
