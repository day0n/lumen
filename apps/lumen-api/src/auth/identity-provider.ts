import { verifyToken } from '@clerk/backend';
import { TokenVerificationError, TokenVerificationErrorReason } from '@clerk/backend/errors';
import type { SessionIdentity } from '@lumen/backend';

const INVALID_SESSION_REASONS = new Set<string>([
  TokenVerificationErrorReason.TokenExpired,
  TokenVerificationErrorReason.TokenInvalid,
  TokenVerificationErrorReason.TokenInvalidAlgorithm,
  TokenVerificationErrorReason.TokenInvalidAuthorizedParties,
  TokenVerificationErrorReason.TokenInvalidSignature,
  TokenVerificationErrorReason.TokenNotActiveYet,
  TokenVerificationErrorReason.TokenIatInTheFuture,
  TokenVerificationErrorReason.TokenVerificationFailed,
  TokenVerificationErrorReason.JWKKidMismatch,
]);

interface IdentityProviderConfig {
  authorizedParties: string[];
  jwtKey?: string;
  secretKey: string;
}

interface IdentityProviderDependencies {
  verify?: typeof verifyToken;
}

function isJsonObjectSegment(segment: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) return false;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded);
  } catch {
    return false;
  }
}

function isJwtLike(token: string): boolean {
  if (!token || token.length > 131_072) return false;

  const segments = token.split('.');
  return (
    segments.length === 3 &&
    isJsonObjectSegment(segments[0] ?? '') &&
    isJsonObjectSegment(segments[1] ?? '') &&
    /^[A-Za-z0-9_-]+$/.test(segments[2] ?? '') &&
    (segments[2]?.length ?? 0) % 4 !== 1
  );
}

export function createIdentityProvider(
  config: IdentityProviderConfig,
  dependencies: IdentityProviderDependencies = {},
) {
  const verify = dependencies.verify ?? verifyToken;

  return {
    async verifySessionToken(token: string): Promise<SessionIdentity | null> {
      if (!config.secretKey) {
        throw new Error('Identity verification is not configured');
      }
      if (!isJwtLike(token)) return null;

      let payload: Awaited<ReturnType<typeof verifyToken>>;
      try {
        payload = await verify(token, {
          ...(config.authorizedParties.length > 0
            ? { authorizedParties: config.authorizedParties }
            : {}),
          clockSkewInMs: 5_000,
          ...(config.jwtKey ? { jwtKey: config.jwtKey } : {}),
          secretKey: config.secretKey,
        });
      } catch (error) {
        if (error instanceof TokenVerificationError && INVALID_SESSION_REASONS.has(error.reason)) {
          return null;
        }
        throw error;
      }

      const clerkUserId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      const sessionId = typeof payload.sid === 'string' ? payload.sid.trim() : '';
      const authorizedParty = typeof payload.azp === 'string' ? payload.azp.trim() : '';
      if (!clerkUserId || !sessionId || !authorizedParty) return null;
      if (
        config.authorizedParties.length > 0 &&
        !config.authorizedParties.includes(authorizedParty)
      ) {
        return null;
      }

      return {
        clerkUserId,
        sessionId,
      };
    },
  };
}
