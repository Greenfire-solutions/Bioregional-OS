import React, { useState } from 'react';
import {
  MapPin, Crosshair, Loader2, ArrowRight, X, Sparkles, TriangleAlert, Flame,
} from 'lucide-react';
import { callTool } from '../api.js';

/**
 * The first sixty seconds.
 *
 * One question, then everything the OS can find out about that point — before
 * it asks for anything at all. Nothing on the reveal screen writes to the
 * database; a person can find out what bioregion they live in and close the
 * tab, and that is a perfectly good outcome.
 *
 * The two representation questions at the end are NOT softened. They are the
 * protocol's first gate, and this is simply where somebody meets it.
 */
export default function FirstRun({ blocking = false, onDone, onDismiss }) {
  const [step, setStep] = useState('ask');          // ask · reveal · found
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [look, setLook] = useState(null);
  const [error, setError] = useState(null);

  async function search(opts) {
    setBusy(true); setError(null);
    const r = await callTool('look_around', { depth: 'quick', ...opts });
    setBusy(false);
    if (r?.error) { setError(r.message ?? 'Could not find that.'); return; }
    setLook(r); setStep('reveal');
    // The slow half — soil and species — arrives second so the first answer is fast.
    callTool('look_around', { depth: 'full', lat: r.place.lat, lng: r.place.lng })
      .then((full) => { if (!full?.error) setLook(full); })
      .catch(() => {});
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setError('This browser will not share a location. Type a place instead.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => search({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { setBusy(false); setError('Location was not shared. Type a place instead.'); },
      { timeout: 12000 },
    );
  }

  return (
    <div className={blocking
      ? 'flex h-full items-center justify-center overflow-y-auto bg-[var(--paper)] p-6'
      : 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--ink)]/30 p-6 backdrop-blur-sm'}>
      <div className="my-auto w-full max-w-xl rounded border border-[var(--line)] bg-[var(--paper)] shadow-lg">
        <header className="flex items-start gap-3 border-b border-[var(--line)] px-5 py-4">
          <Flame className="mt-0.5 h-5 w-5 shrink-0 text-[var(--gold)]" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-medium">
              {step === 'ask' && 'Where are you?'}
              {step === 'reveal' && 'This is where you are'}
              {step === 'found' && 'Your commons exists'}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--ink-2)]">
              {step === 'ask' && 'One question. Nothing is saved, and nothing leaves this computer.'}
              {step === 'reveal' && 'Everything below was looked up live. None of it has been written down yet.'}
              {step === 'found' && 'Resolved against real ecological boundaries.'}
            </p>
          </div>
          {!blocking && (
            <button onClick={onDismiss} className="rounded p-1 text-[var(--ink-3)] hover:text-[var(--ink)]" title="Close">
              <X className="h-4 w-4" />
            </button>
          )}
        </header>

        {step === 'ask' && (
          <div className="px-5 py-5">
            <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search({ query: query.trim() }); }}>
              <label htmlFor="firstrun-where" className="text-xs text-[var(--ink-2)]">
                A town, a creek, a road junction, a farm name — anything with a name on a map.
              </label>
              <div className="mt-2 flex gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
                  <MapPin className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
                  <input
                    id="firstrun-where" autoFocus value={query}
                    onChange={(e) => { setQuery(e.target.value); setError(null); }}
                    placeholder="Barton Creek Greenbelt, Austin TX"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ink-3)]"
                  />
                </div>
                <button type="submit" disabled={busy || !query.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded bg-[var(--moss)] px-3.5 py-2 text-xs
                             font-medium text-white disabled:opacity-40">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Look <ArrowRight className="h-3.5 w-3.5" /></>}
                </button>
              </div>
            </form>

            <button onClick={useMyLocation} disabled={busy}
              className="mt-3 flex items-center gap-1.5 text-xs text-[var(--water)] hover:underline disabled:opacity-40">
              <Crosshair className="h-3.5 w-3.5" /> or use where I am now
            </button>

            {error && <p className="mt-3 text-xs text-[var(--clay)]">{error}</p>}
          </div>
        )}

        {step === 'reveal' && look && (
          <Reveal look={look} onPick={(alt) => search({ lat: alt.lat, lng: alt.lng })}
                  onBegin={() => setStep('found')} onBack={() => { setStep('ask'); setLook(null); }}
                  blocking={blocking} onDismiss={onDismiss} />
        )}

        {step === 'found' && look && (
          <Found look={look} onDone={onDone} />
        )}
      </div>
    </div>
  );
}

