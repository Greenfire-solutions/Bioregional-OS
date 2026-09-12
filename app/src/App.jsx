import React, { useCallback, useEffect, useState } from 'react';
import {
  Compass, Map as MapIcon, Radio, Flag, Scale, Users, RefreshCw, BookOpen, Shield,
  Flame, PanelRightClose, PanelRightOpen, ListChecks, Ear, Ruler, Plus, Send,
} from 'lucide-react';
import Map3D from './components/Map3D.jsx';
import Assistant from './components/Assistant.jsx';
import Guide from './components/Guide.jsx';
import Today from './components/Today.jsx';
import FirstRun from './components/FirstRun.jsx';
import Card from './components/Card.jsx';
import ToolForm from './components/ToolForm.jsx';
import {
  MyPlace, Signals, Quests, Council, Gatherings, Exchange, Learn, Federation, Listen, Measure,
} from './views/Views.jsx';
import { get, callTool } from './api.js';

// Each tab names the loop stage it serves, and the tool that adds to it.
const TABS = [
  { id: 'today',      label: 'Today',      icon: ListChecks },
  { id: 'place',      label: 'My Place',   icon: Compass },
  { id: 'atlas',      label: 'Atlas',      icon: MapIcon,   add: 'add_place',        addLabel: 'Add a place' },
  { id: 'listen',     label: 'Listen',     icon: Ear,       add: 'submit_intake',    addLabel: 'Bring a need' },
  { id: 'signals',    label: 'Signals',    icon: Radio,     add: 'add_signal',       addLabel: 'Record an observation' },
  { id: 'quests',     label: 'Quests',     icon: Flag,      add: 'open_quest',       addLabel: 'Open a project' },
  { id: 'council',    label: 'Council',    icon: Scale,     add: 'propose_decision', addLabel: 'Propose to council' },
  { id: 'measure',    label: 'Measure',    icon: Ruler,     add: 'add_indicator',    addLabel: 'Add an indicator' },
  { id: 'gatherings', label: 'Gatherings', icon: Users,     add: 'add_gathering',    addLabel: 'Schedule a gathering' },
  { id: 'exchange',   label: 'Exchange',   icon: RefreshCw, add: 'record_exchange',  addLabel: 'Log a contribution' },
  { id: 'learn',      label: 'Learn',      icon: BookOpen,  add: 'publish_learning', addLabel: 'Write something up' },
  { id: 'card',       label: 'The card',   icon: Send },
  { id: 'federation', label: 'Federation', icon: Shield },
];

export default function App() {
  const [tab, setTab] = useState('today');
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
  const onlyExample = status && status.chapters?.length === 1 && status.chapters[0].id === 'barton-creek';

  function dismissIntro() {
    setDismissedIntro(true); setFirstRun(false);
    try { localStorage.setItem('bros.firstrun.dismissed', '1'); } catch { /* private window */ }
  }

  if (noChapter) {
    return <FirstRun blocking onDone={() => { setFirstRun(false); load(); }} />;
  }

  const active = TABS.find((t) => t.id === tab);
  const showMap = tab === 'atlas' || tab === 'place';
  const blocking = dash?.viability ? dash.viability.total - dash.viability.passed : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="no-print flex items-center gap-3 border-b border-[var(--line)] bg-[var(--paper)] px-4 py-2.5">
        <Flame className="h-5 w-5 text-[var(--gold)]" />
        <div>
          <div className="text-sm font-medium leading-tight">BioRegional OS</div>
          <div className="text-[10px] leading-tight text-[var(--ink-3)]">
            {status?.chapters?.[0]?.name ?? 'no chapter'} · local-first · AGPL-3.0
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-[var(--ink-3)]">
          {status && <span>{status.counts.places} places · {status.counts.signals} signals · {status.tools} tools</span>}
          <button onClick={() => setPanel((p) => !p)}
            className="rounded border border-[var(--line)] p-1.5 hover:border-[var(--moss)]"
            title={panel ? 'Hide assistant' : 'Show assistant'}>
            {panel ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <nav className="no-print scrollbar-none flex items-center gap-2 overflow-x-auto border-b border-[var(--line)] bg-[var(--paper-2)] px-4">
        <div className="flex gap-1 py-1.5">
          {TABS.map((t) => {
            const I = t.icon, on = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  on ? 'bg-[var(--moss)] text-[var(--paper)]' : 'text-[var(--ink-2)] hover:bg-[var(--line-2)]'}`}>
                <I className={`h-3.5 w-3.5 ${on ? 'text-[var(--gold)]' : 'text-[var(--ink-3)]'}`} />
                {t.label}
                {t.id === 'today' && blocking > 0 && (
                  <span className={`rounded-full px-1.5 text-[10px] ${on ? 'bg-[var(--gold)] text-[var(--ink)]' : 'bg-[var(--clay)] text-white'}`}>
                    {blocking}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {active?.add && (
          <button onClick={() => setForm({ tool: active.add })}
            className="ml-auto mr-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border
                       border-[var(--moss)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--moss)]
                       hover:bg-[var(--moss)] hover:text-white">
            <Plus className="h-3.5 w-3.5" />{active.addLabel}
          </button>
        )}
      </nav>

      {onlyExample && !dismissedIntro && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line)]
                        bg-[#FCFAF2] px-4 py-1.5 text-[11px]">
          <span className="text-[var(--ink-2)]">
            This is example data from Austin, Texas. Where are <em>you</em>?
          </span>
          <button onClick={() => setFirstRun(true)}
            className="font-medium text-[var(--moss)] underline underline-offset-2">
            Find my bioregion
          </button>
          <button onClick={dismissIntro} className="ml-auto text-[var(--ink-3)] hover:text-[var(--ink)]">
            dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          {showMap ? (
            <div className="flex h-full">
              <div className="min-w-0 flex-1">
                <Map3D places={places} hubs={hubs} signals={signals} focus={focus}
                       onSelect={(s) => s.item.lat != null && setFocus({ lat: s.item.lat, lng: s.item.lng })} />
              </div>
              {tab === 'place' && (
                <div className="w-[26rem] shrink-0 overflow-y-auto border-l border-[var(--line)] bg-[var(--paper)] p-4">
                  <MyPlace data={dash} onFocus={focusOn} />
                </div>
              )}
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-4">
              <div className="mx-auto max-w-3xl">
                {tab === 'today' && <Today onChanged={load} />}
                {tab === 'listen' && <Listen intake={intake} />}
                {tab === 'signals' && <Signals signals={signals} onFocus={focusOn} />}
                {tab === 'quests' && <Quests quests={quests} gates={gates} onLoadGates={loadGates}
                                             onFocus={focusOn} onAct={(t, p) => setForm({ tool: t, prefill: p })} />}
                {tab === 'council' && <Council decisions={decisions} due={dash?.due_for_review}
                                               onAct={(t, p) => setForm({ tool: t, prefill: p })} />}
                {tab === 'measure' && <Measure indicators={indicators}
                                               onAct={(t, p) => setForm({ tool: t, prefill: p })} />}
                {tab === 'gatherings' && <Gatherings gatherings={gatherings} />}
                {tab === 'exchange' && <Exchange exchange={exchange} />}
                {tab === 'learn' && <Learn learn={learn} doctrine={doctrine} />}
                {tab === 'card' && <Card />}
                {tab === 'federation' && <Federation peers={peers} onDiscover={discover} discovering={discovering} />}
              </div>
            </div>
          )}
        </main>

        {panel && (
          <aside className="no-print w-[24rem] shrink-0">
            <Assistant configured={!!status?.ai_configured} toolCount={status?.tools} onRefresh={load} />
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
