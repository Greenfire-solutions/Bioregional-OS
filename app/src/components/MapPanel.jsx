import React from 'react';
import { X, MapPin, CircleAlert, ArrowRight, Move, Pencil, Trash2, Plus, Users } from 'lucide-react';
import { KIND, markerSVG, needsAttention } from '../mapKinds.js';
import { verb } from '../verbs.js';

/**
 * What you clicked, opened beside the map.
 *
 * Beside rather than over: the whole point of putting the commons on the map is
 * seeing a thing IN its place, and a panel covering the map takes the place
 * away at the moment you asked about it. So the map keeps its ground and this
 * takes a column at the right.
 *
 * Every kind ends in something you can do, because a map you can only read is a
 * picture. The action is the one that matches what is actually wrong with the
 * thing — a blocked project offers the gate, a waiting need offers the answer —
 * rather than a generic "open" that lands somebody back in a list.
 */
export default function MapPanel({ feature, onClose, onAct, onGoTo, onMove }) {
  if (!feature) return null;
  const k = KIND[feature.kind] ?? KIND.observation;
  // Two different questions, and conflating them is how a task would have got
  // a project's sentence. `attention` is about how it is DRAWN — one rule, in
  // mapKinds.js, shared with the markers and the globe. `inTheWay` is about
  // what this particular panel says next, and only a project has gates.
  const attention = needsAttention(feature);
  const blocked = feature.kind === 'project' && feature.state === 'blocked';
  // Decided by engines/mapboard.mjs, worded by ../verbs.js. This component
  // used to decide both, which made it a second home for "what to do about a
  // blocked project" and let its verbs drift from the ones on every other
  // screen.
  const act = feature.action;

  return (
    <aside className="flex h-full w-[19rem] shrink-0 flex-col overflow-y-auto border-l
                      border-[var(--line)] bg-[var(--paper)]">
      <div className="flex items-start gap-2 border-b border-[var(--line)] px-4 py-3">
        <img src={markerSVG(feature.kind, { blocked: attention, precise: feature.precise !== false })}
             alt="" className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">{k.label}</div>
          <h3 className="text-sm font-medium leading-snug">{feature.title}</h3>
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-1 hover:bg-[var(--paper-2)]" title="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2.5 px-4 py-3">
        {feature.sub && <p className="text-xs leading-snug text-[var(--ink-2)]">{feature.sub}</p>}

        {blocked && (
          <p className="flex items-start gap-1.5 rounded border border-[#E4C9C2] bg-[#FBF1EE]
                        px-2.5 py-1.5 text-[11px] leading-snug text-[var(--clay)]">
            <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            {feature.badge} thing{feature.badge === 1 ? '' : 's'} in its way. It cannot be built
            until each is closed or passed with a reason.
          </p>
        )}

        {/* The honesty about where the pin is. Said on the thing itself, not
            only in the key, because this is the moment somebody might otherwise
            believe the map knows exactly where a need is. */}
        {feature.precise === false ? (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--ink-3)]">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            No coordinate of its own — drawn at the centre of
            {feature.borrowed_from ? ` ${feature.borrowed_from}` : ' its chapter'}.
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-[11px] text-[var(--ink-3)]">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            {feature.lat.toFixed(4)}, {feature.lng.toFixed(4)}
          </p>
        )}

        {/* What is actually true about this task, in the order somebody asks
            it: has anyone got this, and is there evidence. Both are computed in
            engines/mapboard.mjs from the same two facts the task list uses, so
            the map and the list cannot disagree about a task's state. */}
        {feature.kind === 'task' && (
          <div className="space-y-1.5">
            {feature.state === 'unclaimed' && (
              <p className="rounded border border-[#E8D9B0] bg-[#FBF3DC] px-2.5 py-1.5 text-[11px]
                            leading-snug text-[#8A6D1F]">
                Nobody has picked this up. More than one person can be on it.
              </p>
            )}
            {feature.evidence === 'none' && (
              <p className="text-[11px] leading-snug text-[var(--ink-2)]">
                No before-and-after yet. It will not close without one.
              </p>
            )}
            {feature.evidence === 'submitted' && (
              <p className="text-[11px] leading-snug text-[var(--ink-2)]">
                Evidence filed, waiting for somebody who was not there to look at it.
              </p>
            )}
            {feature.evidence === 'verified' && (
              <p className="text-[11px] leading-snug text-[var(--moss)]">
                Before-and-after checked by somebody else.
              </p>
            )}
          </div>
        )}

        {feature.kind === 'gathering' && feature.care != null && (
          <p className={`text-[11px] leading-snug ${feature.care < 2 ? 'text-[var(--clay)]' : 'text-[var(--ink-2)]'}`}>
            {feature.care} of four care provisions — meals, transport, childcare, accessibility.
            {feature.care < 2 && ' Ecological work fails when people are unsupported.'}
          </p>
        )}
      </div>

      {/* Who is carrying it, and the evidence itself. A panel about a piece of
          work that shows neither is a label. The photographs are small here on
          purpose — enough to see that a pair exists and roughly what it shows;
          judging it properly happens on the Tasks screen, at a size somebody
          can actually judge. */}
      {feature.kind === 'task' && !!feature.badge && (
        <div className="flex items-center gap-1.5 px-4 pb-2 text-[11px] text-[var(--ink-2)]">
          <Users className="h-3 w-3 shrink-0 text-[var(--ink-3)]" />
          {feature.sub?.split(' · ')[1] ?? `${feature.badge} carrying it`}
        </div>
      )}

      {act && (
        <div className="mt-auto border-t border-[var(--line)] p-3">
          <button onClick={() => (act.goTo ? onGoTo?.(act.goTo) : onAct?.(act.tool, act.input))}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-[var(--moss)]
                       px-3 py-2 text-xs font-medium text-[var(--on-accent)] hover:brightness-110">
            {act.goTo ? GO_TO[act.goTo] : verb(act.tool)} <ArrowRight className="h-3.5 w-3.5" />
          </button>
          {act.note && (
            <p className="mt-1.5 text-center text-[10px] leading-snug text-[var(--ink-3)]">{act.note}</p>
          )}

          {/* Everything else you can do to this thing. Decided in
              engines/mapboard.mjs alongside the primary action, so the panel
              stays a renderer and never becomes a second opinion about what a
              project allows. */}
          {!!feature.more?.length && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[var(--line-2)] pt-2">
              {feature.more.map((m, i) => (
                <button key={`${m.tool}-${i}`}
                  onClick={() => (m.move ? onMove?.(feature, m) : onAct?.(m.tool, m.input))}
                  className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px]
                              transition-colors ${
                    m.label === 'Drop it'
                      ? 'border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--clay)] hover:text-[var(--clay)]'
                      : 'border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--moss)]'}`}>
                  {ICON[m.label] ?? null}{m.label}
                </button>
              ))}
            </div>
          )}
          {/* Said once, where somebody is about to look for a delete and not
              find one. */}
          {feature.kind === 'task' && (
            <p className="mt-1.5 text-[9px] leading-snug text-[var(--ink-3)]">
              Dropping keeps the record — a task carries who claimed it and every
              before-and-after filed against it.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

/** A glyph for the few secondary actions that have an obvious one. */
const ICON = {
  'Add a task': <Plus className="h-3 w-3" />,
  'Correct it': <Pencil className="h-3 w-3" />,
  'Move it': <Move className="h-3 w-3" />,
  'Drop it': <Trash2 className="h-3 w-3" />,
};

/** Where a "go and look" action lands, said as a destination. */
const GO_TO = {
  place: 'See this place in full',
  gatherings: 'See the gatherings',
  signals: 'See all the readings',
};
