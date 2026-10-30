import { describe, expect, it } from 'vitest';
import { maskSecrets } from './mask-secrets.js';

describe('maskSecrets', () => {
  it.each([
    ['curl -H "Authorization: Bearer abcdef123456" x', 'curl -H "Authorization: ***" x'],
    ['Bearer abcdef123456', 'Bearer ***'],
    ['git clone https://me:hunter2@github.com/a/b', 'git clone https://me:***@github.com/a/b'],
    ['curl -u admin:hunter2 x', 'curl -u admin:*** x'],
    ['deploy --token abc123', 'deploy --token ***'],
    ['DB_PASSWORD=hunter2 npm start', 'DB_PASSWORD=*** npm start'],
    ['key sk-ant-abcdefghijkl', 'key sk-***'],
    ['ghp_abcdefghijklmnopqrstu', 'gh*_***'],
    ['AKIAABCDEFGHIJKLMNOP', 'AKIA***'],
    ['eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeK', 'eyJ***'],
    ['-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', '***'],
  ])('masks %s', (input, expected) => {
    expect(maskSecrets(input)).toBe(expected);
  });

  it('keeps ordinary commands', () => {
    expect(maskSecrets('npm test -- --run src/app.test.ts')).toBe(
      'npm test -- --run src/app.test.ts',
    );
  });
});
