export interface AntigravityUnifiedOAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  idToken?: string | null;
}

function encodeVarint(value: number): Uint8Array {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid protobuf varint value");
  const bytes: number[] = [];
  let next = Math.floor(value);
  while (next >= 0x80) {
    bytes.push((next & 0x7f) | 0x80);
    next = Math.floor(next / 128);
  }
  bytes.push(next);
  return Uint8Array.from(bytes);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function encodeLenDelimField(field: number, payload: Uint8Array): Uint8Array {
  return concatBytes(encodeVarint((field << 3) | 2), encodeVarint(payload.length), payload);
}

function encodeStringField(field: number, value: string): Uint8Array {
  return encodeLenDelimField(field, Buffer.from(value, "utf8"));
}

function encodeVarintField(field: number, value: number): Uint8Array {
  return concatBytes(encodeVarint((field << 3) | 0), encodeVarint(value));
}

function readVarint(data: Uint8Array, offset: number): { value: number; nextOffset: number } {
  let result = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < data.length) {
    const byte = data[cursor++];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value: result, nextOffset: cursor };
    shift += 7;
  }
  throw new Error("Invalid protobuf varint");
}

function skipField(data: Uint8Array, offset: number, wireType: number): number {
  if (wireType === 0) return readVarint(data, offset).nextOffset;
  if (wireType === 2) {
    const { value: length, nextOffset } = readVarint(data, offset);
    return nextOffset + length;
  }
  throw new Error(`Unsupported protobuf wire type: ${wireType}`);
}

function getField(data: Uint8Array, field: number): Uint8Array | null {
  let offset = 0;
  while (offset < data.length) {
    const { value: tag, nextOffset } = readVarint(data, offset);
    const wireType = tag & 7;
    const currentField = tag >> 3;
    if (currentField === field) {
      if (wireType === 2) {
        const { value: length, nextOffset: payloadStart } = readVarint(data, nextOffset);
        return data.slice(payloadStart, payloadStart + length);
      }
      if (wireType === 0) {
        const { nextOffset: payloadEnd } = readVarint(data, nextOffset);
        return data.slice(nextOffset, payloadEnd);
      }
      return null;
    }
    offset = skipField(data, nextOffset, wireType);
  }
  return null;
}

function readString(data: Uint8Array | null): string | null {
  return data ? Buffer.from(data).toString("utf8") : null;
}

function readTimestampSeconds(data: Uint8Array | null): number | null {
  if (!data) return null;
  let offset = 0;
  while (offset < data.length) {
    const { value: tag, nextOffset } = readVarint(data, offset);
    const wireType = tag & 7;
    const field = tag >> 3;
    if (field === 1 && wireType === 0) return readVarint(data, nextOffset).value;
    offset = skipField(data, nextOffset, wireType);
  }
  return null;
}

function createOAuthInfo(input: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  idToken?: string | null;
  email?: string | null;
}): Uint8Array {
  const expiresAt = input.expiresAt ?? Math.floor(Date.now() / 1000) + 3600;
  const timestamp = concatBytes(encodeVarintField(1, expiresAt), encodeVarintField(2, 0));
  return concatBytes(
    encodeStringField(1, input.accessToken),
    encodeStringField(2, "Bearer"),
    encodeStringField(3, input.refreshToken),
    encodeLenDelimField(4, timestamp),
    input.idToken ? encodeStringField(5, input.idToken) : new Uint8Array()
  );
}

export function createAntigravityUnifiedStateEntry(sentinelKey: string, payload: Uint8Array): string {
  const row = encodeStringField(1, Buffer.from(payload).toString("base64"));
  const dataEntry = concatBytes(encodeStringField(1, sentinelKey), encodeLenDelimField(2, row));
  return Buffer.from(encodeLenDelimField(1, dataEntry)).toString("base64");
}

export function decodeAntigravityUnifiedStateEntry(entry: string): { sentinelKey: string; payload: Uint8Array } {
  const topic = Buffer.from(entry, "base64");
  const dataEntry = getField(topic, 1);
  if (!dataEntry) throw new Error("Antigravity unified state entry is missing data");
  const sentinelKey = readString(getField(dataEntry, 1));
  const row = getField(dataEntry, 2);
  const encodedPayload = row ? readString(getField(row, 1)) : null;
  if (!sentinelKey || !encodedPayload) throw new Error("Antigravity unified state entry is malformed");
  return { sentinelKey, payload: Buffer.from(encodedPayload, "base64") };
}

export function createAntigravityUnifiedOAuthToken(input: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  idToken?: string | null;
  email?: string | null;
}): string {
  return createAntigravityUnifiedStateEntry("oauthTokenInfoSentinelKey", createOAuthInfo(input));
}

export function parseAntigravityUnifiedOAuthToken(entry: string): AntigravityUnifiedOAuthToken | null {
  const decoded = decodeAntigravityUnifiedStateEntry(entry);
  if (decoded.sentinelKey !== "oauthTokenInfoSentinelKey") return null;
  const accessToken = readString(getField(decoded.payload, 1));
  const refreshToken = readString(getField(decoded.payload, 3));
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: readTimestampSeconds(getField(decoded.payload, 4)),
    idToken: readString(getField(decoded.payload, 5))
  };
}

export function createAntigravityUnifiedUserStatus(email: string): string {
  const payload = concatBytes(encodeStringField(3, email), encodeStringField(7, email));
  return createAntigravityUnifiedStateEntry("userStatusSentinelKey", payload);
}

export function parseAntigravityUnifiedUserStatus(entry: string): { email: string | null } {
  const decoded = decodeAntigravityUnifiedStateEntry(entry);
  if (decoded.sentinelKey !== "userStatusSentinelKey") return { email: null };
  return { email: readString(getField(decoded.payload, 3)) ?? readString(getField(decoded.payload, 7)) };
}

export function createAntigravityUnifiedEnterprisePreferences(projectId: string): string {
  return createAntigravityUnifiedStateEntry("enterpriseGcpProjectId", encodeStringField(3, projectId));
}

export function parseAntigravityUnifiedEnterprisePreferences(entry: string): { googleProjectId: string | null } {
  const decoded = decodeAntigravityUnifiedStateEntry(entry);
  if (decoded.sentinelKey !== "enterpriseGcpProjectId") return { googleProjectId: null };
  return { googleProjectId: readString(getField(decoded.payload, 3)) };
}
