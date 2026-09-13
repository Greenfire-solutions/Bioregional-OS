import React, { useEffect, useState } from 'react';
import { Flame, Check, Loader2, Ear, Eye, CalendarCheck, Lock, KeyRound, ArrowRight } from 'lucide-react';
import { callTool, get, device, rememberDevice, forgetDevice } from '../api.js';
import GroundForAnyone from './GroundForAnyone.jsx';

/**
 * The page another device lands on — after scanning the code at a gathering,
 * or after being handed an invitation code by the steward.
 *
 * Designed against three findings in docs/SOCIAL_LAYER.md:
 *
 *  • §3.4 — in-person scanning converts at 15–35% against 1–5% for a poster,
 *    and the single biggest lever after that is how simple the landing action
 *    is. So this is one screen with one field, not a tour of the commons.
 *
 *  • §2 — this page is served over http on a wifi address, which is not a
 *    secure context. Nothing here may depend on the clipboard, on geolocation,
 *    or on anything else browsers gate behind HTTPS.
 *
 *  • Care as Infrastructure — a need brought in a room where a code is on the
 *    wall is brought in public. Private is the default here, and the person is
 *    told what that means, because the alternative is somebody discovering
 *    afterwards that their situation is in a list.
 *
 * And one more surface, `Join this device`: redeeming an invitation code from
 * engines/enrol.mjs. It is NOT a sign-in. The steward showed a code; typing it
 * here, with a name for this device, turns this browser into one that can
 * write at the role the steward chose. The token that comes back is kept on
 * this device only, sent as a header on every call, and forgotten with one
 * click. A code arrives either typed, or in the link's fragment
 * (`/join#enrol=XXXX-XXXX`) — the fragment because a browser never sends it to
 * the server and it lands in no log.
 *
 * No account, no login, no app. A name, typed once and remembered on the phone.
 */
