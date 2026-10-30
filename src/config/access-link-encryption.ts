export interface AccessLinkEncryptionKeys {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

// Key material is server configuration, never a DTO or a logged diagnostic.
export function readAccessLinkEncryptionKeys(
  encodedKeys: unknown,
  activeKeyId: unknown,
  jwtSecret?: string,
): AccessLinkEncryptionKeys | undefined {
  if (encodedKeys === undefined && activeKeyId === undefined) return undefined;
  const invalid = () =>
    new Error(
      'ACCESS_LINK_ENCRYPTION_KEYS must be a JSON object of 1-8 named, base64-encoded 32-byte keys; ACCESS_LINK_ACTIVE_KEY_ID must name one of them. Use independent keys, not JWT_SECRET.',
    );
  if (
    typeof encodedKeys !== 'string' ||
    encodedKeys.length > 4096 ||
    typeof activeKeyId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(activeKeyId)
  ) {
    throw invalid();
  }
  let input: unknown;
  try {
    input = JSON.parse(encodedKeys);
  } catch {
    throw invalid();
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid();
  }
  const entries = Object.entries(input);
  if (entries.length < 1 || entries.length > 8) throw invalid();
  const keys = new Map<string, Buffer>();
  for (const [id, value] of entries) {
    if (
      !/^[A-Za-z0-9_-]{1,32}$/.test(id) ||
      typeof value !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(value)
    ) {
      throw invalid();
    }
    const bytes = Buffer.from(value, 'base64');
    if (
      bytes.length !== 32 ||
      bytes.toString('base64') !== value ||
      (jwtSecret !== undefined &&
        (value === jwtSecret || bytes.toString('utf8') === jwtSecret))
    ) {
      throw invalid();
    }
    keys.set(id, bytes);
  }
  if (!keys.has(activeKeyId)) throw invalid();
  return { activeKeyId, keys };
}
