import { spawnSync } from "node:child_process";

export interface AntigravityCredentialStoreTokenInput {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}

export interface AntigravityCredentialStoreWriteResult {
  applied: boolean;
  strategy: "windows-credential-manager" | "unsupported-platform";
}

export interface AntigravityCredentialStoreReadResult {
  payload: string;
  strategy: "windows-credential-manager";
}

function formatGoogleExpiry(expiresAt: number | null): string {
  const fallback = Math.floor(Date.now() / 1000) + 3600;
  const seconds = Number.isFinite(expiresAt) && expiresAt && expiresAt > 0 ? expiresAt : fallback;
  return new Date(seconds * 1000).toISOString().replace("Z", "000Z");
}

export function buildAntigravityCredentialStorePayload(input: AntigravityCredentialStoreTokenInput): string {
  if (!input.accessToken.trim()) throw new Error("Antigravity access token is missing");
  if (!input.refreshToken.trim()) throw new Error("Antigravity refresh token is missing");
  return JSON.stringify({
    token: {
      access_token: input.accessToken,
      token_type: "Bearer",
      refresh_token: input.refreshToken,
      expiry: formatGoogleExpiry(input.expiresAt)
    },
    auth_method: "consumer"
  });
}

export function buildWindowsCredentialManagerReadScript(): string {
  return `
$ErrorActionPreference = 'Stop'
$source = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class EgoistCredentialReader
{
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct Credential
  {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredReadW(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern void CredFree(IntPtr buffer);

  public static string Read(string target)
  {
    IntPtr credentialPtr;
    if (!CredReadW(target, 1, 0, out credentialPtr))
    {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return "";
      throw new System.ComponentModel.Win32Exception(error);
    }
    try
    {
      Credential credential = (Credential)Marshal.PtrToStructure(credentialPtr, typeof(Credential));
      if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0) return "";
      byte[] secretBytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, secretBytes, 0, secretBytes.Length);
      return Convert.ToBase64String(secretBytes);
    }
    finally
    {
      CredFree(credentialPtr);
    }
  }
}
"@
Add-Type -TypeDefinition $source
[Console]::Out.Write([EgoistCredentialReader]::Read('gemini:antigravity'))
`;
}

function readWindowsCredentialManagerSecret(): string | null {
  const script = buildWindowsCredentialManagerReadScript();
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`Windows Credential Manager read failed${stderr ? `: ${stderr}` : ""}`);
  }
  const encoded = result.stdout.trim();
  if (!encoded) return null;
  return Buffer.from(encoded, "base64").toString("utf8");
}

export function readAntigravityCredentialStorePayload(
  platform: NodeJS.Platform = process.platform
): AntigravityCredentialStoreReadResult | null {
  if (platform !== "win32") return null;
  const payload = readWindowsCredentialManagerSecret();
  return payload ? { payload, strategy: "windows-credential-manager" } : null;
}

export function buildWindowsCredentialManagerWriteScript(): string {
  return `
$ErrorActionPreference = 'Stop'
$source = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class EgoistCredentialWriter
{
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct Credential
  {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWriteW(ref Credential userCredential, UInt32 flags);

  public static void Write(string target, string username, string secret)
  {
    byte[] secretBytes = Encoding.UTF8.GetBytes(secret);
    IntPtr blob = Marshal.AllocCoTaskMem(secretBytes.Length);
    try
    {
      Marshal.Copy(secretBytes, 0, blob, secretBytes.Length);
      var credential = new Credential
      {
        Type = 1,
        TargetName = target,
        CredentialBlobSize = (UInt32)secretBytes.Length,
        CredentialBlob = blob,
        Persist = 2,
        UserName = username
      };
      if (!CredWriteW(ref credential, 0))
      {
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      }
    }
    finally
    {
      Marshal.FreeCoTaskMem(blob);
    }
  }
}
"@
Add-Type -TypeDefinition $source
$payload = [Console]::In.ReadToEnd()
[EgoistCredentialWriter]::Write('gemini:antigravity', 'antigravity', $payload)
`;
}

function writeWindowsCredentialManagerSecret(payload: string): void {
  const script = buildWindowsCredentialManagerWriteScript();
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    input: payload,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`Windows Credential Manager write failed${stderr ? `: ${stderr}` : ""}`);
  }
}

export function writeAntigravityCredentialStoreToken(
  input: AntigravityCredentialStoreTokenInput,
  platform: NodeJS.Platform = process.platform
): AntigravityCredentialStoreWriteResult {
  const payload = buildAntigravityCredentialStorePayload(input);
  if (platform !== "win32") {
    return { applied: false, strategy: "unsupported-platform" };
  }
  writeWindowsCredentialManagerSecret(payload);
  return { applied: true, strategy: "windows-credential-manager" };
}
