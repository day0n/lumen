'use client';

import { useI18n } from '@/i18n/provider';
import Link from 'next/link';
import { useState } from 'react';

const TICKET_PARAM = '__clerk_ticket';

function extractTicket(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fromQuery = trimmed.match(/[?&]__clerk_ticket=([^&\s#]+)/);
  if (fromQuery?.[1]) return decodeURIComponent(fromQuery[1]);
  if (/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function InvitationGate({ signInHref }: { signInHref: string }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const ticket = extractTicket(code);
    if (!ticket) {
      setError(t('auth.invite.invalid'));
      return;
    }
    setError(null);
    setSubmitting(true);
    const url = new URL(window.location.href);
    url.searchParams.set(TICKET_PARAM, ticket);
    window.location.href = url.toString();
  };

  return (
    <div className="flex w-full flex-col gap-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 text-white/85">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[18px] font-semibold leading-tight text-white">
          {t('auth.invite.title')}
        </h1>
        <p className="text-[13px] leading-relaxed text-white/60">{t('auth.invite.body')}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t('auth.invite.placeholder')}
          rows={3}
          className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[13px] text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
        {error ? <p className="text-[12px] text-amber-300/90">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting || code.trim().length === 0}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-4 text-[13px] font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('auth.invite.continue')}
        </button>
      </form>
      <p className="text-center text-[12px] text-white/55">
        {t('auth.invite.haveAccount')}{' '}
        <Link
          href={signInHref}
          prefetch={false}
          className="font-medium text-white underline-offset-4 transition hover:underline"
        >
          {t('auth.invite.signIn')}
        </Link>
      </p>
    </div>
  );
}
