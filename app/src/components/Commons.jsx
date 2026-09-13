import React, { useEffect, useState } from 'react';
import {
  Loader2, ArrowRight, MapPin, Droplets, AlertTriangle, Sun, Flag, Users, HandHeart,
  Sprout, Globe2, CheckCircle2, Compass, Layers, KeyRound,
} from 'lucide-react';
import { callTool } from '../api.js';
import ToolForm from './ToolForm.jsx';
import GroundForAnyone from './GroundForAnyone.jsx';
import { verb } from '../verbs.js';

/**
 * The board.
 *
 * The front of this app used to be fifteen tabs named after the protocol's
 * stages — Listen, Signals, Quests, Convene, Measure. That is the system's
 * filing cabinet: complete, correct, and navigable only by somebody who
 * already knows the twelve-stage loop. The person who designed it could not
 * tell where to click, which is not a lapse of attention. It is what a taxonomy
 * built for completeness does to whoever has to stand in front of it.
 *
 * So this screen is arranged by what a person arrives looking for, in the order
 * they arrive looking for it: where am I, what can I do, what is going on, who
 * is here, what is around me. Nothing was removed — every tab still exists and
 * every one of these panels is a door into the matching one.
 *
 * Four rules it is built on:
 *
 *   THE LAND FIRST, ALWAYS. The headline is what the ground is doing, not what
 *   you owe. A page that only ever hands somebody their own debts does not get
 *   opened twice, and that is the whole argument of docs/DAILY_USE.md.
 *
 *   EVERY THING TO DO IS ONE CLICK FROM DONE. Not a link to a tab where the
 *   thing might be — the button that does it. The operator already knows which
 *   tool each item needs; the old interface simply never put it in reach.
 *
 *   FIVE THINGS, NOT THIRTY. A list of thirty is a list nobody starts. The
 *   rest is one click away rather than hidden, and the count is shown so the
 *   shortening is visible rather than a quiet omission.
 *
 *   A PROJECT SAYS WHAT IS ACTUALLY IN ITS WAY. Not its stage — a project can
 *   sit at co-design for a season with nothing blocking it, or at prototype
 *   with four gates open. The stage is the protocol's word; "three things in
 *   the way" is the answer to the question being asked.
 */
