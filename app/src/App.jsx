import React, { useCallback, useEffect, useState } from 'react';
import {
  Compass, Map as MapIcon, Radio, Flag, Scale, Users, RefreshCw,
  BookOpen, Shield, Flame, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import Map3D from './components/Map3D.jsx';
import Assistant from './components/Assistant.jsx';
import Guide from './components/Guide.jsx';
import { MyPlace, Signals, Quests, Council, Gatherings, Exchange, Learn, Federation } from './views/Views.jsx';
import { get, callTool } from './api.js';

const TABS = [
  { id: 'place', label: 'My Place', icon: Compass },
  { id: 'atlas', label: 'Atlas', icon: MapIcon },
  { id: 'signals', label: 'Signals', icon: Radio },
  { id: 'quests', label: 'Quests', icon: Flag },
  { id: 'council', label: 'Council', icon: Scale },
  { id: 'gatherings', label: 'Gatherings', icon: Users },
  { id: 'exchange', label: 'Exchange', icon: RefreshCw },
  { id: 'learn', label: 'Learn', icon: BookOpen },
  { id: 'federation', label: 'Federation', icon: Shield },
];

export default function App() {
  const [tab, setTab] = useState('atlas');
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
  const [gates, setGates] = useState({});
  const [focus, setFocus] = useState(null);
  const [panel, setPanel] = useState(true);
  const [discovering, setDiscovering] = useState(false);

  const load = useCallback(async () => {
    const safe = (p, f) => get(p).then(f).catch(() => {});
    await Promise.all([
      safe('status', setStatus), safe('dashboard', setDash),
      safe('places', setPlaces), safe('hubs', setHubs),
      safe('signals', setSignals), safe('quests', setQuests),
      safe('decisions', setDecisions), safe('gatherings', setGatherings),
      safe('exchange', setExchange), safe('learn', setLearn),
      safe('federation', setPeers), safe('doctrine', setDoctrine),
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

  const showMap = tab === 'atlas' || tab === 'place';

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--paper)] px-4 py-2.5">
        <Flame className="h-5 w-5 text-[var(--gold)]" />
        <div>
          <div className="text-sm font-medium leading-tight">BioRegional OS</div>
          <div className="text-[10px] leading-tight text-[var(--ink-3)]">
            {status?.chapters?.[0]?.name ?? 'no chapter'} · local-first · AGPL-3.0
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-[var(--ink-3)]">
          {status && (
            <span>{status.counts.places} places · {status.counts.signals} signals · {status.tools} tools</span>
          )}
          <button onClick={() => setPanel((p) => !p)}
            className="rounded border border-[var(--line)] p-1.5 hover:border-[var(--moss)]"
            title={panel ? 'Hide assistant' : 'Show assistant'}>
            {panel ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* nav */}
      <nav className="scrollbar-none overflow-x-auto border-b border-[var(--line)] bg-[var(--paper-2)] px-4">
        <div className="flex gap-1 py-1.5">
          {TABS.map((t) => {
            const I = t.icon, on = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  on ? 'bg-[var(--moss)] text-[var(--paper)]' : 'text-[var(--ink-2)] hover:bg-[var(--line-2)]'}`}>
                <I className={`h-3.5 w-3.5 ${on ? 'text-[var(--gold)]' : 'text-[var(--ink-3)]'}`} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* body */}
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
                {tab === 'signals' && <Signals signals={signals} onFocus={focusOn} />}
                {tab === 'quests' && <Quests quests={quests} gates={gates} onLoadGates={loadGates} onFocus={focusOn} />}
                {tab === 'council' && <Council decisions={decisions} due={dash?.due_for_review} />}
                {tab === 'gatherings' && <Gatherings gatherings={gatherings} />}
                {tab === 'exchange' && <Exchange exchange={exchange} />}
                {tab === 'learn' && <Learn learn={learn} doctrine={doctrine} />}
                {tab === 'federation' && <Federation peers={peers} onDiscover={discover} discovering={discovering} />}
              </div>
            </div>
          )}
        </main>

        {panel && (
          <aside className="w-[24rem] shrink-0">
            <Assistant configured={!!status?.ai_configured} onRefresh={load} />
          </aside>
        )}
      </div>

      <Guide tab={tab} />
    </div>
  );
}
