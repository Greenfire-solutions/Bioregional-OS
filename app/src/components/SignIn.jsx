import React, { useEffect, useState } from 'react';
import { Flame, Loader2, ShieldAlert, KeyRound, LogOut, UserPlus } from 'lucide-react';
import { get, post } from '../api.js';

/**
 * Signing in.
 *
 * Three states, and they are genuinely different screens rather than one screen
 * with fields hidden:
 *
 *   • nobody has an account yet → make the first steward, keyboard only
 *   • signed out               → sign in
 *   • must_change              → choose your own password
 *
 * NOT a wall. A commons that will not show anybody anything until they sign in
 * is a commons a neighbour cannot look at, and DAILY_USE.md is explicit that
 * the day clock gives before it asks. Signing in NARROWS what a connection may
 * do to what that person may do; it is never the thing that makes the OS
 * usable at all. So this is offered, and can be dismissed.
 */
export default function SignIn({ me, onDone, onDismiss }) {
  const [mode, setMode] = useState(me?.can_make_first ? 'first' : 'in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setMode(me?.can_make_first ? 'first' : 'in'); }, [me?.can_make_first]);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true); setError(null);
    const out = await post('sign-in', mode === 'first'
      ? { first_steward: true, username, password, display_name: displayName || username }
      : { username, password });
    setBusy(false);
    if (out?.error) { setError(out.message || out.error); return; }
    setPassword('');
    onDone?.(out.account);
  }

  const first = mode === 'first';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
         onClick={(e) => e.target === e.currentTarget && onDismiss?.()}>
      <div className="mt-[8vh] w-full max-w-sm rounded-lg border border-[var(--line)]
                      bg-[var(--paper)] p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <Flame className="h-5 w-5 text-[var(--gold)]" />
          <h2 className="text-sm font-medium">
            {first ? 'Make the first steward' : 'Sign in'}
          </h2>
        </div>

        {first ? (
          <p className="mb-3 text-xs leading-relaxed text-[var(--ink-2)]">
            Nobody has an account here yet. This one is made at the computer the commons lives on,
            because there is nobody to invite you — after this, a steward or a coordinator makes
            the rest.
          </p>
        ) : (
          <p className="mb-3 text-xs leading-relaxed text-[var(--ink-2)]">
            Signing in says who you are, so what you do is recorded against your name rather than
            against whoever was at the keyboard.
          </p>
        )}

        {/* ── The warning, and why it is not hidden ──────────────────────
            This OS serves plain HTTP: localhost, or http://192.168.x.x on the
            gathering wifi. Over the second one, everything typed here is
            readable by anyone on that network. Saying so is the only honest
            option — the alternative is a password box that silently implies a
            protection this transport cannot provide. The server decides this,
            not the browser, which cannot tell a LAN address from localhost
            without being told. */}
        {me?.warning && (
          <div className="mb-3 flex items-start gap-2 rounded border border-[#E8D9B0] bg-[#FBF3DC]
                          px-2.5 py-2 text-[11px] leading-snug text-[#8A6D1F]">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {me.warning}
              {' '}A code from Together → Devices is handed over in person and never typed across
              the network.
            </span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-2.5">
          {first && (
            <Field label="Your name" value={displayName} onChange={setDisplayName}
                   placeholder="The name that appears on what you do" autoFocus />
          )}
          <Field label="Username" value={username} onChange={setUsername}
                 autoComplete="username" autoFocus={!first} />
          <Field label="Password" type="password" value={password} onChange={setPassword}
                 autoComplete={first ? 'new-password' : 'current-password'}
                 hint={first ? 'At least 10 characters. Four ordinary words is plenty.' : null} />

          {error && (
            <p className="rounded border border-[#E4C9C2] bg-[#FBF1EE] px-2.5 py-1.5 text-[11px]
                          text-[var(--clay)]">{error}</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={busy || !username || !password}
              className="flex items-center gap-1.5 rounded bg-[var(--moss)] px-3.5 py-2 text-xs
                         font-medium text-[var(--on-accent)] disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : first ? <UserPlus className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
              {first ? 'Make it' : 'Sign in'}
            </button>
            <button type="button" onClick={onDismiss}
              className="text-[11px] text-[var(--ink-3)] hover:text-[var(--ink)]">
              not now
            </button>
          </div>
        </form>

        <p className="mt-3 border-t border-[var(--line-2)] pt-2 text-[10px] leading-snug text-[var(--ink-3)]">
          This is not a wall. The commons can be looked at without signing in — what signing in
          changes is that the work has your name on it.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', hint, ...rest }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium">{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5
                   text-sm outline-none focus:border-[var(--moss)]"
        {...rest} />
      {hint && <p className="mt-1 text-[10px] text-[var(--ink-3)]">{hint}</p>}
    </label>
  );
}

/**
 * Who you are, in the header — and the way out.
 *
 * Named rather than implied. A person at somebody else's laptop has to be able
 * to see whose name their work is about to be recorded against, which is the
 * same reason the enrolled device is already named up there.
 */
export function SignedInAs({ me, onSignIn, onSignedOut }) {
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  if (!me.account) {
    return (
      <button onClick={onSignIn}
        className="flex items-center gap-1.5 rounded border border-[var(--line)] px-2 py-1
                   text-[11px] text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--moss)]">
        <KeyRound className="h-3 w-3" />Sign in
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="text-right leading-tight">
        <div className="text-[11px] text-[var(--ink)]">{me.account.display_name}</div>
        <div className="text-[9px] uppercase tracking-wide text-[var(--ink-3)]">{me.account.role}</div>
      </div>
      <button
        onClick={async () => { setBusy(true); await post('sign-out', {}); setBusy(false); onSignedOut?.(); }}
        title="Sign out"
        className="rounded border border-[var(--line)] p-1 text-[var(--ink-3)]
                   hover:border-[var(--clay)] hover:text-[var(--clay)]">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
      </button>
    </div>
  );
}
