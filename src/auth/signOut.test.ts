import { describe, expect, it, vi } from 'vitest';
import { signOutEverywhere } from './signOut';

describe('signOutEverywhere', () => {
  it('revokes all sessions when global sign-out succeeds', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });

    await signOutEverywhere({ signOut });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('clears the browser session when global revocation is unavailable', async () => {
    const signOut = vi.fn()
      .mockResolvedValueOnce({ error: new Error('network unavailable') })
      .mockResolvedValueOnce({ error: null });

    await signOutEverywhere({ signOut });

    expect(signOut.mock.calls).toEqual([[{ scope: 'global' }], [{ scope: 'local' }]]);
  });

  it('reports the global revocation failure when browser cleanup also fails', async () => {
    const globalError = new Error('global revocation failed');
    const signOut = vi.fn()
      .mockResolvedValueOnce({ error: globalError })
      .mockResolvedValueOnce({ error: new Error('local cleanup failed') });

    await expect(signOutEverywhere({ signOut })).rejects.toBe(globalError);
  });
});
