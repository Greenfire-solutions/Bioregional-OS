import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, Plus, ShieldOff, Laptop, Clock, AlertTriangle } from 'lucide-react';
import { callTool, get, post } from '../api.js';
import ToolForm from './ToolForm.jsx';
import { verb } from '../verbs.js';

/**
 * Letting a second person write.
 *
 * The engine (engines/enrol.mjs) and its four tools were built and tested and
 * reachable only by calling a tool, which made the feature real and unusable
 * by anybody who is not comfortable doing that. This is the screen.
 *
 * What it is NOT is sign-in. The thing enrolled is a browser on a device — a
 * laptop on the wifi, a phone, a tablet — and the thing shown is a code read
 * off this screen, which is single-use, lasts twenty minutes, and grants only
 * the right to ask. There is no password because there is nothing to
 * remember, and no account because there is nothing to recover.
 *
 * Two things this page says out loud rather than assuming:
 *
 *   • Whether other computers can reach this one at all. Enrolment is
 *     pointless unless the OS was started with --share, so the page checks and
 *     says so before a code is minted into the void.
 *
 *   • That a revoked device stays on the list. It is still the recorded author
 *     of everything it filed; a device that vanished would take the record of
 *     who did the work with it.
 */
export default function Devices() {
  const [list, setList] = useState(null);
  const [conn, setConn] = useState(null);
  const [role, setRole] = useState('member');
  const [by, setBy] = useState('');
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);

  async function load() {
    setList(await callTool('list_devices', {}));
  }
  useEffect(() => {
    load();
    get('connect').then(setConn).catch(() => {});
  }, []);

  async function addDevice() {
    setBusy(true);
    const r = await callTool('invite_device', { role, created_by: by.trim() || undefined });
    if (r?.error) { setInvite({ error: r.message || r.error }); setBusy(false); return; }
    // The link carries the code in the FRAGMENT, which a browser never sends
    // to the server and which lands in no log. It is the invitation, not the
    // token: single-use, short-lived, and what it grants is the right to ask.
    const origin = conn?.lan_url ?? conn?.local_url ?? window.location.origin;
    const url = `${origin}/join#enrol=${r.code}`;
    const q = await post('qr', { text: url }).catch(() => ({}));
    setInvite({ ...r, url, qr: q?.qr ?? null });
    setBusy(false);
    load();
  }

  if (!list) {
    return <div className="flex items-center gap-2 p-8 text-sm text-[var(--ink-2)]">
      <Loader2 className="h-4 w-4 animate-spin" /> looking…
    </div>;
  }

  // On an enrolled device, this page is read-only by design: devices are
  // managed at the keyboard the commons lives on.
  if (list.error) {
    return (
      <div className="space-y-3">
        <h2 className="text-base font-medium">Devices</h2>
        <div className="rounded border border-[var(--line)] bg-[var(--paper-2)] px-4 py-3 text-sm text-[var(--ink-2)]">
          {list.message ?? list.error}
        </div>
      </div>
    );
  }

  const sharing = !!conn?.sharing && !!conn?.lan_url;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium">Devices</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">{list.sentence}</p>
        </div>
      </div>

      {/* ── Add a device ──────────────────────────────────────────────── */}
      <section className="rounded border border-[var(--line)] bg-[var(--paper-2)] p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[var(--gold)]" />
          <h3 className="text-sm font-medium">Add a device</h3>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-2)]">
          A code to read off this screen. It works once, for twenty minutes, and lets one browser on
          the wifi write to this commons. No account, no password, nothing for anybody to remember.
        </p>

        {!sharing && (
          <div className="mt-3 flex items-start gap-2 rounded border border-[#E8DCB8] bg-[#FBF3DC] px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--gold)]" />
            <div className="text-[var(--ink-2)]">
              <span className="font-medium text-[var(--ink)]">Only this computer can reach the OS right now.</span>{' '}
              A code will work, but nobody else can get here to use it. Stop the OS and start it with{' '}
              <code className="rounded bg-[var(--paper-3)] px-1">npm run os -- --share</code>, then come back.
            </div>
          </div>
        )}

        {!invite && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Enrol as</span>
              <select id="devices-role" value={role} onChange={(e) => setRole(e.target.value)}
                className="mt-1 block rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--moss)]">
                <option value="member">member — reads members-only, does field work</option>
                <option value="coordinator">coordinator — also does council work</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Who is inviting</span>
              <input id="devices-by" value={by} onChange={(e) => setBy(e.target.value)} placeholder="your name"
                className="mt-1 block w-44 rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--moss)]" />
            </label>
            <button onClick={addDevice} disabled={busy}
              className="flex items-center gap-1.5 rounded bg-[var(--moss)] px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50"
              style={{ boxShadow: 'var(--glow)' }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {verb('invite_device')}
            </button>
          </div>
        )}

        {invite?.error && (
          <p className="mt-3 text-xs text-[var(--clay)]">{invite.error}</p>
        )}

        {invite && !invite.error && (
          <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
            {invite.qr ? (
              <img src={invite.qr} alt="Scan to join this commons"
                   className="h-44 w-44 rounded border border-[var(--line)] bg-white p-1" />
            ) : (
              <div className="flex h-44 w-44 items-center justify-center rounded border border-dashed border-[var(--line)] text-center text-[11px] text-[var(--ink-3)]">
                no QR — read the code aloud instead
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Read this out, or scan it</div>
              <div className="mt-1 text-3xl tabular-nums tracking-[.12em] text-[var(--gold)]"
                   style={{ fontFamily: 'var(--font-data)' }}>
                {invite.code}
              </div>
              <p className="mt-2 text-xs text-[var(--ink-2)]">
                On the other device, open <span className="font-mono text-[var(--ink)]">{invite.url.split('#')[0]}</span>,
                press <em>Join this device</em>, and type the code. Enrols as <strong>{invite.role}</strong>.
              </p>
              <p className="mt-1.5 text-[11px] text-[var(--ink-3)]">{invite.note}</p>
              <button onClick={() => setInvite(null)}
                className="mt-3 rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--moss)]">
                Done — make another
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── The list ──────────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-baseline gap-2">
          <Laptop className="h-3.5 w-3.5 translate-y-0.5 text-[var(--ink-3)]" />
          <h3 className="text-xs font-medium">Enrolled</h3>
          {list.invitations_open > 0 && (
            <span className="text-[11px] text-[var(--ink-3)]">
              {list.invitations_open} invitation{list.invitations_open === 1 ? '' : 's'} open
            </span>
          )}
        </div>
        {list.devices.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--line)] bg-[var(--paper-2)] px-3 py-2.5 text-[11px] text-[var(--ink-2)]">
            No devices yet. Only this computer can write, which means the commons stops when this
            computer does.
          </div>
        ) : (
          <ul className="space-y-2">
            {list.devices.map((d) => (
              <li key={d.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-2 ${
                    d.active ? 'border-[var(--line)] bg-[var(--paper-2)]' : 'border-[var(--line-2)] bg-[var(--paper)] opacity-70'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{d.label}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      !d.active ? 'bg-[#FBF1EE] text-[var(--clay)]'
                        : d.role === 'coordinator' ? 'bg-[#FBF3DC] text-[#8A6D1F]'
                        : 'bg-[#E6EFE7] text-[var(--moss)]'}`}>
                      {d.active ? d.role : 'revoked'}
                    </span>
                    {d.person && <span className="text-[11px] text-[var(--ink-3)]">· {d.person}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[10px] text-[var(--ink-3)]">
                    <span>enrolled {String(d.enrolled_at).slice(0, 10)}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {d.last_seen ? `seen ${String(d.last_seen).slice(0, 16)}` : 'never seen yet'}
                    </span>
                  </div>
                </div>
                {d.active && (
                  <button onClick={() => setForm({ tool: 'revoke_device', prefill: { device_id: d.id } })}
                    className="flex items-center gap-1 rounded border border-[#E4C9C2] bg-[#FBF1EE] px-2.5 py-1.5 text-[11px] font-medium text-[var(--clay)] hover:border-[var(--clay)]">
                    <ShieldOff className="h-3 w-3" /> {verb('revoke_device')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-[var(--ink-3)]">{list.note}</p>
      </section>

      {form && (
        <ToolForm tool={form.tool} prefill={form.prefill}
                  onClose={() => setForm(null)}
                  onDone={() => setTimeout(() => { setForm(null); load(); }, 1000)} />
      )}
    </div>
  );
}
