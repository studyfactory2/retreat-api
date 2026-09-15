export interface RuntimeEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  CORS_ORIGINS: string[];
  DATABASE_URL: string;
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
      : 'http://localhost:5173,http://127.0.0.1:5173');

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

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    CORS_ORIGINS: [...new Set(origins)],
    DATABASE_URL: databaseUrl,
  };
}
