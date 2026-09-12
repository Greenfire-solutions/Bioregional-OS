import React, { useCallback, useEffect, useState } from 'react';
import {
  Compass, Map as MapIcon, Radio, Flag, Scale, Users, RefreshCw, RefreshCcw, BookOpen, Shield,
  Flame, PanelRightClose, PanelRightOpen, ListChecks, Ear, Ruler, Plus, Send, Activity, Home,
} from 'lucide-react';
import Map3D from './components/Map3D.jsx';
import RegionPanel from './components/RegionPanel.jsx';
import MapPanel from './components/MapPanel.jsx';
import Assistant from './components/Assistant.jsx';
import Guide from './components/Guide.jsx';
import Today from './components/Today.jsx';
import Commons from './components/Commons.jsx';
import Vitals from './components/Vitals.jsx';
import Season from './components/Season.jsx';
import FirstRun from './components/FirstRun.jsx';
import Card from './components/Card.jsx';
import ToolForm from './components/ToolForm.jsx';
import {
  MyPlace, Signals, Quests, Council, Gatherings, Exchange, Learn, Federation, Listen, Measure,
} from './views/Views.jsx';
import { get, callTool } from './api.js';

// ── The shape of the thing ────────────────────────────────────────────────
// Thirteen flat tabs were thirteen decisions to make before doing anything.
// They are five, and the five are not tidiness — they are the protocol's own
// structure. Listen → Signals → Quests → Measure IS the spine of the twelve
// stage loop: a need, an observation, a project, the evidence. Council,
// Gatherings and Exchange are three of the seven engines and all of them are
// about people. Learn, the card and Federation are everything that leaves the
// machine.
//
// Each leaf still names the tool that adds to it, so the "add" affordance is
// always one reach away and never a guess.
// scripts/test.mjs asserts that every label here is named somewhere in the
// README. Rename a tab without saying so and the suite goes red; reword the
// README's description of it freely and it does not. The set is checked, the
// prose is left to a person.
const GROUPS = [
  // The board first, and the protocol's own stages behind it. Fifteen tabs
  // named after the twelve-stage loop is the system's filing cabinet — correct,
  // complete, and navigable only by somebody who already knows the loop. The
  // cabinet is still here; it is no longer what a person lands on.
  { id: 'home', label: 'The commons', icon: Home, sub: [
    { id: 'home',   label: 'The commons',     icon: Home },
    { id: 'today',  label: 'Everything to do', icon: ListChecks },
    { id: 'vitals', label: 'How it is going',  icon: Activity },
  ] },
  { id: 'place', label: 'Place', icon: Compass, sub: [
    { id: 'place', label: 'My Place', icon: Compass },
    { id: 'atlas', label: 'Atlas',    icon: MapIcon, add: 'add_place', addLabel: 'Add a place' },
  ] },
  { id: 'work', label: 'The work', icon: Flag, sub: [
    { id: 'listen',  label: 'Listen',  icon: Ear,   add: 'submit_intake', addLabel: 'Bring a need' },
    { id: 'signals', label: 'Signals', icon: Radio, add: 'add_signal',    addLabel: 'Record an observation' },
    { id: 'quests',  label: 'Quests',  icon: Flag,  add: 'open_quest',    addLabel: 'Open a project' },
    { id: 'measure', label: 'Measure', icon: Ruler, add: 'add_indicator', addLabel: 'Add an indicator' },
  ] },
  { id: 'together', label: 'Together', icon: Users, sub: [
    { id: 'council',    label: 'Council',    icon: Scale,     add: 'propose_decision', addLabel: 'Propose to council' },
    { id: 'gatherings', label: 'Gatherings', icon: Users,     add: 'add_gathering',    addLabel: 'Schedule a gathering' },
    { id: 'exchange',   label: 'Exchange',   icon: RefreshCw, add: 'record_exchange',  addLabel: 'Log a contribution' },
    { id: 'season',     label: 'The season', icon: RefreshCcw },
  ] },
  { id: 'travels', label: 'What travels', icon: Send, sub: [
    { id: 'card',       label: 'The card',   icon: Send },
    { id: 'learn',      label: 'Learn',      icon: BookOpen, add: 'publish_learning', addLabel: 'Write something up' },
    { id: 'federation', label: 'Federation', icon: Shield },
  ] },
];
const TABS = GROUPS.flatMap((g) => g.sub);
const groupOf = (id) => GROUPS.find((g) => g.sub.some((t) => t.id === id)) ?? GROUPS[0];

