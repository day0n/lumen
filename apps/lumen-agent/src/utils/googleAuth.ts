/**
 * Google service account JWT → access token。
 *
 * 把 base64 编码的 service account JSON 解出来，构造 RS256 JWT 拿
 * OAuth2 access token。token 缓存 50 分钟（Google 给的是 1 小时）。
 */

import { Buffer } from 'node:buffer';
import { createSign } from 'node:crypto';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

export function parseServiceAccount(b64: string): ServiceAccount {
  const json = Buffer.from(b64, 'base64').toString('utf-8');
  return JSON.parse(json) as ServiceAccount;
}

function b64url(s: Buffer | string): string {
  return Buffer.from(s)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function getGoogleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer
    .sign(sa.private_key)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to obtain Google access token: HTTP ${res.status}: ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export class GoogleTokenCache {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(private readonly sa: ServiceAccount) {}

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) {
      return this.cached.token;
    }
    const token = await getGoogleAccessToken(this.sa);
    this.cached = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
    return token;
  }

  get projectId(): string {
    return this.sa.project_id;
  }
}
