import { AUTH_BYPASS_TOKEN, isAuthBypassEnabled } from '@/lib/auth-bypass';

export async function getStudioAuthToken(
  getToken: () => Promise<string | null>,
): Promise<string | null> {
  if (isAuthBypassEnabled()) return AUTH_BYPASS_TOKEN;
  return getToken().catch(() => null);
}
