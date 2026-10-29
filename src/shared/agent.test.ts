import { describe, expect, it } from 'vitest';
import { PERMISSION_MODES, isPermissionMode } from './agent.js';
import { ERROR_CODES, isErrorCode } from './errors.js';

describe('isPermissionMode', () => {
  it.each(PERMISSION_MODES)('accepts %s', (mode) => {
    expect(isPermissionMode(mode)).toBe(true);
  });

  it.each(['bypassPermissions', '', 1, null])('rejects %s', (value) => {
    expect(isPermissionMode(value)).toBe(false);
  });
});

describe('isErrorCode', () => {
  it.each(ERROR_CODES)('accepts %s', (code) => {
    expect(isErrorCode(code)).toBe(true);
  });

  it.each(['NOPE', undefined])('rejects %s', (value) => {
    expect(isErrorCode(value)).toBe(false);
  });
});
