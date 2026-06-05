export const AUTH_BYPASS_CLERK_USER_ID = 'lumen-public-test-user';
export const AUTH_BYPASS_TOKEN = 'lumen-auth-bypass';

export function isAuthBypassEnabled(): boolean {
  return (
    isTruthy(process.env.NEXT_PUBLIC_LUMEN_AUTH_BYPASS) || isTruthy(process.env.LUMEN_AUTH_BYPASS)
  );
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
