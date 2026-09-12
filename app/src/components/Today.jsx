import React, { useEffect, useState } from 'react';
import {
  AlertOctagon, Clock, CircleDashed, Circle, ArrowRight, Loader2, CheckCircle2, RotateCw,
} from 'lucide-react';
import { callTool } from '../api.js';
import ToolForm from './ToolForm.jsx';

const KIND = {
  blocking: { label: 'Blocking',   icon: AlertOctagon,  cls: 'text-[var(--clay)]',  bg: 'bg-[#FBF1EE] border-[#E4C9C2]',
              blurb: 'Other work cannot move until this does.' },
  slipped:  { label: 'Slipped',    icon: Clock,         cls: 'text-[#8A6D1F]',      bg: 'bg-[#FBF3DC] border-[#E8DCB8]',
              blurb: 'A date the commons committed to has passed.' },
  gap:      { label: 'Missing',    icon: CircleDashed,  cls: 'text-[var(--water)]', bg: 'bg-[#EDF2F4] border-[#CFDDE3]',
              blurb: 'The protocol expects this to exist and it does not.' },
  open:     { label: 'Waiting',    icon: Circle,        cls: 'text-[var(--ink-3)]', bg: 'bg-[var(--paper-2)] border-[var(--line)]' },
};

export default function Today({ onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [ran, setRan] = useState({});

  async function load() {
    setBusy(true);
    const r = await callTool('whats_next', {});
    setData(r); setBusy(false);
  }
  useEffect(() => { load(); }, []);

  /** Some actions need no human input — run them directly rather than showing an empty form. */
  const DIRECT = new Set(['locate_place', 'ingest_water_data', 'council_agenda']);

  async function act(item, idx) {
    const a = item.action;
    if (!a) return;
    if (DIRECT.has(a.tool)) {
      setRan((s) => ({ ...s, [idx]: 'running' }));
      const out = await callTool(a.tool, a.input ?? {});
      setRan((s) => ({ ...s, [idx]: out?.error ? `error: ${out.message || out.error}` : 'done' }));
      await load(); onChanged?.();
    } else {
      setForm({ tool: a.tool, prefill: a.input ?? {} });
    }
  }

  if (!data) {
    return <div className="flex items-center gap-2 p-8 text-sm text-[var(--ink-2)]">
      <Loader2 className="h-4 w-4 animate-spin" /> reading the commons…
    </div>;
  }
  if (data.error) return <div className="p-8 text-sm text-[var(--ink-2)]">No chapter yet.</div>;

  const groups = ['blocking', 'slipped', 'gap', 'open']
    .map((k) => [k, data.items.filter((i) => i.kind === k)])
    .filter(([, list]) => list.length);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">What needs doing</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">
            Every stage of the loop, checked against the protocol. Each item says which rule it comes from,
            so you can disagree with it.
          </p>
        </div>
        <button onClick={load} disabled={busy}
          className="ml-auto shrink-0 rounded border border-[var(--line)] p-1.5 hover:border-[var(--moss)]" title="Re-check">
          <RotateCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {data.total === 0 && (
        <div className="rounded border border-[#CBDCCD] bg-[#EEF4EF] p-6 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-[var(--moss)]" />
          <p className="mt-2 text-sm">Nothing is blocked, slipped or missing.</p>
          <p className="mt-1 text-xs text-[var(--ink-2)]">
            That is rare. Worth publishing a State of the Bioregion report while it is true.
          </p>
        </div>
      )}

      {data.first && (
        <div className="rounded border border-[var(--gold)] bg-[#FCFAF2] p-4">
          <div className="text-[10px] uppercase tracking-wide text-[#8A6D1F]">Start here</div>
          <h3 className="mt-1 text-sm font-medium">{data.first.title}</h3>
          {data.first.detail && <p className="mt-1 text-xs text-[var(--ink-2)]">{data.first.detail}</p>}
          {data.first.action && (
            <button onClick={() => act(data.first, 'first')}
              className="mt-3 flex items-center gap-1.5 rounded bg-[var(--moss)] px-3 py-1.5 text-xs font-medium text-white">
              {label(data.first.action.tool)} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {groups.map(([kind, list]) => {
        const K = KIND[kind], I = K.icon;
        return (
          <section key={kind}>
            <div className="mb-2 flex items-baseline gap-2">
              <I className={`h-3.5 w-3.5 ${K.cls}`} />
              <h3 className="text-xs font-medium">{K.label} · {list.length}</h3>
              {K.blurb && <span className="text-[11px] text-[var(--ink-3)]">{K.blurb}</span>}
            </div>
            <div className="space-y-2">
              {list.map((item, i) => {
                const idx = `${kind}-${i}`;
                return (
                  <div key={idx} className={`rounded border p-3 ${K.bg}`}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-[var(--paper)] px-1.5 py-0.5 text-[10px] text-[var(--ink-2)]">
                            {item.stage}
                          </span>
                          {item.age_days > 0 && (
                            <span className="text-[10px] text-[var(--ink-3)]">{item.age_days}d</span>
                          )}
                        </div>
                        <h4 className="mt-1 text-sm">{item.title}</h4>
                        {item.detail && <p className="mt-0.5 text-xs text-[var(--ink-2)]">{item.detail}</p>}
                        {item.rule && (
                          <p className="mt-1.5 border-l-2 border-[var(--line)] pl-2 text-[11px] italic text-[var(--ink-3)]">
                            {item.rule}
                          </p>
                        )}
                        {ran[idx] && ran[idx] !== 'running' && (
                          <p className="mt-1.5 text-[11px] text-[var(--moss)]">{ran[idx]}</p>
                        )}
                      </div>
                      {item.action && (
                        <button onClick={() => act(item, idx)} disabled={ran[idx] === 'running'}
                          className="shrink-0 rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5
                                     text-[11px] font-medium hover:border-[var(--moss)] disabled:opacity-50">
                          {ran[idx] === 'running'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : label(item.action.tool)}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {form && (
        <ToolForm tool={form.tool} prefill={form.prefill}
                  onClose={() => setForm(null)}
                  onDone={() => { setTimeout(() => { setForm(null); load(); onChanged?.(); }, 1400); }} />
      )}
    </div>
  );
}

const LABELS = {
  respond_to_intake: 'Respond', locate_place: 'Locate it', ingest_water_data: 'Pull water data',
  open_quest: 'Open a project', satisfy_quest_gate: 'Close a gate', update_quest: 'Define it',
  add_indicator: 'Add indicator', record_measurement: 'Record a reading',
  clear_red_flag: 'Resolve flag', decide_council_item: 'Decide', council_agenda: 'Open agenda',
  publish_learning: 'Write it up', add_gathering: 'Add care',
};
const label = (tool) => LABELS[tool] ?? tool.replace(/_/g, ' ');
