export interface RuntimeEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  CORS_ORIGINS: string[];
  DATABASE_URL: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): RuntimeEnvironment {
  const nodeEnv = input.NODE_ENV ?? 'development';
  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const portInput = input.PORT ?? 3100;
  if (typeof portInput !== 'string' && typeof portInput !== 'number') {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const portValue = String(portInput).trim();
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const originsValue =
    input.CORS_ORIGINS ??
    (nodeEnv === 'production'
      ? ''
      : 'http://localhost:5175,http://127.0.0.1:5175');

  if (typeof originsValue !== 'string' || !originsValue.trim()) {
    throw new Error('CORS_ORIGINS must contain at least one HTTP(S) origin.');
  }

  const origins = originsValue.split(',').map((value) => {
    try {
      const url = new URL(value.trim());
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.hostname.includes('*')
      ) {
        throw new Error();
      }
      return url.origin;
    } catch {
      throw new Error(
        'CORS_ORIGINS must be comma-separated HTTP(S) origins without paths, credentials, or wildcards.',
      );
    }
  });

  const frontendValue =
    input.FRONTEND_URL ??
    (nodeEnv === 'production' ? '' : 'http://localhost:5175');
  let frontendUrl: string;
  try {
    if (typeof frontendValue !== 'string' || !frontendValue.trim()) {
      throw new Error();
    }
    const url = new URL(frontendValue.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (nodeEnv === 'production' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.hostname.includes('*')
    ) {
      throw new Error();
    }
    frontendUrl = url.origin;
  } catch {
    throw new Error(
      'FRONTEND_URL must be an HTTP(S) origin without paths, credentials, query, or fragment; production requires an explicit HTTPS origin.',
    );
  }

  const databaseUrl =
    typeof input.DATABASE_URL === 'string' ? input.DATABASE_URL.trim() : '';
  try {
    const url = new URL(databaseUrl);
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2 ||
      url.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL with a host and database name.',
    );
  }

  const jwtSecret =
    typeof input.JWT_SECRET === 'string' ? input.JWT_SECRET.trim() : '';
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    throw new Error(
      'JWT_SECRET must contain at least 32 bytes. Use a randomly generated secret.',
    );
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    CORS_ORIGINS: [...new Set(origins)],
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    FRONTEND_URL: frontendUrl,
  };
}
