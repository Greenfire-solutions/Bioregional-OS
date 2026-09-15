import React, { useCallback, useEffect, useState } from 'react';
import {
  Coins, Scale, ArrowRight, AlertTriangle, CheckCircle2, Loader2, Plus, Undo2, Package,
} from 'lucide-react';
import { get } from '../api.js';
import { verb } from '../verbs.js';

/**
 * The economy, if this commons has made one.
 *
 * The screen has to carry an argument, not just numbers, because the first
 * thing anybody meets here is an empty page and the question "what would we
 * even count?". So the empty state explains the two shapes a commons actually
 * chooses between, in a sentence each, and names the decision it takes to
 * start — which is a council decision, because that is where this OS keeps its
 * government.
 *
 * Every figure shown is added up from the entries by the engine. Nothing here
 * reads a stored balance, because there is no such column anywhere and there
 * must never be one.
 */
export default function Ledger({ onAct, onGoTo }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await get('ledger')); } catch { setData(null); }
    setBusy(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (busy && !data) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-[var(--ink-2)]">
        <Loader2 className="h-4 w-4 animate-spin" /> adding it up…
      </div>
    );
  }

  const currencies = data?.currencies ?? [];
  const pools = data?.pools ?? [];
  const entries = data?.entries ?? [];
  const audit = data?.check;

  return (
    <div className="space-y-5">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium">The ledger</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">
            {audit?.sentence ?? 'What this commons counts, and whether it adds up.'}
          </p>
        </div>
        {!!currencies.length && (
          <button onClick={() => onAct?.('define_currency', {})}
            className="flex shrink-0 items-center gap-1.5 rounded border border-[var(--line)] px-3 py-1.5
                       text-xs text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--moss)]">
            <Plus className="h-3.5 w-3.5" />Another unit
          </button>
        )}
      </div>

      {/* The check, first and always. A ledger nobody ever checks is a
          spreadsheet with a trigger on it — so the answer is at the top of the
          page rather than behind a button somebody has to know to press. */}
      {audit && !!currencies.length && (
        <div className={`flex items-start gap-2 rounded border px-3 py-2 text-[11px] leading-snug ${
          audit.ok
            ? 'border-[var(--line)] bg-[var(--paper-2)] text-[var(--ink-2)]'
            : 'border-[#E4C9C2] bg-[#FBF1EE] text-[var(--clay)]'}`}>
          {audit.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--moss)]" />
                    : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <div>
            <div>{audit.sentence}</div>
            {!audit.ok && (
              <ul className="mt-1 list-disc pl-4">
                {audit.problems.slice(0, 5).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {!currencies.length ? <Empty onAct={onAct} onGoTo={onGoTo} /> : (
        <>
          <div className="space-y-3">
            {currencies.map((c) => (
              <CurrencyCard key={c.id} currency={c} onAct={onAct}
                            open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
            ))}
          </div>

          <section>
            <SectionHead icon={Package}>Pools — what the units are good for</SectionHead>
            {!pools.length ? (
              <p className="text-[11px] leading-snug text-[var(--ink-3)]">
                None yet. A currency with no pool is not broken — it is a promise between people,
                which is what mutual credit is. A pool is for when you want to say what backs it.
              </p>
            ) : (
              <div className="space-y-2">
                {pools.map((p) => (
                  <div key={p.id} className="rounded border border-[var(--line)] bg-[var(--paper)] p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h4 className="text-sm">{p.name}</h4>
                      <span className="text-[11px] text-[var(--ink-3)]">holds {p.holds}</span>
                      <span className="ml-auto text-[11px] tabular-nums text-[var(--ink-3)]">
                        {p.taken_in} {p.currency_name} redeemed
                      </span>
                    </div>
                    {p.terms && <p className="mt-1 text-[11px] text-[var(--ink-2)]">{p.terms}</p>}
                    <button onClick={() => onAct?.('redeem_credit', { pool_id: p.id })}
                      className="mt-2 rounded border border-[var(--line)] px-2.5 py-1 text-[11px]
                                 text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--moss)]">
                      {verb('redeem_credit')}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => onAct?.('open_pool', {})}
              className="mt-2 flex items-center gap-1 rounded border border-[var(--line)] px-2.5 py-1
                         text-[11px] text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--moss)]">
              <Plus className="h-3 w-3" />Open a pool
            </button>
          </section>

          <section>
            <SectionHead icon={Scale}>The entries</SectionHead>
            <p className="mb-2 text-[10px] leading-snug text-[var(--ink-3)]">
              The record every figure above is added up from. Nothing here is ever deleted or
              edited — a mistake is reversed, and both stay.
            </p>
            <div className="divide-y divide-[var(--line-2)] rounded border border-[var(--line)]">
              {entries.map((e) => (
                <div key={e.id} className="flex items-baseline gap-2 px-3 py-1.5 text-[11px]">
                  <span className={`w-20 shrink-0 tabular-nums ${
                    e.amount < 0 ? 'text-[var(--clay)]' : 'text-[var(--moss)]'}`}>
                    {e.amount > 0 ? '+' : ''}{e.amount} {e.symbol ?? ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {e.agent_name ?? (e.counterparty === 'issuance' ? 'brought into existence'
                      : e.counterparty === 'pool' ? 'back to the pool' : e.counterparty)}
                    {e.note ? <span className="text-[var(--ink-3)]"> — {e.note}</span> : null}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--ink-3)]">
                    {e.kind === 'reversal' ? <Undo2 className="inline h-3 w-3" /> : e.kind}
                    {' '}{String(e.created_at ?? '').slice(0, 10)}
                  </span>
                </div>
              ))}
              {!entries.length && (
                <div className="px-3 py-3 text-[11px] text-[var(--ink-3)]">Nothing has moved yet.</div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SectionHead({ icon: I, children }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <I className="h-3.5 w-3.5 text-[var(--ink-3)]" />
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-2)]">{children}</h3>
    </div>
  );
}

function CurrencyCard({ currency: c, onAct, open, onToggle }) {
  const [holders, setHolders] = useState(null);
  useEffect(() => {
    if (!open || holders) return;
    get('ledger').then(() => {}).catch(() => {});
    // Balances come from the tool rather than the page bundle, so the one place
    // that adds them up is the engine.
    import('../api.js').then(({ callTool }) =>
      callTool('balances', { currency_id: c.id })
        .then((r) => setHolders(r?.balances ?? []))
        .catch(() => setHolders([])));
  }, [open, c.id, holders]);

  return (
    <div className="rounded border border-[var(--line)] bg-[var(--paper)] p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <Coins className="h-4 w-4 shrink-0 text-[var(--gold)]" />
        <h3 className="text-sm font-medium">{c.plural || c.name}</h3>
        {c.retired_at && (
          <span className="rounded-full bg-[var(--paper-2)] px-2 py-0.5 text-[10px] text-[var(--ink-3)]">
            retired
          </span>
        )}
        <span className="text-[11px] text-[var(--ink-3)]">one = {c.unit_of}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--ink-2)]">
        <span>
          {c.zero_sum
            ? 'Zero-sum — nobody issues; every balance together is always nothing'
            : `Issued — ${c.in_existence} in existence`}
        </span>
        {c.credit_limit != null && <span>limit −{Math.abs(c.credit_limit)}</span>}
        {!c.zero_sum && c.per_verified_proof
          ? <span>{c.per_verified_proof} per checked before-and-after</span> : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 border-t border-[var(--line-2)] pt-2">
        <Act onClick={onToggle}>{open ? 'Hide who holds what' : 'Who holds what'}</Act>
        {!c.retired_at && (
          <>
            <Act onClick={() => onAct?.('transfer_credit', { currency_id: c.id })}>
              {verb('transfer_credit')}
            </Act>
            {!c.zero_sum && (
              <Act onClick={() => onAct?.('issue_credit', { currency_id: c.id })}>
                {verb('issue_credit')}
              </Act>
            )}
          </>
        )}
      </div>

      {open && (
        <div className="mt-2 border-t border-[var(--line-2)] pt-2">
          {holders === null ? (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--ink-3)]">
              <Loader2 className="h-3 w-3 animate-spin" /> adding up…
            </div>
          ) : !holders.length ? (
            <p className="text-[11px] text-[var(--ink-3)]">Nobody holds any yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {holders.map((h) => (
                <li key={h.agent_id} className="flex items-baseline gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate">{h.name ?? h.agent_id}</span>
                  <span className={`tabular-nums ${
                    h.balance < 0 ? 'text-[var(--clay)]' : 'text-[var(--ink)]'}`}>
                    {h.balance > 0 ? '+' : ''}{h.balance}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {c.zero_sum && (
            <p className="mt-1.5 text-[10px] leading-snug text-[var(--ink-3)]">
              Negative is normal here. Somebody below zero has received more than they have given
              yet — that is the group extending them credit, and the limit is how much of it you
              agreed to.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The empty state, which is the most important screen in this file.
 *
 * "Make a currency" means nothing to somebody who has never done it. The two
 * shapes are named, in one sentence each, with the consequence of choosing
 * each — and the route in is a council decision, because that is the honest
 * first step and pretending otherwise would teach the wrong thing about what
 * this is.
 */
function Empty({ onAct, onGoTo }) {
  return (
    <div className="rounded border border-dashed border-[var(--line)] px-4 py-6">
      <h3 className="text-sm">This commons does not count anything yet.</h3>
      <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--ink-2)]">
        A ledger here is not a currency somebody shipped you — it is a unit you define, in your
        own words, with rules you agree together. There are two shapes, and most groups want the
        first:
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-[var(--line)] p-2.5">
          <div className="text-xs font-medium">Zero-sum</div>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--ink-2)]">
            Nobody issues. Units only move between people, so all the balances together are
            always exactly nothing and going below zero is normal — it means the group is
            extending you credit. You set how far. This is mutual credit, and it is what most
            local exchange systems that lasted actually are.
          </p>
        </div>
        <div className="rounded border border-[var(--line)] p-2.5">
          <div className="text-xs font-medium">Issued</div>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--ink-2)]">
            Units come into existence when somebody makes them — by council decision, or
            automatically for each before-and-after that has been checked. How many exist is a
            number everybody can see and argue about.
          </p>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-snug text-[var(--ink-3)]">
        Either way it starts at council: an economy is something a community agrees, not a setting
        somebody switches on. Take the decision first, then define the unit against it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => onGoTo?.('council')}
          className="flex items-center gap-1.5 rounded bg-[var(--moss)] px-3 py-1.5 text-xs
                     font-medium text-[var(--on-accent)] hover:brightness-110">
          Take it to council <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onAct?.('define_currency', {})}
          className="rounded border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-2)]
                     hover:border-[var(--moss)] hover:text-[var(--moss)]">
          We have already decided — define it
        </button>
      </div>
    </div>
  );
}

function Act({ onClick, children }) {
  return (
    <button onClick={onClick}
      className="rounded border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--ink-2)]
                 transition-colors hover:border-[var(--moss)] hover:text-[var(--moss)]">
      {children}
    </button>
  );
}
