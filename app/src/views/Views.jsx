import React from 'react';
import TheGround, { BaselineOffer } from '../components/TheGround.jsx';
import LandSeat from '../components/LandSeat.jsx';
import {
  CheckCircle2, XCircle, AlertTriangle, Droplets, Users, Scale,
  RefreshCw, BookOpen, Shield, Clock, MapPin,
} from 'lucide-react';

export const Card = ({ children, className = '' }) => (
  <div className={`rounded border border-[var(--line)] bg-[var(--paper)] p-4 ${className}`}>{children}</div>
);
export const H = ({ children, sub }) => (
  <div className="mb-3">
    <h2 className="text-base font-medium">{children}</h2>
    {sub && <p className="mt-0.5 text-xs text-[var(--ink-2)]">{sub}</p>}
  </div>
);
export const Pill = ({ tone = 'neutral', children }) => {
  const tones = {
    neutral: 'bg-[var(--line-2)] text-[var(--ink-2)]',
    good: 'bg-[#E6EFE7] text-[var(--moss)]',
    warn: 'bg-[#FBF3DC] text-[#8A6D1F]',
    bad: 'bg-[#FBF1EE] text-[var(--clay)]',
    water: 'bg-[#E6EEF1] text-[var(--water)]',
  };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tones[tone]}`}>{children}</span>;
};
const sevTone = (s) => ({ Critical: 'bad', Watch: 'warn' }[s] ?? 'water');

// ── My Place ──────────────────────────────────────────────────────────────
export function MyPlace({ data, onFocus }) {
  const d = data?.dashboard;
  const v = data?.viability;
  const c = data?.chapter;
  if (!c) return <Empty>No chapter yet. Run <code>npm run seed</code>, or ask the assistant to create one.</Empty>;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-medium">{c.name}</h2>
          <Pill>{c.scale}</Pill>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Represents</div>
            <p className="text-xs text-[var(--ink-2)]">{c.represents}</p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Does not represent</div>
            <p className="text-xs text-[var(--ink-2)]">{c.does_not_represent}</p>
          </div>
        </div>
      </Card>

      <TheGround />

      {v && (
        <Card>
          <H sub="Ten questions from the manual. A chapter is viable only when all ten are yes.">
            Minimum Viable Chapter Test — {v.passed}/{v.total}
          </H>
          <div className="space-y-1.5">
            {v.checks.map((k) => (
              <div key={k.id} className="flex items-start gap-2 text-xs">
                {k.pass
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--moss)]" />
                  : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--clay)]" />}
                <div>
                  <div className={k.pass ? 'text-[var(--ink-2)]' : 'text-[var(--ink)]'}>{k.q}</div>
                  {!k.pass && <div className="text-[var(--clay)]">→ {k.fix}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <H sub="Leads with what is unresolved.">Seasonal dashboard</H>
          <Row label="Critical signals" value={d?.critical?.length ?? 0} tone={d?.critical?.length ? 'bad' : 'good'} />
          <Row label="Watch signals" value={d?.watch?.length ?? 0} tone={d?.watch?.length ? 'warn' : 'good'} />
          <Row label="Unverified signals" value={d?.unverified_signals ?? 0} />
          <Row label="Places not yet located" value={d?.unlocated?.length ?? 0} tone={d?.unlocated?.length ? 'warn' : 'good'} />
          <Row label="Indicators overdue" value={d?.indicators_overdue?.length ?? 0} tone={d?.indicators_overdue?.length ? 'warn' : 'good'} />
          {d?.water_last_seen && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--ink-3)]">
              <Droplets className="h-3 w-3" /> live water data as of {d.water_last_seen}
            </div>
          )}
        </Card>
        <Card>
          <H sub="Who carried the work, and whether value returned.">Benefit flow</H>
          <Row label="Paid hours" value={data?.benefit?.paid_hours ?? 0} />
          <Row label="Volunteer hours" value={data?.benefit?.volunteer_hours ?? 0} />
          {data?.benefit?.warning && (
            <div className="mt-2 flex items-start gap-2 rounded bg-[#FBF3DC] px-2 py-1.5 text-[11px] text-[#8A6D1F]">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{data.benefit.warning}
            </div>
          )}
          {!!data?.care_gaps?.length && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Gatherings missing care provision</div>
              {data.care_gaps.map((g) => <div key={g.id} className="text-xs text-[var(--clay)]">· {g.title}</div>)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
const Row = ({ label, value, tone }) => (
  <div className="flex items-center justify-between border-b border-[var(--line-2)] py-1.5 last:border-0 text-xs">
    <span className="text-[var(--ink-2)]">{label}</span>
    <Pill tone={tone ?? 'neutral'}>{value}</Pill>
  </div>
);
export const Empty = ({ children }) => (
  <div className="rounded border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-2)]">{children}</div>
);

// ── Signals ───────────────────────────────────────────────────────────────
export function Signals({ signals, onFocus }) {
  const manual = signals.filter((s) => s.source_adapter !== 'usgs');
  const live = signals.filter((s) => s.source_adapter === 'usgs');
  return (
    <div className="space-y-4">
      <H sub="Observations from land and people. Verification is a human act.">Signals</H>
      {manual.map((s) => (
        <Card key={s.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Pill tone={sevTone(s.severity)}>{s.severity}</Pill>
                <Pill>{s.category}</Pill>
                {!s.verified && <Pill tone="warn">unverified</Pill>}
              </div>
              <h3 className="mt-1.5 text-sm font-medium">{s.title}</h3>
              <p className="mt-1 text-xs text-[var(--ink-2)]">{s.description}</p>
              <div className="mt-1.5 text-[11px] text-[var(--ink-3)]">{s.location_name} · {s.author}</div>
            </div>
            {s.lat != null && (
              <button onClick={() => onFocus({ lat: s.lat, lng: s.lng })}
                className="shrink-0 rounded border border-[var(--line)] p-1.5 hover:border-[var(--moss)]" title="Show on map">
                <MapPin className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </Card>
      ))}
      {!!live.length && (
        <Card>
          <H sub={`${live.length} live USGS gage readings, public domain. Refreshed by the Bioregional engine.`}>
            Automated water signals
          </H>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {live.slice(0, 60).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 border-b border-[var(--line-2)] py-1 text-xs last:border-0">
                <span className="truncate text-[var(--ink-2)]">{s.title}</span>
                <span className="shrink-0 font-mono text-[11px]">{s.quantity_value} {s.quantity_unit}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Quests ────────────────────────────────────────────────────────────────
export function Quests({ quests, gates, onLoadGates, onFocus, onAct }) {
  return (
    <div className="space-y-4">
      <H sub="A high score never overrides a red flag, missing consent, or a missing maintenance owner.">
        Quests
      </H>
      {quests.map((q) => {
        const g = gates[q.id];
        const open = g?.filter((x) => x.required && !x.satisfied) ?? null;
        return (
          <Card key={q.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={q.status === 'Complete' ? 'good' : 'neutral'}>{q.status}</Pill>
                  <Pill>{q.stage.replace(/_/g, ' ')}</Pill>
                  {q.category && <Pill>{q.category}</Pill>}
                </div>
                <h3 className="mt-1.5 text-sm font-medium">{q.title}</h3>
                <p className="mt-1 text-xs text-[var(--ink-2)]">{q.description}</p>
              </div>
              {q.lat != null && (
                <button onClick={() => onFocus({ lat: q.lat, lng: q.lng })}
                  className="shrink-0 rounded border border-[var(--line)] p-1.5 hover:border-[var(--moss)]">
                  <MapPin className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-3 border-t border-[var(--line-2)] pt-2">
              {!g ? (
                <button onClick={() => onLoadGates(q.id)}
                  className="text-[11px] text-[var(--moss)] underline">check consent &amp; safety gates</button>
              ) : (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
                    Gates — {open.length ? `${open.length} open` : 'all satisfied'}
                  </div>
                  {g.map((x) => (
                    <div key={x.gate} className="flex items-center gap-2 text-[11px]">
                      {x.satisfied
                        ? <CheckCircle2 className="h-3 w-3 text-[var(--moss)]" />
                        : <XCircle className="h-3 w-3 text-[var(--clay)]" />}
                      <span className={x.satisfied ? 'text-[var(--ink-3)]' : 'text-[var(--ink)]'}>
                        {x.gate.replace(/_/g, ' ')}
                      </span>
                      {!x.satisfied && onAct && (
                        <button onClick={() => onAct('satisfy_quest_gate', { quest_id: q.id, gate: x.gate })}
                          className="ml-auto text-[10px] text-[var(--moss)] underline">close it</button>
                      )}
                    </div>
                  ))}
                  {onAct && (
                    <div className="flex gap-3 pt-1.5">
                      <button onClick={() => onAct('update_quest', { quest_id: q.id })}
                        className="text-[10px] text-[var(--moss)] underline">define the project</button>
                      <button onClick={() => onAct('advance_quest', { quest_id: q.id })}
                        className="text-[10px] text-[var(--moss)] underline">advance a stage</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── Council ───────────────────────────────────────────────────────────────
export function Council({ decisions, due, onAct }) {
  return (
    <div className="space-y-4">
      <H sub="Every agenda item carries a Land Seat report. Irreversible items need a heavier method.">
        Council
      </H>

      {/* Above the agenda, because the report is written here and read later.
          The measurements were always on this machine and never on this page. */}
      <LandSeat />
      {!!due?.length && (
        <Card className="border-[#E4C9C2] bg-[#FBF1EE]">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--clay)]">
            <Clock className="h-3.5 w-3.5" /> {due.length} decision{due.length === 1 ? '' : 's'} due for review
          </div>
          {due.map((d) => <div key={d.id} className="mt-1 text-xs text-[var(--ink-2)]">· {d.title} ({d.review_date})</div>)}
        </Card>
      )}
      {decisions.map((d) => (
        <Card key={d.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={d.status === 'decided' ? 'good' : 'warn'}>{d.status}</Pill>
            <Pill>{d.method.replace(/_/g, ' ')}</Pill>
            <Pill>{d.scale}</Pill>
            {!d.reversible && <Pill tone="bad">irreversible</Pill>}
          </div>
          <h3 className="mt-1.5 text-sm font-medium">{d.title}</h3>
          <p className="mt-1 text-xs text-[var(--ink-2)]">{d.body}</p>
          {d.red_flags && (
            <div className="mt-2 flex items-start gap-2 rounded bg-[#FBF1EE] px-2 py-1.5 text-[11px] text-[var(--clay)]">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span><b>Red flag:</b> {d.red_flags}</span>
            </div>
          )}
          <div className="mt-2 rounded bg-[var(--paper-2)] px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
              <Scale className="h-3 w-3" /> Land Seat — {d.land_seat_steward ?? 'unassigned'}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ink-2)]">{d.land_seat_report}</p>
          </div>
          {d.review_date && <div className="mt-2 text-[11px] text-[var(--ink-3)]">Review: {d.review_date}</div>}
          {onAct && (
            <div className="mt-2 flex gap-3 border-t border-[var(--line-2)] pt-2">
              {d.red_flags && (
                <button onClick={() => onAct('clear_red_flag', { decision_id: d.id })}
                  className="text-[11px] text-[var(--clay)] underline">resolve the red flag</button>
              )}
              {d.status !== 'decided' && (
                <button onClick={() => onAct('decide_council_item', { decision_id: d.id })}
                  className="text-[11px] text-[var(--moss)] underline">decide this</button>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Simple list views ─────────────────────────────────────────────────────
export function Gatherings({ gatherings }) {
  const care = (g) => ['care_meals', 'care_transport', 'care_childcare', 'care_accessibility']
    .filter((k) => g[k]).length;
  return (
    <div className="space-y-4">
      <H sub="Care provision is infrastructure, not catering. Fewer than two provisions is flagged.">Gatherings</H>
      {gatherings.map((g) => (
        <Card key={g.id}>
          <div className="flex items-center gap-2">
            <Pill>{g.kind}</Pill>
            <Pill tone={care(g) >= 2 ? 'good' : 'bad'}>{care(g)}/4 care</Pill>
          </div>
          <h3 className="mt-1.5 text-sm font-medium">{g.title}</h3>
          <p className="mt-1 text-xs text-[var(--ink-2)]">{g.description}</p>
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--ink-3)]">
            <span>{g.starts_at}</span><span>{g.location_name}</span>
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{g.rsvp_count}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function Exchange({ exchange }) {
  return (
    <div className="space-y-4">
      <H sub="Contributions as ValueFlows economic events — exportable to hREA or Bonfire.">Exchange &amp; Care</H>
      {exchange?.events?.map((e) => (
        <Card key={e.id}>
          <div className="flex items-center gap-2">
            <Pill tone={e.relationship === 'volunteer' ? 'neutral' : 'good'}>{e.relationship.replace(/_/g, ' ')}</Pill>
            <Pill>{e.vf_action}</Pill>
            {!e.terms_ack && e.relationship !== 'volunteer' && <Pill tone="bad">terms not acknowledged</Pill>}
          </div>
          <h3 className="mt-1.5 text-sm font-medium">{e.resource_name}</h3>
          <p className="mt-1 text-xs text-[var(--ink-2)]">{e.note}</p>
          <div className="mt-1.5 text-[11px] text-[var(--ink-3)]">
            {e.provider_name} · {e.vf_quantity} {e.vf_unit}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function Learn({ learn, doctrine }) {
  return (
    <div className="space-y-4">
      <H sub="Knowledge written so it can travel without extracting the place it came from.">Learn</H>
      {learn.map((l) => (
        <Card key={l.id}>
          <div className="flex items-center gap-2">
            <Pill>{l.kind}</Pill><Pill tone={l.travels ? 'good' : 'bad'}>{l.travels ? 'may travel' : 'stays here'}</Pill>
            <Pill>{l.license}</Pill>
          </div>
          <h3 className="mt-1.5 text-sm font-medium">{l.title}</h3>
          <p className="mt-1 text-xs text-[var(--ink-2)]">{l.summary}</p>
        </Card>
      ))}
      {doctrine && (
        <Card>
          <H sub={doctrine.source}>The doctrine this OS runs on</H>
          <p className="text-xs italic text-[var(--ink-2)]">{doctrine.operating_sentence}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">The double mandate</div>
              {doctrine.double_mandate.map((m) => <div key={m} className="text-xs text-[var(--ink-2)]">· {m}</div>)}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">AI may not decide</div>
              <div className="text-xs text-[var(--ink-2)]">{doctrine.ai_may_not_decide.join(' · ')}</div>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">The twelve-stage living loop</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {doctrine.living_loop.map((s) => (
                <span key={s.stage} className="rounded bg-[var(--line-2)] px-1.5 py-0.5 text-[10px]">
                  {s.stage}. {s.name}
                </span>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export function Federation({ peers, onDiscover, discovering }) {
  return (
    <div className="space-y-4">
      <H sub="Chapters that share without merging. Discovery runs over the Murmurations protocol.">Federation</H>
      <button onClick={onDiscover} disabled={discovering}
        className="flex items-center gap-2 rounded bg-[var(--moss)] px-3 py-2 text-xs text-white disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${discovering ? 'animate-spin' : ''}`} />
        Discover neighbours on the Murmurations network
      </button>
      {peers.map((p) => (
        <Card key={p.id}>
          <div className="flex items-center gap-2">
            <Pill tone={p.status === 'connected' ? 'good' : 'neutral'}>{p.status}</Pill>
            <Pill>{p.protocol}</Pill>
          </div>
          <h3 className="mt-1.5 text-sm font-medium">{p.name}</h3>
          {p.bioregion_name && <div className="text-xs text-[var(--ink-2)]">{p.bioregion_name}</div>}
          {p.url && <a href={p.url} target="_blank" rel="noreferrer"
            className="mt-1 block truncate text-[11px] text-[var(--water)] underline">{p.url}</a>}
        </Card>
      ))}
    </div>
  );
}