export default function App() {
  const [tab, setTab] = useState('home');
  // The one thing the page you are on is for, handed to that page so it can put
  // it beside its own heading.
  const primary = (t) => {
    const sub = GROUPS.flatMap((g) => g.sub).find((x) => x.id === t);
    return sub?.add ? { label: sub.addLabel, onClick: () => setForm({ tool: sub.add }) } : null;
  };
  const [status, setStatus] = useState(null);
  const [dash, setDash] = useState(null);
  const [places, setPlaces] = useState([]);
  const [hubs, setHubs] = useState([]);
  const [signals, setSignals] = useState([]);
  const [quests, setQuests] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [gatherings, setGatherings] = useState([]);
  const [exchange, setExchange] = useState(null);
  const [learn, setLearn] = useState([]);
  const [peers, setPeers] = useState([]);
  const [doctrine, setDoctrine] = useState(null);
  const [intake, setIntake] = useState([]);
  const [indicators, setIndicators] = useState([]);
  const [gates, setGates] = useState({});
  const [focus, setFocus] = useState(null);
  const [region, setRegion] = useState(null);
  const [picked, setPicked] = useState(null);
  // Bumped by load(), so the map refetches what it draws after every action.
  const [version, setVersion] = useState(0);
  const [panel, setPanel] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [form, setForm] = useState(null);
  const [firstRun, setFirstRun] = useState(false);
  const [dismissedIntro, setDismissedIntro] = useState(() => {
    try { return localStorage.getItem('bros.firstrun.dismissed') === '1'; } catch { return false; }
  });

  const load = useCallback(async () => {
    const safe = (p, f) => get(p).then(f).catch(() => {});
    await Promise.all([
      safe('status', setStatus), safe('dashboard', setDash),
      safe('places', setPlaces), safe('hubs', setHubs),
      safe('signals', setSignals), safe('quests', setQuests),
      safe('decisions', setDecisions), safe('gatherings', setGatherings),
      safe('exchange', setExchange), safe('learn', setLearn),
      safe('federation', setPeers), safe('doctrine', setDoctrine),
      safe('intake', setIntake),
      callTool('list_indicators', {}).then((r) => Array.isArray(r) && setIndicators(r)).catch(() => {}),
    ]);
      // Every reload is a new version, so anything keyed on it refetches —
    // the map especially, whose contents change without any row count
    // changing when a gate closes.
    setVersion((v) => v + 1);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function loadGates(questId) {
    const g = await callTool('quest_gates', { quest_id: questId });
    setGates((s) => ({ ...s, [questId]: Array.isArray(g) ? g : [] }));
  }
  async function discover() {
    setDiscovering(true);
    await callTool('discover_peers', { range: '150km' });
    await get('federation').then(setPeers).catch(() => {});
    setDiscovering(false);
  }
  function focusOn(coords) { setFocus(coords); setTab('atlas'); }

  // The first sixty seconds. With no chapter at all this replaces everything —
  // there is nothing else to show, and the alternative is somebody's first
  // screen being a commons in Austin that is not theirs.
  const noChapter = status && (status.chapters?.length ?? 0) === 0;

  // What matters is what you are LOOKING AT, not how many chapters exist.
  // This was gated on the example being the only chapter, which breaks on the
  // most ordinary path there is: somebody founds their own commons, then clicks
  // back to the example to see how a worked one should look — second chapter
  // exists, banner gone, and they are reading an invented report about an
  // unpermitted discharge with nothing on screen saying so.
  const viewingChapter = status?.default_chapter ?? status?.chapters?.[0]?.id ?? null;
  const viewingExample = !!status?.demo_chapter && viewingChapter === status.demo_chapter;

  // One strip was doing two jobs. Saying "this is invented" is a provenance
  // marker and stays for as long as it is true; "where are you?" is an
  // onboarding nudge and is fair to dismiss. Letting a dismissal hide the first
  // because somebody was done with the second is how a marker disappears while
  // the thing it marks is still on screen.
  const showIntroCta = viewingExample && !dismissedIntro;

  function dismissIntro() {
    setDismissedIntro(true); setFirstRun(false);
    try { localStorage.setItem('bros.firstrun.dismissed', '1'); } catch { /* private window */ }
  }

  if (noChapter) {
    return <FirstRun blocking onDone={() => { setFirstRun(false); load(); }} />;
  }

  const active = TABS.find((t) => t.id === tab);
  const group = groupOf(tab);
  const showMap = tab === 'atlas' || tab === 'place';
  const blocking = dash?.viability ? dash.viability.total - dash.viability.passed : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="no-print relative flex items-center gap-3 border-b border-[var(--line)] px-5 py-3">
        <div className="relative">
          <Flame className="h-5 w-5 text-[var(--gold)]" />
          <div className="breathe absolute inset-0 -z-10 blur-md" style={{ boxShadow: 'var(--glow-gold)' }} />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] leading-tight" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-.02em' }}>
            BioRegional OS
          </div>
          <div className="truncate text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            {status?.chapters?.[0]?.name ?? 'no chapter'} · local-first
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {status && (
            <div className="hidden items-center gap-4 sm:flex">
              <Reading n={status.counts.places} of="places" />
              <Reading n={status.counts.signals} of="signals" />
              <Reading n={status.tools} of="tools" />
            </div>
          )}
          <button onClick={() => setPanel((p) => !p)}
            className="rounded border border-[var(--line)] p-1.5 text-[var(--ink-2)] transition-colors hover:border-[var(--moss)] hover:text-[var(--moss)]"
            title={panel ? 'Hide assistant' : 'Show assistant'}>
            {panel ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Five groups, then the leaves of whichever is open. The indicator is a
          single element that travels, so moving between groups reads as one
          object sliding rather than two lights blinking. */}
      <nav className="no-print border-b border-[var(--line)] bg-[var(--paper-2)]">
        <div className="scrollbar-none flex items-center gap-1 overflow-x-auto px-4 pt-2">
          {GROUPS.map((g) => {
            const I = g.icon, on = group.id === g.id;
            return (
              <button key={g.id} onClick={() => setTab(g.sub[0].id)}
                className={`group relative flex items-center gap-2 whitespace-nowrap px-3.5 pb-2.5 pt-1 text-[13px]
                            transition-colors duration-150 ${on ? 'text-[var(--ink)]' : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]'}`}>
                <I className={`h-4 w-4 transition-colors ${on ? 'text-[var(--moss)]' : ''}`} />
                {g.label}
                {g.id === 'today' && blocking > 0 && (
                  <span className="rounded-full bg-[var(--clay)] px-1.5 text-[10px] font-medium text-[var(--on-accent)]">
                    {blocking}
                  </span>
                )}
                <span className={`absolute inset-x-2 bottom-0 h-px origin-left rounded-full bg-[var(--moss)]
                                  transition-transform duration-300 ${on ? 'scale-x-100' : 'scale-x-0'}`}
                      style={{ transitionTimingFunction: 'var(--snap)', boxShadow: on ? 'var(--glow)' : 'none' }} />
              </button>
            );
          })}
        </div>

        {group.sub.length > 1 && (
          <div key={group.id} className="rise scrollbar-none flex items-center gap-1 overflow-x-auto border-t border-[var(--line-2)] px-4 py-1.5">
            {group.sub.map((t) => {
              const on = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] transition-all duration-200 ${
                    on ? 'bg-[var(--moss)] text-[var(--on-accent)]' : 'text-[var(--ink-3)] hover:bg-[var(--paper-3)] hover:text-[var(--ink-2)]'}`}
                  style={{ transitionTimingFunction: 'var(--snap)', boxShadow: on ? 'var(--glow)' : 'none' }}>
                  {t.label}
                </button>
              );
            })}
            {/* The primary action used to live here, pushed to the far right of
                the tab strip as a small outlined pill — styled as navigation,
                outside the column the eye reads, at the size of a label.
                "Propose to council" is the whole point of the council page and
                it looked like a tab nobody had selected. It is now beside each
                page's own title, filled and at a size that reads as a thing you
                press. See `primary` below. */}
          </div>
        )}
      </nav>

      {viewingExample && (
        <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line)]
                        bg-[var(--tone-warn-bg)] px-4 py-1.5 text-[11px]">
          <span className="text-[var(--gold)]">Demonstration data</span>
          <span className="text-[var(--ink-2)]">
            The chapter, its members and their observations are invented. The land readings are real.
          </span>
          {showIntroCta && (
            <>
              <button onClick={() => setFirstRun(true)}
                className="font-medium text-[var(--moss)] underline underline-offset-2">
                Find my bioregion
              </button>
              <button onClick={dismissIntro} className="ml-auto text-[var(--ink-3)] hover:text-[var(--ink)]">
                dismiss
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          {showMap ? (
            <div className="flex h-full">
              <div className="relative min-w-0 flex-1">
                <Map3D places={places} hubs={hubs} signals={signals} focus={focus} version={version}
                       selectedId={picked?.id ?? null}
                       onSelect={(s) => {
                         // An ecoregion has no single point to fly to — it is an
                         // area — so clicking one opens what is known about it
                         // instead of moving the camera.
                         // One panel at a time, and each closes the other. A
                         // double-click both zooms and picks, so it was opening
                         // an ecoregion AND a feature at once — two answers to a
                         // question nobody asked twice.
                         if (s.type === 'ecoregion') { setPicked(null); return setRegion(s.item); }
                         // A thing the commons put on the map opens beside it
                         // rather than flying the camera: you clicked it because
                         // you wanted to know what it is, not to go somewhere.
                         if (s.type === 'feature') { setRegion(null); return setPicked(s.item); }
                         if (s.item.lat != null) setFocus({ lat: s.item.lat, lng: s.item.lng });
                       }} />
              </div>
              {region && (
                // Beside the map, not floating over it — the same column the
                // feature panel uses. It used to be absolutely positioned on
                // top, so the two panel types behaved differently and the
                // ecoregion one covered the ground it was describing.
                <RegionPanel region={region} onClose={() => setRegion(null)} />
              )}
              {picked && (
                <MapPanel feature={picked} onClose={() => setPicked(null)}
                          onGoTo={(t) => { setPicked(null); setTab(t); }}
                          onAct={(tool, input) => { setPicked(null); setForm({ tool, prefill: input }); }} />
              )}
              {tab === 'place' && (
                <div className="w-[26rem] shrink-0 overflow-y-auto border-l border-[var(--line)] bg-[var(--paper)] p-4">
                  <MyPlace data={dash} onFocus={focusOn} />
                </div>
              )}
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-4">
              <div className="mx-auto max-w-3xl">
                {tab === 'home' && <Commons onGoTo={setTab} onChanged={load} />}
                {tab === 'today' && <Today onChanged={load} />}
                {tab === 'vitals' && <Vitals />}
                {tab === 'season' && <Season />}
                {tab === 'listen' && <Listen primary={primary('listen')} intake={intake} />}
                {tab === 'signals' && <Signals primary={primary('signals')} signals={signals} onFocus={focusOn} />}
                {tab === 'quests' && <Quests primary={primary('quests')} quests={quests} gates={gates} onLoadGates={loadGates}
                                             onFocus={focusOn} onAct={(t, p) => setForm({ tool: t, prefill: p })} />}
                {tab === 'council' && <Council primary={primary('council')} decisions={decisions} due={dash?.due_for_review}
                                               onAct={(t, p) => setForm({ tool: t, prefill: p })} />}
                {tab === 'measure' && <Measure primary={primary('measure')} indicators={indicators}
                                               onAct={(t, p) => setForm({ tool: t, prefill: p })} />}
                {tab === 'gatherings' && <Gatherings primary={primary('gatherings')} gatherings={gatherings} />}
                {tab === 'exchange' && <Exchange primary={primary('exchange')} exchange={exchange} />}
                {tab === 'learn' && <Learn primary={primary('learn')} learn={learn} doctrine={doctrine} />}
                {tab === 'card' && <Card />}
                {tab === 'federation' && <Federation primary={primary('federation')} peers={peers} onDiscover={discover} discovering={discovering} />}
              </div>
            </div>
          )}
        </main>

        {panel && (
          <aside className="no-print w-[24rem] shrink-0">
            <Assistant configured={!!status?.ai_configured} claudeCode={status?.claude_code}
                       toolCount={status?.tools} onRefresh={load} />
          </aside>
        )}
      </div>

      {form && (
        <ToolForm tool={form.tool} prefill={form.prefill ?? {}}
                  onClose={() => setForm(null)}
                  onDone={() => setTimeout(() => { setForm(null); load(); }, 1400)} />
      )}

      {firstRun && (
        <FirstRun onDone={() => { dismissIntro(); load(); }} onDismiss={() => setFirstRun(false)} />
      )}

      <Guide tab={tab} />
    </div>
  );
}

/** A header reading: the number in the data face, its name beneath in small caps. */
function Reading({ n, of }) {
  return (
    <div className="text-right leading-none">
      <div className="tabular-nums text-[13px] text-[var(--ink)]" style={{ fontFamily: 'var(--font-data)' }}>{n}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--ink-3)]">{of}</div>
    </div>
  );
}