export default function Commons({ onGoTo, onChanged }) {
  const [b, setB] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState({});

  async function load() {
    setB(await callTool('commons_board', {}));
  }
  useEffect(() => { load(); }, []);

  // Some actions need nothing from a person. Opening a form to show them an
  // empty form is a step that exists only because the interface could not tell.
  const DIRECT = new Set(['locate_place', 'ingest_water_data', 'council_agenda',
    'carrying', 'place_attention', 'refresh_library']);

  async function act(item, key) {
    const a = item.action;
    if (!a) return;
    if (DIRECT.has(a.tool)) {
      setBusy((s) => ({ ...s, [key]: true }));
      await callTool(a.tool, a.input ?? {});
      setBusy((s) => ({ ...s, [key]: false }));
      await load(); onChanged?.();
    } else {
      setForm({ tool: a.tool, prefill: a.input ?? {} });
    }
  }

  if (!b) {
    return <div className="flex items-center gap-2 p-8 text-sm text-[var(--ink-2)]">
      <Loader2 className="h-4 w-4 animate-spin" /> looking around…
    </div>;
  }

  // Being refused is not the same as there being nothing here.
  //
  // Every error landed on the founding screen, so a stranger on the wifi — who
  // is refused `commons_board` because it is members-only — was shown "no
  // commons yet, find your bioregion", and the one button on it runs a tool
  // that is keyboard-only. A permission refusal wearing a welcome screen's
  // clothes, ending in a second refusal.
  if (b.error === 'not_from_here') {
    return (
      <div className="mx-auto max-w-lg p-8">
        <GroundForAnyone />
        <div className="mt-6 rounded border border-[var(--line)] px-4 py-3 text-center">
          <p className="text-sm">{b.message}</p>
          <p className="mt-1.5 text-xs text-[var(--ink-2)]">
            You can still bring something you noticed, or a need, without enrolling anything.
          </p>
          <a href="/join" className="mt-3 inline-block rounded bg-[var(--moss)] px-4 py-2 text-xs font-medium text-white">
            Bring something
          </a>
        </div>
      </div>
    );
  }

  // No commons yet. One thing to do, and it writes nothing.
  if (b.error) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <Compass className="mx-auto h-8 w-8 text-[var(--moss)]" />
        <p className="mt-3 text-sm">{b.message}</p>
        <button onClick={() => setForm({ tool: 'look_around', prefill: {} })}
          className="mt-4 rounded bg-[var(--moss)] px-4 py-2 text-xs font-medium text-white">
          Find my bioregion
        </button>
        {form && <ToolForm tool={form.tool} prefill={form.prefill}
                           onClose={() => setForm(null)}
                           onDone={() => { setForm(null); load(); onChanged?.(); }} />}
      </div>
    );
  }

  const h = b.here;

  return (
    <div className="space-y-4">
      {/* ── Where am I ──────────────────────────────────────────────────── */}
      <section className="rounded border border-[#CBDCCD] bg-[#F2F6F2] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="text-base font-medium">{h.chapter}</h2>
          <span className="text-[11px] text-[var(--ink-3)]">
            {[h.watershed, h.ecoregion?.name, h.ecoregion?.biome].filter(Boolean).join(' · ')}
          </span>
        </div>
        <p className="mt-1 text-sm leading-snug">{b.headline}</p>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {h.now.water && (
            <Bit Icon={Droplets} tone={h.now.water_stale ? 'warn' : 'plain'}>
              {h.now.water}{h.now.water_stale && ' — stale'}
            </Bit>
          )}
          {h.now.hazards.map((z, i) => (
            <Bit key={i} Icon={AlertTriangle} tone="warn">{z.severity}: {z.title}</Bit>
          ))}
          {h.now.season && <Bit Icon={Sun}>{h.now.season}</Bit>}
          {h.places.length > 0 && (
            <button onClick={() => onGoTo?.('atlas')}
              className="flex items-center gap-1.5 text-[11px] text-[var(--ink-2)] hover:text-[var(--moss)]">
              <MapPin className="h-3 w-3" />
              {h.places.length} place{h.places.length === 1 ? '' : 's'} on the map
            </button>
          )}
        </div>

        {!h.deputy && (
          // The single most consequential missing arrangement, and the one
          // nobody thinks about until the day it is too late to ask. A button,
          // not underlined text: this was the one action on the board still
          // drawn as a footnote.
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--clay)]">
            <span>Nobody holds this commons if {h.steward || 'you'} cannot.</span>
            <button onClick={() => setForm({ tool: 'name_deputy', prefill: {} })}
              className="rounded border border-[#E4C9C2] bg-[#FBF1EE] px-2.5 py-1 font-medium text-[var(--clay)] hover:border-[var(--clay)]">
              {verb('name_deputy')}
            </button>
          </div>
        )}
      </section>

      {/* ── What can I do ───────────────────────────────────────────────── */}
      <section>
        <Head Icon={Flag} label="What needs doing"
              note={b.todo_total > b.todo.length
                ? `${b.todo.length} of ${b.todo_total} — the rest are on Today`
                : b.todo.length ? 'Each one cites the rule it comes from' : null}
              onMore={b.todo_total > b.todo.length ? () => onGoTo?.('today') : null} />
        {b.todo.length === 0 ? (
          <Empty Icon={CheckCircle2}>
            Nothing is blocked, slipped or missing. That is rare — worth publishing a report
            while it is true.
          </Empty>
        ) : (
          <div className="space-y-2">
            {b.todo.map((t, i) => (
              <div key={i} className={`flex items-start gap-3 rounded border p-3 ${TONE[t.urgency] ?? TONE.open}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-[var(--paper)] px-1.5 py-0.5 text-[10px] text-[var(--ink-2)]">
                      {t.stage}
                    </span>
                    {t.age_days > 0 && <span className="text-[10px] text-[var(--ink-3)]">{t.age_days}d</span>}
                  </div>
                  <p className="mt-1 text-sm leading-snug">{t.title}</p>
                  {t.detail && <p className="mt-0.5 text-[11px] text-[var(--ink-2)]">{t.detail}</p>}
                  {t.why && <p className="mt-0.5 text-[10px] italic text-[var(--ink-3)]">{t.why}</p>}
                </div>
                <button onClick={() => act(t, i)} disabled={busy[i]}
                  className="flex shrink-0 items-center gap-1.5 rounded bg-[var(--moss)] px-3 py-1.5
                             text-[11px] font-medium text-white disabled:opacity-50">
                  {busy[i] ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                           : <>{verb(t.action.tool)} <ArrowRight className="h-3 w-3" /></>}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── What is going on ────────────────────────────────────────────── */}
      <section>
        <Head Icon={Sprout} label="Projects"
              note={b.projects_finished ? `${b.projects_finished} finished` : null}
              onMore={() => onGoTo?.('quests')} />
        {b.projects.length === 0 ? (
          <Empty Icon={Sprout}>
            No projects yet. One usually starts from something somebody noticed.
          </Empty>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {b.projects.map((p) => (
              <button key={p.id} onClick={() => onGoTo?.('quests')}
                className="rounded border border-[var(--line)] bg-[var(--paper-2)] p-3 text-left
                           hover:border-[var(--moss)]">
                <p className="text-xs font-medium leading-snug">{p.title}</p>
                <p className="mt-0.5 text-[10px] text-[var(--ink-3)]">
                  {String(p.stage).replace(/_/g, ' ')}
                  {p.ground && ` · ${p.ground}`}
                </p>
                <p className={`mt-1 text-[11px] ${p.blocking.length ? 'text-[var(--clay)]' : 'text-[var(--moss)]'}`}>
                  {p.state}
                </p>
                {p.blocking[0] && (
                  <p className="mt-0.5 text-[10px] leading-snug text-[var(--ink-3)]">{p.blocking[0]}</p>
                )}
                <p className="mt-1 text-[10px] text-[var(--ink-3)]">
                  {p.owner ? `kept alive by ${p.owner}` : 'nobody is named to keep this alive'}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Who is here ─────────────────────────────────────────────────── */}
      {(b.people.length > 0 || b.could_help.length > 0) && (
        <section>
          <Head Icon={Users} label="People" onMore={() => onGoTo?.('exchange')}
                aside={
                  <button onClick={() => onGoTo?.('devices')}
                    className="flex items-center gap-1 rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--moss)]">
                    <KeyRound className="h-3 w-3" /> {verb('invite_device')}
                  </button>
                } />
          {b.people.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {b.people.map((p) => (
                <span key={p.name}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${p.overloaded
                    ? 'border-[#E4C9C2] bg-[#FBF1EE] text-[var(--clay)]'
                    : 'border-[var(--line)] bg-[var(--paper-2)] text-[var(--ink-2)]'}`}>
                  {p.name}
                  <span className="text-[var(--ink-3)]"> · {p.holding}</span>
                  {p.is_organisation && <span className="text-[var(--ink-3)]"> · group</span>}
                </span>
              ))}
            </div>
          )}
          {b.could_help.map((c, i) => (
            <div key={i} className="mb-1 flex items-start gap-1.5 text-[11px] leading-snug">
              <HandHeart className="mt-0.5 h-3 w-3 shrink-0 text-[var(--ink-3)]" />
              <span>
                <span className="text-[var(--ink-2)]">{c.need}</span>
                {' — '}
                {c.could.map((x) => x.who).join(', ')}
                <span className="text-[var(--ink-3)]">
                  {' '}{c.could[0].where === 'here' ? 'have' : 'has'} done something like it
                </span>
              </span>
            </div>
          ))}
        </section>
      )}

      {/* ── What is around me ───────────────────────────────────────────── */}
      <section>
        <Head Icon={Globe2} label="Around you" onMore={() => onGoTo?.('federation')} />
        <div className="rounded border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2.5">
          {b.around.life && (
            <p className="text-[11px] leading-snug text-[var(--ink-2)]">
              <Layers className="mr-1 inline h-3 w-3" />
              {b.around.life.plants_recorded} plants, {b.around.life.animals_recorded} animals,{' '}
              {b.around.life.insects_recorded} insects recorded here
              {b.around.life.threatened_count > 0 && `; ${b.around.life.threatened_count} threatened`}.
            </p>
          )}
          {b.around.within_reach && (
            <p className="mt-1 text-[11px] leading-snug text-[var(--ink-2)]">{b.around.within_reach}</p>
          )}
          {!h.region_downloaded && (
            <p className="text-[11px] leading-snug text-[var(--ink-2)]">
              This ecoregion has not been downloaded, so nothing is known here yet beyond its name.
            </p>
          )}
          {b.around.neighbours.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 border-t border-[var(--line)] pt-1.5">
              {b.around.neighbours.slice(0, 3).map((n, i) => (
                <li key={i} className="text-[10px] leading-snug text-[var(--ink-3)]">
                  <a href={n.url} target="_blank" rel="noreferrer noopener"
                     className="text-[var(--ink-2)] hover:text-[var(--moss)]">{n.name}</a>
                  {n.is_chapter && <span className="text-[var(--moss)]"> · chapter</span>}
                  {' — '}{n.line}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {form && (
        <ToolForm tool={form.tool} prefill={form.prefill}
                  onClose={() => setForm(null)}
                  onDone={() => { setTimeout(() => { setForm(null); load(); onChanged?.(); }, 1200); }} />
      )}
    </div>
  );
}

const TONE = {
  blocking: 'border-[#E4C9C2] bg-[#FBF1EE]',
  slipped: 'border-[#E8DCB8] bg-[#FBF3DC]',
  gap: 'border-[#CFDDE3] bg-[#EDF2F4]',
  open: 'border-[var(--line)] bg-[var(--paper-2)]',
};

// One label per tool, from ../verbs.js. This used to be a third copy of the
// same map, already drifted from the other two in eight places.

function Head({ Icon, label, note, onMore, aside }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-[var(--ink-3)]" />
      <h3 className="text-xs font-medium">{label}</h3>
      {note && <span className="text-[11px] text-[var(--ink-3)]">{note}</span>}
      <span className="ml-auto flex items-center gap-2">
        {aside}
        {onMore && (
          <button onClick={onMore} className="text-[11px] text-[var(--ink-3)] hover:text-[var(--moss)]">
            all of it →
          </button>
        )}
      </span>
    </div>
  );
}

function Bit({ Icon, tone = 'plain', children }) {
  return (
    <span className={`flex items-center gap-1.5 text-[11px] ${
      tone === 'warn' ? 'text-[var(--clay)]' : 'text-[var(--ink-2)]'}`}>
      <Icon className="h-3 w-3 shrink-0" />{children}
    </span>
  );
}

function Empty({ Icon, children }) {
  return (
    <div className="flex items-start gap-2 rounded border border-dashed border-[var(--line)]
                    bg-[var(--paper-2)] px-3 py-2.5 text-[11px] leading-snug text-[var(--ink-2)]">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />
      <span>{children}</span>
    </div>
  );
}