function Reveal({ look, onPick, onBegin, onBack, blocking, onDismiss }) {
  const where = [look.place.name, look.place.detail].filter(Boolean).join(' · ');
  return (
    <>
      <div className="border-b border-[var(--line)] px-5 py-3">
        <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">{where}</div>
        {look.alternatives?.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-[var(--ink-3)]">not this one?</span>
            {look.alternatives.slice(0, 3).map((a, i) => (
              <button key={i} onClick={() => onPick(a)}
                className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[var(--ink-2)] hover:border-[var(--moss)]">
                {a.detail ?? a.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <ul className="divide-y divide-[var(--line-2)] px-5">
        {look.lines.map((l, i) => (
          <li key={i} className={`flex gap-2.5 py-2.5 text-sm leading-snug ${
            l.kind === 'hazard' ? 'text-[var(--clay)]' : l.kind === 'gap' ? 'text-[var(--ink-3)] text-xs' : ''}`}>
            {l.kind === 'hazard'
              ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              : <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]" />}
            <span>{bold(l.text)}</span>
          </li>
        ))}
        {look.depth === 'quick' && (
          <li className="flex items-center gap-2 py-2.5 text-xs text-[var(--ink-3)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading the soil and what lives here…
          </li>
        )}
      </ul>

      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-5 py-3">
        <button onClick={onBegin}
          className="flex items-center gap-1.5 rounded bg-[var(--moss)] px-3.5 py-2 text-xs font-medium text-white">
          <Sparkles className="h-3.5 w-3.5" /> Start a commons here
        </button>
        <button onClick={onBack} className="rounded border border-[var(--line)] px-3 py-2 text-xs hover:border-[var(--moss)]">
          Somewhere else
        </button>
        {!blocking && (
          <button onClick={onDismiss} className="ml-auto text-xs text-[var(--ink-3)] hover:text-[var(--ink)]">
            Just looking
          </button>
        )}
      </footer>
      <p className="px-5 pb-3 text-[10px] text-[var(--ink-3)]">
        Nothing above has been saved. {look.place.geocoder_credit ?? (look.place.geocoder ? `Place found via ${look.place.geocoder}.` : '')}
      </p>
    </>
  );
}

function Found({ look, onDone }) {
  const suggested = look.watershed?.watershed_name
    ? `${look.watershed.watershed_name} Commons`
    : `${look.place.locality ?? look.place.name} Commons`;
  const [form, setForm] = useState({
    chapter_name: suggested, represents: '', does_not_represent: '',
    place_name: look.place.name ?? '', scale: 'site',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError(null); };

  async function submit(e) {
    e.preventDefault();
    // Caught here so the refusal reads like the reason it exists, rather than
    // like a schema validation message on somebody's first screen.
    if (!form.represents.trim() || !form.does_not_represent.trim()) {
      setError('Both representation answers are required — including the second one. ' +
               'It is the protocol\'s first gate, not a formality.');
      return;
    }
    setBusy(true);
    const r = await callTool('begin_here', {
      ...form,
      lat: look.place.lat, lng: look.place.lng,
      locality: look.place.locality, region: look.place.region, country: look.place.country,
    });
    setBusy(false);
    if (r?.error) { setError(r.message ?? r.error); return; }
    onDone?.(r);
  }

  return (
    <form onSubmit={submit} className="space-y-3 px-5 py-4">
      <Field id="fr-name" label="What is this commons called?" value={form.chapter_name} onChange={set('chapter_name')} />
      <Field id="fr-place" label="And this first place?" value={form.place_name} onChange={set('place_name')} />

      <div className="rounded border border-[var(--line)] bg-[var(--paper-2)] p-3">
        <p className="text-[11px] leading-snug text-[var(--ink-2)]">
          Both of the next two are required, and the second one is the point. Unbounded claims of
          representation are the first failure mode of place-based organizing, and the easiest
          moment to make one is right now.
        </p>
        <div className="mt-2.5 space-y-2.5">
          <Field id="fr-rep" label="What and whom does it represent?" value={form.represents}
                 onChange={set('represents')} placeholder="the people who have signed up to it" />
          <Field id="fr-not" label="What and whom does it NOT represent?" value={form.does_not_represent}
                 onChange={set('does_not_represent')}
                 placeholder="the county, any nation, any rights-holder, or the watershed as a whole" />
        </div>
      </div>

      {error && <p className="text-xs text-[var(--clay)]">{error}</p>}

      <button type="submit" disabled={busy}
        className="flex items-center gap-1.5 rounded bg-[var(--moss)] px-3.5 py-2 text-xs font-medium text-white disabled:opacity-40">
        {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> resolving against the real world…</>
              : <>Begin <ArrowRight className="h-3.5 w-3.5" /></>}
      </button>
    </form>
  );
}

function Field({ id, label, value, onChange, placeholder }) {
  return (
    <div>
      <label htmlFor={id} className="text-[11px] text-[var(--ink-2)]">{label}</label>
      <input id={id} value={value} onChange={onChange} placeholder={placeholder}
        className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm
                   outline-none focus:border-[var(--moss)] placeholder:text-[var(--ink-3)]" />
    </div>
  );
}

/** The reveal lines carry **emphasis** on the names worth repeating out loud. */
function bold(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-medium">{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>);
}
