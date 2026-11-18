import { spawn, spawnSync } from "node:child_process";
import { assertProbeOperationAllowed } from "./probeIsolationService.js";

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
  assertProbeOperationAllowed("credential-manager");
  const script = buildWindowsCredentialManagerReadScript();
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Windows Credential Manager read failed (exit ${result.status ?? "unknown"})`);
  }
  const encoded = result.stdout.trim();
  if (!encoded) return null;
  return decodeCredentialPayload(encoded);
}

function decodeCredentialPayload(encoded: string): string {
  const bytes = Buffer.from(encoded, "base64");
  const payload = bytes.toString("utf8");
  const roundtrip = Buffer.from(payload, "utf8");
  const exact = bytes.equals(roundtrip);
  bytes.fill(0);
  roundtrip.fill(0);
  if (!exact) throw new Error("Antigravity credential encoding cannot be restored exactly; operation aborted");
  return payload;
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
  assertProbeOperationAllowed("credential-manager");
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
    throw new Error(`Windows Credential Manager write failed (exit ${result.status ?? "unknown"})`);
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

export interface CredentialCommandOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  runner?: CredentialCommandRunner;
}

export type CredentialCommandRunner = (
  script: string,
  input: string | undefined,
  options: Omit<CredentialCommandOptions, "runner">
) => Promise<string>;

const runCredentialCommand: CredentialCommandRunner = (script, input, options) => new Promise((resolve, reject) => {
  if (options.signal?.aborted) { reject(options.signal.reason); return; }
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const output: Buffer[] = [];
  let bytes = 0;
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    if (error) reject(error);
    else resolve(Buffer.concat(output).toString("utf8").trim());
    for (const chunk of output) chunk.fill(0);
  };
  const abort = () => {
    child.kill();
    const error = new Error("Windows Credential Manager operation cancelled");
    error.name = "AbortError";
    finish(error);
  };
  const timer = setTimeout(() => {
    child.kill();
    finish(new Error("Windows Credential Manager operation timed out"));
  }, options.timeoutMs ?? 20_000);
  options.signal?.addEventListener("abort", abort, { once: true });
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) {
      child.kill();
      chunk.fill(0);
      finish(new Error("Windows Credential Manager output exceeded its limit"));
    } else if (settled) chunk.fill(0);
    else output.push(chunk);
  });
  child.stderr.resume();
  child.on("error", () => finish(new Error("Windows Credential Manager helper could not start")));
  child.on("close", (code) => finish(code === 0 ? undefined : new Error(`Windows Credential Manager helper failed (exit ${code ?? "unknown"})`)));
  child.stdin.on("error", () => finish(new Error("Windows Credential Manager helper input failed")));
  child.stdin.end(input ?? "");
});

async function credentialCommand(script: string, input: string | undefined, options: CredentialCommandOptions): Promise<string> {
  assertProbeOperationAllowed("credential-manager");
  if (options.signal?.aborted) throw options.signal.reason;
  return (options.runner ?? runCredentialCommand)(script, input, options);
}

export async function readAntigravityCredentialStorePayloadAsync(
  platform: NodeJS.Platform = process.platform,
  options: CredentialCommandOptions = {}
): Promise<AntigravityCredentialStoreReadResult | null> {
  if (platform !== "win32") return null;
  const encoded = await credentialCommand(buildWindowsCredentialManagerReadScript(), undefined, options);
  if (!encoded) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("Windows Credential Manager returned invalid encoded data");
  }
  return { payload: decodeCredentialPayload(encoded), strategy: "windows-credential-manager" };
}

export async function writeAntigravityCredentialStoreTokenAsync(
  input: AntigravityCredentialStoreTokenInput,
  platform: NodeJS.Platform = process.platform,
  options: CredentialCommandOptions = {}
): Promise<AntigravityCredentialStoreWriteResult> {
  return writeAntigravityCredentialStorePayloadAsync(buildAntigravityCredentialStorePayload(input), platform, options);
}

export async function writeAntigravityCredentialStorePayloadAsync(
  payload: string,
  platform: NodeJS.Platform = process.platform,
  options: CredentialCommandOptions = {}
): Promise<AntigravityCredentialStoreWriteResult> {
  if (!payload.trim()) throw new Error("Antigravity credential payload is missing");
  if (platform !== "win32") return { applied: false, strategy: "unsupported-platform" };
  await credentialCommand(buildWindowsCredentialManagerWriteScript(), payload, options);
  return { applied: true, strategy: "windows-credential-manager" };
}

export function buildWindowsCredentialManagerDeleteScript(): string {
  return `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class EgoistCredentialDelete {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDeleteW(string target, UInt32 type, UInt32 flags);
  public static void Delete() {
    if (!CredDeleteW("gemini:antigravity", 1, 0)) {
      int code = Marshal.GetLastWin32Error();
      if (code != 1168) throw new System.ComponentModel.Win32Exception(code);
    }
  }
}
"@
[EgoistCredentialDelete]::Delete()`;
}

export async function deleteAntigravityCredentialStorePayloadAsync(
  platform: NodeJS.Platform = process.platform,
  options: CredentialCommandOptions = {}
): Promise<AntigravityCredentialStoreWriteResult> {
  if (platform !== "win32") return { applied: false, strategy: "unsupported-platform" };
  await credentialCommand(buildWindowsCredentialManagerDeleteScript(), undefined, options);
  return { applied: true, strategy: "windows-credential-manager" };
}
