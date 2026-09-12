import React from 'react';
import { X, MapPin, CircleAlert, ArrowRight } from 'lucide-react';
import { KIND, markerSVG } from '../mapKinds.js';

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
export default function MapPanel({ feature, onClose, onAct, onGoTo }) {
  if (!feature) return null;
  const k = KIND[feature.kind] ?? KIND.observation;
  const blocked = feature.state === 'blocked';
  const act = ACTION[feature.kind]?.(feature);

  return (
    <aside className="flex h-full w-[19rem] shrink-0 flex-col overflow-y-auto border-l
                      border-[var(--line)] bg-[var(--paper)]">
      <div className="flex items-start gap-2 border-b border-[var(--line)] px-4 py-3">
        <img src={markerSVG(feature.kind, { blocked, precise: feature.precise !== false })}
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

        {feature.kind === 'gathering' && feature.care != null && (
          <p className={`text-[11px] leading-snug ${feature.care < 2 ? 'text-[var(--clay)]' : 'text-[var(--ink-2)]'}`}>
            {feature.care} of four care provisions — meals, transport, childcare, accessibility.
            {feature.care < 2 && ' Ecological work fails when people are unsupported.'}
          </p>
        )}
      </div>

      {act && (
        <div className="mt-auto border-t border-[var(--line)] p-3">
          <button onClick={() => (act.goTo ? onGoTo?.(act.goTo) : onAct?.(act.tool, act.input))}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-[var(--moss)]
                       px-3 py-2 text-xs font-medium text-[var(--on-accent)] hover:brightness-110">
            {act.label} <ArrowRight className="h-3.5 w-3.5" />
          </button>
          {act.note && (
            <p className="mt-1.5 text-center text-[10px] leading-snug text-[var(--ink-3)]">{act.note}</p>
          )}
        </div>
      )}
    </aside>
  );
}

/**
 * The one thing worth doing to each kind of thing.
 *
 * Matched to what is actually wrong with it rather than offered generically: a
 * blocked project opens the gate that is blocking it, an unowned one asks for
 * the owner the protocol requires. A map that only ever said "see more" would
 * be a table of contents.
 */
const ACTION = {
  project: (f) => (f.state === 'blocked'
    ? { tool: 'satisfy_quest_gate', input: { quest_id: f.id }, label: 'Close a gate',
        note: 'Or pass it with a reason, if it genuinely does not apply.' }
    : { tool: 'update_quest', input: { quest_id: f.id }, label: 'Work on this project' }),
  need: (f) => ({ tool: 'respond_to_intake', input: { intake_id: f.id }, label: 'Answer this',
                  note: 'A person may submit a need, receive a response, and appeal.' }),
  gathering: (f) => (f.care != null && f.care < 2
    ? { tool: 'add_gathering', input: { title: f.title }, label: 'Add care to this gathering' }
    : { goTo: 'gatherings', label: 'See the gatherings' }),
  observation: (f) => ({ tool: 'open_quest', input: { signal_id: f.id, title: f.title },
                         label: 'Start a project from this',
                         note: 'Observation must lead somewhere, or it is surveillance.' }),
  place: (f) => ({ goTo: 'place', label: 'See this place in full' }),
  hub: () => ({ goTo: 'place', label: 'See the hubs' }),
  reading: () => ({ goTo: 'signals', label: 'See all the readings' }),
};
