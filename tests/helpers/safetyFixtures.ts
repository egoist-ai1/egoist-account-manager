import crypto from "node:crypto";
import type { AntigravityBackupProtection } from "../../src/main/services/antigravityProfileBackup";

export function createMemoryBackupProtection(): Required<Pick<AntigravityBackupProtection, "sealBackup" | "unsealBackup">> {
  const key = crypto.randomBytes(32);
  return {
    sealBackup(contents) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const bytes = Buffer.concat([cipher.update(contents, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
    },
    unsealBackup(ciphertext) {
      const bytes = Buffer.from(ciphertext, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    }
  };
}
