import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

export type ProbeNativeOperation = "credential-manager" | "autostart" | "external-app" | "external-url"
  | "provider-network" | "desktop-process-control" | "host-discovery" | "desktop-integration";

const redirectedPaths = ["CAM_USER_DATA_DIR", "CODEX_HOME", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"] as const;
type ProbePathName = typeof redirectedPaths[number];

export interface ProbeIsolationPolicy {
  readonly enabled: boolean;
  readonly root: string | null;
  readonly paths: Readonly<Partial<Record<ProbePathName, string>>>;
}

export class ProbeIsolationError extends Error {
  readonly code = "PROBE_ISOLATION";
  constructor(message: string) {
    super(message);
    this.name = "ProbeIsolationError";
  }
}

let initializedPolicy: ProbeIsolationPolicy | null = null;

export function isProbeIsolationRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CAM_PROBE_MODE === "isolated" || env.CAM_BACKGROUND_PROBE === "1";
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function validateDirectory(directory: string, root: string, label: string): void {
  const relative = path.relative(root, directory);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new ProbeIsolationError(`${label} must be a child of the owned probe root`);
  }
  let candidate = directory;
  while (true) {
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProbeIsolationError(`${label} contains a link or non-directory`);
    if (!samePath(fs.realpathSync.native(candidate), path.resolve(candidate))) {
      throw new ProbeIsolationError(`${label} resolves through a reparse point`);
    }
    if (samePath(candidate, root)) break;
    candidate = path.dirname(candidate);
  }
}

export function createProbeIsolationPolicy(env: NodeJS.ProcessEnv = process.env): ProbeIsolationPolicy {
  if (!isProbeIsolationRequested(env)) return Object.freeze({ enabled: false, root: null, paths: Object.freeze({}) });
  const token = env.CAM_PROBE_TOKEN ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    throw new ProbeIsolationError("An isolated probe requires CAM_PROBE_TOKEN");
  }
  if (!env.CAM_PROBE_ROOT || !path.isAbsolute(env.CAM_PROBE_ROOT)) throw new ProbeIsolationError("An isolated probe requires an absolute CAM_PROBE_ROOT");
  const root = path.resolve(env.CAM_PROBE_ROOT);
  if (path.basename(root).toLowerCase() !== `egoist-probe-${token}`.toLowerCase()) {
    throw new ProbeIsolationError("Probe root name must match its ownership token");
  }
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !samePath(fs.realpathSync.native(root), root)) {
    throw new ProbeIsolationError("Probe root must be a real directory without reparse points");
  }
  const markerPath = path.join(root, ".egoist-probe-root.json");
  const markerStat = fs.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 4096) throw new ProbeIsolationError("Invalid probe ownership marker");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
  if (marker.schemaVersion !== 1 || marker.purpose !== "egoist-isolated-probe" || marker.token !== token) {
    throw new ProbeIsolationError("Probe ownership marker does not match this request");
  }
  const paths: Partial<Record<ProbePathName, string>> = {};
  for (const name of redirectedPaths) {
    const directory = env[name];
    if (!directory || !path.isAbsolute(directory)) throw new ProbeIsolationError(`An isolated probe requires an absolute ${name}`);
    paths[name] = path.resolve(directory);
    validateDirectory(paths[name], root, name);
  }
  return Object.freeze({ enabled: true, root, paths: Object.freeze(paths) });
}

export function initializeProbeIsolation(env: NodeJS.ProcessEnv = process.env): ProbeIsolationPolicy {
  initializedPolicy = createProbeIsolationPolicy(env);
  return initializedPolicy;
}

export function getProbeIsolationPolicy(): ProbeIsolationPolicy {
  return initializedPolicy ?? createProbeIsolationPolicy();
}

export function assertProbeOperationAllowed(operation: ProbeNativeOperation, policy = getProbeIsolationPolicy()): void {
  if (policy.enabled) throw new ProbeIsolationError(`Isolated probe blocks ${operation}`);
}

export function createProbeNativeAdapters<T extends Partial<Record<ProbeNativeOperation, (...args: any[]) => any>>>(
  policy: ProbeIsolationPolicy,
  live: T
): T {
  return Object.fromEntries(Object.entries(live).map(([operation, adapter]) => [operation, (...args: unknown[]) => {
    assertProbeOperationAllowed(operation as ProbeNativeOperation, policy);
    return adapter!(...args);
  }])) as T;
}

function requestUrl(input: string | URL | http.RequestOptions, override?: http.RequestOptions, protocol = "http:"): URL {
  const options = { ...(typeof input === "object" && !(input instanceof URL) ? input : {}), ...override };
  if (options.socketPath || options.createConnection || options.lookup || options.auth || (options.agent !== undefined && options.agent !== false)) {
    throw new ProbeIsolationError("Isolated probe blocks custom network connections");
  }
  const host = options.hostname ?? options.host ?? "localhost";
  const url = typeof input === "string" || input instanceof URL ? new URL(input)
    : new URL(`${options.protocol ?? protocol}//${host}${options.port ? `:${options.port}` : ""}${options.path ?? "/"}`);
  if (options.protocol) url.protocol = options.protocol;
  if (options.hostname) url.hostname = options.hostname;
  else if (options.host) url.host = options.host;
  if (options.port !== undefined) url.port = String(options.port);
  return url;
}

/** Node network guard; Electron session requests must be guarded at their own adapter. */
export function installProbeNetworkGuards(policy = getProbeIsolationPolicy(), rendererOrigin?: string): () => void {
  if (!policy.enabled) return () => undefined;
  const allowedOrigin = rendererOrigin ? new URL(rendererOrigin).origin : null;
  if (allowedOrigin && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(allowedOrigin).hostname)) {
    throw new ProbeIsolationError("Only a loopback renderer origin may be allowed");
  }
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalHttpGet = http.get;
  const originalHttpsGet = https.get;
  const assertRequest = (input: string | URL | http.RequestOptions, override?: http.RequestOptions, protocol?: string) => {
    const url = requestUrl(input, override, protocol);
    if (!allowedOrigin || url.origin !== allowedOrigin || url.username || url.password) {
      assertProbeOperationAllowed("provider-network", policy);
    }
  };
  globalThis.fetch = async (input, init) => {
    assertRequest(input instanceof Request ? input.url : input);
    if (init && "dispatcher" in init) throw new ProbeIsolationError("Isolated probe blocks custom network connections");
    // A permitted development origin must not redirect the native fetch to a provider.
    return originalFetch(input, { ...init, redirect: "error" });
  };
  const wrap = (original: (...args: any[]) => http.ClientRequest, protocol: string) => (...args: any[]): http.ClientRequest => {
    assertRequest(args[0], typeof args[1] === "object" ? args[1] : undefined, protocol);
    return original(...args);
  };
  http.request = wrap(originalHttpRequest, "http:") as typeof http.request;
  https.request = wrap(originalHttpsRequest, "https:") as typeof https.request;
  http.get = wrap(originalHttpGet, "http:") as typeof http.get;
  https.get = wrap(originalHttpsGet, "https:") as typeof https.get;
  syncBuiltinESMExports();
  return () => {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
    http.get = originalHttpGet;
    https.get = originalHttpsGet;
    syncBuiltinESMExports();
  };
}
