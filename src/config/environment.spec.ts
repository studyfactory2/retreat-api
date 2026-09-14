import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  it('provides local defaults', () => {
    expect(validateEnvironment({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3100,
      CORS_ORIGINS: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    });
  });

  it('normalizes and deduplicates explicit origins', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        PORT: '4100',
        CORS_ORIGINS: ' https://stay.example.com/,https://stay.example.com ',
      }),
    ).toEqual({
      NODE_ENV: 'production',
      PORT: 4100,
      CORS_ORIGINS: ['https://stay.example.com'],
    });
  });

  it.each(['', 'abc', '3100junk', '1.5', '1e3', '0', '-1', '65536'])(
    'rejects invalid PORT: %s',
    (port) => {
      expect(() => validateEnvironment({ PORT: port })).toThrow('PORT');
    },
  );

  it('rejects an unsupported environment', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'prod' })).toThrow('NODE_ENV');
  });

  it('requires explicit production origins', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(
      'CORS_ORIGINS',
    );
  });

  it.each([
    '',
    '*',
    'null',
    'file:///tmp/app',
    'https://*.example.com',
    'https://example.com/path',
    'https://example.com?secret=hidden',
    'https://example.com#fragment',
    'https://user:password@example.com',
    'https://example.com,',
  ])('rejects unsafe or malformed origins: %s', (origin) => {
    expect(() => validateEnvironment({ CORS_ORIGINS: origin })).toThrow(
      'CORS_ORIGINS',
    );
  });
});
