import { apps } from 'open';
import { describe, expect, it, vi } from 'vitest';
import { openBrowser } from './open-browser.js';

const URL = 'http://127.0.0.1:7777/?token=abc';

describe('openBrowser', () => {
  it('opens chrome in app mode first', async () => {
    const opener = vi.fn().mockResolvedValue(undefined);
    await expect(openBrowser(URL, opener)).resolves.toBe('app');
    expect(opener).toHaveBeenCalledWith(URL, {
      app: { name: apps.chrome, arguments: [`--app=${URL}`] },
    });
  });

  it('falls back to edge', async () => {
    const opener = vi
      .fn()
      .mockRejectedValueOnce(new Error('no chrome'))
      .mockResolvedValue(undefined);
    await expect(openBrowser(URL, opener)).resolves.toBe('app');
    expect(opener).toHaveBeenLastCalledWith(URL, {
      app: { name: apps.edge, arguments: [`--app=${URL}`] },
    });
  });

  it('falls back to a regular tab', async () => {
    const opener = vi
      .fn()
      .mockRejectedValueOnce(new Error('no chrome'))
      .mockRejectedValueOnce(new Error('no edge'))
      .mockResolvedValue(undefined);
    await expect(openBrowser(URL, opener)).resolves.toBe('tab');
    expect(opener).toHaveBeenLastCalledWith(URL);
  });
});
