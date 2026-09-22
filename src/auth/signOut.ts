type SignOutScope = 'global' | 'local';
type SignOutClient = {
  signOut: (options: { scope: SignOutScope }) => Promise<{ error: Error | null }>;
};

export const signOutEverywhere = async (auth: SignOutClient): Promise<void> => {
  const globalResult = await auth.signOut({ scope: 'global' });
  if (!globalResult.error) return;

  const localResult = await auth.signOut({ scope: 'local' });
  if (localResult.error) throw globalResult.error;
};