// ── Stage 2: Listen ───────────────────────────────────────────────────────
export function Listen({ intake }) {
  const waiting = intake.filter((i) => i.status === 'received');
  const answered = intake.filter((i) => i.status !== 'received');
  return (
    <div className="space-y-4">
      <H sub="The front door. Someone brings a need; the commons answers and can be appealed.">
        Listen
      </H>
      {intake.length === 0 && (
        <Empty>
          Nothing has been brought yet. Until one person submits a need and receives a response,
          the chapter fails its own viability test.
        </Empty>
      )}
      {!!waiting.length && (
        <div className="text-[10px] uppercase tracking-wide text-[var(--clay)]">
          Waiting for an answer — {waiting.length}
        </div>
      )}
      {[...waiting, ...answered].map((i) => (
        <Card key={i.id} className={i.status === 'received' ? 'border-[#E4C9C2]' : ''}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={i.status === 'received' ? 'bad' : i.status === 'declined' ? 'warn' : 'good'}>
              {i.status.replace(/_/g, ' ')}
            </Pill>
            <Pill>{i.kind}</Pill>
            {i.private ? <Pill tone="warn">private</Pill> : null}
          </div>
          <p className="mt-2 text-sm">{i.body}</p>
          <div className="mt-1.5 text-[11px] text-[var(--ink-3)]">
            {i.submitted_by || 'anonymous'}{i.affected_parties ? ` · affects: ${i.affected_parties}` : ''}
          </div>
          {i.response && (
            <div className="mt-2 border-l-2 border-[var(--moss)] pl-2.5">
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Response</div>
              <p className="text-xs text-[var(--ink-2)]">{i.response}</p>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Stage 11: Measure ─────────────────────────────────────────────────────
export function Measure({ indicators, onAct, onRefresh }) {
  return (
    <div className="space-y-4">
      <H sub="An indicator without a decision trigger is decoration. Monitoring has to be able to change a decision.">
        Measure
      </H>
      {indicators.length === 0 && (
        <Empty>Nothing is being measured yet. Add an indicator with a baseline and a decision trigger.</Empty>
      )}
      {indicators.map((n) => {
        const moved = n.latest_value != null && n.baseline_value != null
          ? n.latest_value - n.baseline_value : null;
        const wanted = n.target_value != null && n.baseline_value != null
          ? n.target_value - n.baseline_value : null;
        const toward = moved != null && wanted != null
          ? (Math.sign(moved) === Math.sign(wanted) || moved === 0) : null;
        const overdue = n.target_by && new Date(n.target_by) < new Date() && !n.measurement_count;
        return (
          <Card key={n.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={n.measurement_count ? (toward === false ? 'bad' : 'good') : 'warn'}>
                {n.measurement_count ? `${n.measurement_count} reading${n.measurement_count === 1 ? '' : 's'}` : 'never measured'}
              </Pill>
              {overdue && <Pill tone="bad">target date passed</Pill>}
              {toward === false && <Pill tone="bad">moving away from target</Pill>}
            </div>
            <h3 className="mt-1.5 text-sm font-medium">{n.name}</h3>
            <div className="mt-2 flex flex-wrap gap-4 text-xs">
              <Stat label="Baseline" value={fmt(n.baseline_value, n.unit)} sub={n.baseline_at} />
              <Stat label="Latest" value={n.latest_value != null ? fmt(n.latest_value, n.unit) : '—'} sub={n.latest_at} />
              <Stat label="Target" value={fmt(n.target_value, n.unit)} sub={n.target_by} />
            </div>
            {n.method && <p className="mt-2 text-[11px] text-[var(--ink-3)]"><b>Method:</b> {n.method}</p>}
            {/* An indicator with no baseline cannot fire its own trigger. The
                open record may have one; this is the only way a person can
                reach it without Claude Code. */}
            {n.baseline_value == null && <BaselineOffer indicator={n} onApplied={onRefresh} />}
            {n.decision_trigger && (
              <div className="mt-2 rounded bg-[var(--paper-2)] px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Decision trigger</div>
                <p className="text-[11px] text-[var(--ink-2)]">{n.decision_trigger}</p>
              </div>
            )}
            {n.stewardship_horizon && (
              <p className="mt-1.5 text-[11px] text-[var(--ink-3)]"><b>After the project:</b> {n.stewardship_horizon}</p>
            )}
            {onAct && (
              <button onClick={() => onAct('record_measurement', { indicator_id: n.id })}
                className="mt-2 rounded border border-[var(--line)] px-2.5 py-1 text-[11px] hover:border-[var(--moss)]">
                Record a reading
              </button>
            )}
          </Card>
        );
      })}
    </div>
  );
}
const Stat = ({ label, value, sub }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">{label}</div>
    <div className="font-mono text-sm">{value}</div>
    {sub && <div className="text-[10px] text-[var(--ink-3)]">{String(sub).slice(0, 10)}</div>}
  </div>
);
const fmt = (v, u) => (v == null ? '—' : `${v}${u ? ' ' + u : ''}`);