export default function Join() {
  const [status, setStatus] = useState(null);
  const [gathering, setGathering] = useState(null);
  const [name, setName] = useState(() => {
    try { return localStorage.getItem('bros.join.name') ?? ''; } catch { return ''; }
  });
  const hashCode = readEnrolHash();
  const [mode, setMode] = useState(hashCode ? 'enrol' : 'notice'); // notice · need · rsvp · enrol
  const [text, setText] = useState('');
  const [privateNeed, setPrivateNeed] = useState(true);
  const [state, setState] = useState('idle');
  const [done, setDone] = useState([]);

  // enrolment
  const [code, setCode] = useState(hashCode ?? '');
  const [label, setLabel] = useState('');
  const [enrolled, setEnrolled] = useState(() => device());

  useEffect(() => {
    // The land, before anything is asked for: <GroundForAnyone /> below.
    get('status').then(setStatus).catch(() => {});
    get('gatherings').then((g) => {
      const next = (g ?? []).filter((x) => x.starts_at).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
        .find((x) => new Date(String(x.starts_at).replace(' ', 'T')) >= new Date(Date.now() - 12 * 3600e3));
      setGathering(next ?? null);
    }).catch(() => {});
  }, []);

  function remember(n) {
    setName(n);
    try { localStorage.setItem('bros.join.name', n); } catch { /* private window */ }
  }

  async function submit(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body && mode !== 'rsvp') return;
    setState('saving');

    let r;
    if (mode === 'notice') {
      r = await callTool('add_signal', {
        title: body, author: name.trim() || null,
        category: 'Ecological', severity: 'Info', source: 'notice',
      });
    } else if (mode === 'need') {
      r = await callTool('submit_intake', {
        kind: 'need', body, submitted_by: name.trim() || null,
        private: privateNeed ? 1 : 0,
      });
    } else {
      // Counts against the gathering that exists. A phone in a room must not be
      // able to invent an event nobody scheduled.
      if (!gathering?.id) { setState('Nothing is scheduled to answer.'); return; }
      r = await callTool('rsvp_to_gathering', { gathering_id: gathering.id });
    }

    if (r?.error) { setState(r.message || r.error); return; }
    setDone((d) => [{ mode, body: body || 'Coming along' }, ...d]);
    setText(''); setState('done');
    setTimeout(() => setState('idle'), 2500);
  }

  async function enrol(e) {
    e.preventDefault();
    if (!code.trim() || !label.trim()) return;
    setState('saving');
    const r = await callTool('enrol_device', {
      code: code.trim(), label: label.trim(), person_name: name.trim() || undefined,
    });
    if (r?.error) { setState(r.message || r.error); return; }
    const d = { token: r.token, label: r.device.label, role: r.device.role, id: r.device.id,
                chapter: status?.chapters?.[0]?.name ?? null, enrolled_at: new Date().toISOString() };
    rememberDevice(d);
    setEnrolled(d);
    // The code is spent. Take it out of the address bar so a reload does not
    // try to redeem it again and a shared screenshot does not carry it.
    try { history.replaceState(null, '', window.location.pathname); } catch { /* fine */ }
    setState('idle');
  }

  function forget() {
    forgetDevice(); setEnrolled(null); setMode('notice');
  }

  const chapter = status?.chapters?.[0];

  return (
    <div className="mx-auto min-h-full max-w-md px-5 pb-16 pt-8">
      <header className="flex items-center gap-2.5">
        <Flame className="h-6 w-6 shrink-0 text-[var(--gold)]" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium leading-tight">{chapter?.name ?? 'This commons'}</h1>
          <p className="text-[11px] text-[var(--ink-3)]">
            No account, nothing installed. What you write stays on the computer running this.
          </p>
        </div>
      </header>

      <GroundForAnyone className="mt-5" />

      {enrolled && (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[#CBDCCD] bg-[#F2F6F2] px-3 py-2 text-[12px]">
          <KeyRound className="h-3.5 w-3.5 text-[var(--moss)]" />
          <span>This device is <strong>{enrolled.label}</strong>, enrolled as a <strong>{enrolled.role}</strong>.</span>
          <a href="/" className="flex items-center gap-1 rounded bg-[var(--moss)] px-2.5 py-1 text-[11px] font-medium text-white">
            Open the commons <ArrowRight className="h-3 w-3" />
          </a>
          <button type="button" onClick={forget} className="ml-auto text-[11px] text-[var(--ink-3)] hover:text-[var(--clay)]">
            forget this device
          </button>
        </div>
      )}

      <div className="mt-6">
        <label htmlFor="join-name" className="text-xs text-[var(--ink-2)]">Your name</label>
        <input id="join-name" value={name} onChange={(e) => remember(e.target.value)}
          placeholder="so people know who noticed it"
          className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-base
                     outline-none focus:border-[var(--moss)] placeholder:text-[var(--ink-3)]" />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-1.5">
        <Tab on={mode === 'notice'} onClick={() => setMode('notice')} icon={Eye} label="I noticed" />
        <Tab on={mode === 'need'} onClick={() => setMode('need')} icon={Ear} label="I need" />
        <Tab on={mode === 'rsvp'} onClick={() => setMode('rsvp')} icon={CalendarCheck} label="I'm coming"
             disabled={!gathering} />
      </div>

      {mode === 'enrol' ? (
        <form onSubmit={enrol} className="mt-4 rounded border border-[var(--line)] bg-[var(--paper-2)] p-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--gold)]" />
            <h2 className="text-sm font-medium">Join this device</h2>
          </div>
          <p className="mt-1 text-[12px] text-[var(--ink-2)]">
            The steward shows a code on their screen. Type it here with a name for this device, and
            this browser can write to the commons. Nothing to remember afterwards.
          </p>
          <label htmlFor="join-code" className="mt-3 block text-xs text-[var(--ink-2)]">The code</label>
          <input id="join-code" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setState('idle'); }}
            placeholder="ABCD-EFGH" autoCapitalize="characters" autoComplete="off" spellCheck={false}
            className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-lg tracking-[.12em]
                       outline-none focus:border-[var(--moss)] placeholder:text-[var(--ink-3)]"
            style={{ fontFamily: 'var(--font-data)' }} />
          <label htmlFor="join-label" className="mt-3 block text-xs text-[var(--ink-2)]">A name for this device</label>
          <input id="join-label" value={label} onChange={(e) => { setLabel(e.target.value); setState('idle'); }}
            placeholder={name.trim() ? `${name.trim()}'s laptop` : "Maya's laptop"}
            className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-base
                       outline-none focus:border-[var(--moss)] placeholder:text-[var(--ink-3)]" />
          <p className="mt-1 text-[11px] text-[var(--ink-3)]">
            The name is what makes the steward's list readable six months from now.
          </p>
          <button type="submit" disabled={state === 'saving' || !code.trim() || !label.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-[var(--moss)] px-4 py-3
                       text-base font-medium text-white disabled:opacity-40">
            {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join with this code'}
          </button>
          {state !== 'idle' && state !== 'saving' && state !== 'done' && (
            <p className="mt-2 text-xs text-[var(--clay)]">{state}</p>
          )}
          <button type="button" onClick={() => setMode('notice')}
            className="mt-3 text-[11px] text-[var(--ink-3)] hover:text-[var(--ink)]">
            back
          </button>
        </form>
      ) : (
        <form onSubmit={submit} className="mt-4">
          {mode !== 'rsvp' ? (
            <>
              <textarea
                id="join-text" value={text} onChange={(e) => { setText(e.target.value); setState('idle'); }}
                rows={4} autoFocus
                placeholder={mode === 'notice'
                  ? 'What did you notice today? The creek, a bird, a smell, a change.'
                  : 'What do you need? Someone will read this and answer.'}
                className="w-full rounded border border-[var(--line)] bg-[var(--paper)] p-3 text-base
                           outline-none focus:border-[var(--moss)] placeholder:text-[var(--ink-3)]" />
              {mode === 'need' && (
                <label className="mt-2 flex items-start gap-2 text-[12px] text-[var(--ink-2)]">
                  <input type="checkbox" id="join-private" checked={privateNeed}
                    onChange={(e) => setPrivateNeed(e.target.checked)} className="mt-0.5" />
                  <span>
                    <Lock className="mr-1 inline h-3 w-3" />
                    Keep this private — only the people who answer needs will see it.
                    {!privateNeed && <strong className="block text-[var(--clay)]">
                      Unticked, this is visible to everyone who opens the commons.
                    </strong>}
                  </span>
                </label>
              )}
            </>
          ) : (
            <div className="rounded border border-[var(--line)] bg-[var(--paper-2)] p-3 text-sm">
              {gathering
                ? <>Coming to <strong>{gathering.title}</strong>?<br />
                    <span className="text-xs text-[var(--ink-2)]">{gathering.location_name ?? ''} {gathering.starts_at}</span></>
                : 'Nothing is scheduled yet.'}
            </div>
          )}

          <button type="submit" disabled={state === 'saving' || (mode !== 'rsvp' && !text.trim())}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-[var(--moss)] px-4 py-3
                       text-base font-medium text-white disabled:opacity-40">
            {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" />
              : state === 'done' ? <><Check className="h-4 w-4" /> Written down</>
              : mode === 'rsvp' ? 'Count me in' : 'Send it in'}
          </button>
          {state !== 'idle' && state !== 'saving' && state !== 'done' && (
            <p className="mt-2 text-xs text-[var(--clay)]">{state}</p>
          )}
        </form>
      )}

      {mode !== 'enrol' && !enrolled && (
        <button type="button" onClick={() => setMode('enrol')}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded border border-[var(--line)]
                     bg-[var(--paper-2)] px-3 py-2.5 text-[13px] font-medium text-[var(--ink-2)]
                     hover:border-[var(--moss)] hover:text-[var(--moss)]">
          <KeyRound className="h-4 w-4" /> Have a code from the steward? Join this device
        </button>
      )}

      {done.length > 0 && (
        <div className="mt-7 border-t border-[var(--line)] pt-4">
          <p className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">From you, just now</p>
          <ul className="mt-2 space-y-1.5">
            {done.map((d, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-[var(--ink-2)]">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--moss)]" />
                <span>{d.body}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-[var(--ink-3)]">
            Observations start unverified. Somebody who knows the place will check them — that is a
            human job here, and nothing verifies itself.
          </p>
        </div>
      )}
    </div>
  );
}

/** `#enrol=ABCD-EFGH` from the address bar, or null. */
function readEnrolHash() {
  try {
    const m = /(?:^#|&)enrol=([A-Za-z0-9-]+)/.exec(window.location.hash);
    return m ? m[1].toUpperCase() : null;
  } catch { return null; }
}

function Tab({ on, onClick, icon: I, label, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded border px-2 py-2.5 text-[11px] font-medium
        ${on ? 'border-[var(--moss)] bg-[var(--moss)] text-white'
             : 'border-[var(--line)] text-[var(--ink-2)]'} disabled:opacity-35`}>
      <I className="h-4 w-4" />{label}
    </button>
  );
}
