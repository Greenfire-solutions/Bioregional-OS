import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle, CheckCircle2, Upload, Image as ImageIcon } from 'lucide-react';
import { callTool, get, uploadFile } from '../api.js';

/**
 * Fields that name another row, and where the list of those rows comes from.
 *
 * Without this, a generated form asks a person to type `qst_4f2a9c31` into a
 * text box. Every tool that joins two things — a task to its project, a claim
 * to its task, a check to its proof — was unreachable by anybody who had not
 * just read the id off a JSON dump, which is to say by anybody the interface is
 * actually for. The registry knew the relationship all along; only the form did
 * not.
 *
 * `label` turns a row into the words a person recognises. `via` is the tool the
 * options come from, so this stays inside the one-registry rule rather than
 * becoming a second set of endpoints the form knows about privately.
 */
const REFERENCES = {
  quest_id: { via: 'list_quests', label: (r) => r.title },
  task_id: { via: 'list_tasks', label: (r) => `${r.title}${r.project_title ? ` — ${r.project_title}` : ''}` },
  place_id: { via: 'list_places', label: (r) => r.name },
  signal_id: { via: 'list_signals', label: (r) => r.title },
  indicator_id: { via: 'list_indicators', label: (r) => r.name },
  intake_id: { via: 'list_intake', label: (r) => String(r.body ?? '').slice(0, 60) },
  gathering_id: { via: 'list_gatherings', label: (r) => r.title },
  proof_id: { via: 'pending_proofs', label: (r) => `${r.task_title ?? 'a task'} — ${String(r.created_at ?? '').slice(0, 10)}` },
  media_id: { via: 'list_media', label: (r) => r.original_name || r.id },
};

/**
 * Fields that are really a FILE somebody is about to choose.
 *
 * `before_media_id` and `after_media_id` are ids in the schema and photographs
 * in the world. Offering the list of files already stored would be asking
 * somebody standing in a field to go and upload two things somewhere else
 * first, then come back and match them up by name — which is the workflow that
 * makes people stop filing evidence.
 *
 * `media_id` on its own is deliberately NOT here: withdrawing a file means
 * choosing one that exists, not adding another.
 */
const FILE_FIELDS = new Set(['before_media_id', 'after_media_id']);

/**
 * A human form for any tool in the registry, generated from its JSON Schema.
 *
 * This is why there is one registry: Claude Code, the in-app assistant, the REST
 * API and this form all call the same handler, so the same protocol gates apply.
 * Adding a tool gives you a human UI for free — there is no second place to edit.
 */
export default function ToolForm({ tool, prefill = {}, onDone, onClose }) {
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState(prefill);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    get('tools').then((list) => {
      const t = list.find((x) => x.name === tool);
      setSchema(t ?? null);
      if (!t) setError(`No tool called "${tool}".`);
    }).catch((e) => setError(e.message));
  }, [tool]);

  const fields = useMemo(() => {
    if (!schema) return [];
    const props = schema.input_schema?.properties ?? {};
    const required = new Set(schema.input_schema?.required ?? []);
    return Object.entries(props)
      // chapter_id is always implied by the current chapter; never ask a person for it.
      .filter(([name]) => name !== 'chapter_id')
      .map(([name, def]) => ({
        name, def, required: required.has(name),
        kind: FILE_FIELDS.has(name) ? 'file'
            : REFERENCES[name] ? 'ref'
            : def.enum ? 'enum' : def.type === 'boolean' ? 'bool'
            : def.type === 'number' ? 'number'
            // A list gets a box that looks like a list. Without this it fell
            // through to a one-line text input and a person typed a sentence
            // into a field the tool reads as an array.
            : def.type === 'array' ? 'list'
            : (def.description ?? '').length > 44 || /body|description|detail|report|evidence|summary|notes|response|purpose|statement|condition|experiment|trigger|method|plan/.test(name)
              ? 'text' : 'line',
      }))
      // Required fields first — the protocol's demands should be the first thing seen.
      .sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));
  }, [schema]);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true); setError(null); setResult(null);
    const clean = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === '' || v === undefined || v === null) continue;
      clean[k] = v;
    }
    const out = await callTool(tool, clean);
    setBusy(false);
    if (out?.error) { setError(out.message || out.error); return; }
    setResult(out);
    onDone?.(out);
  }

  const missing = fields.filter((f) => f.required && !values[f.name]).map((f) => f.name);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-6"
         onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="w-full max-w-lg rounded-lg border border-[var(--line)] bg-[var(--paper)] shadow-2xl">
        <div className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-[var(--ink-3)]">{tool}</div>
            <p className="mt-0.5 text-xs text-[var(--ink-2)]">{schema?.description}</p>
          </div>
          <button onClick={onClose} className="ml-auto shrink-0 text-[var(--ink-3)] hover:text-[var(--ink)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!schema && !error && (
          <div className="flex items-center gap-2 px-4 py-8 text-xs text-[var(--ink-2)]">
            <Loader2 className="h-4 w-4 animate-spin" /> loading…
          </div>
        )}

        {schema && !result && (
          <form onSubmit={submit} className="space-y-3 px-4 py-4">
            {fields.map((f) => (
              <Field key={f.name} field={f}
                     value={values[f.name]}
                     onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
            ))}

            {error && (
              <div className="flex items-start gap-2 rounded border border-[#E4C9C2] bg-[#FBF1EE] px-3 py-2 text-xs text-[var(--clay)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <div className="font-medium">The protocol refused this.</div>
                  <div className="mt-0.5">{error}</div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 border-t border-[var(--line-2)] pt-3">
              <button type="submit" disabled={busy || missing.length > 0}
                className="rounded bg-[var(--moss)] px-4 py-2 text-xs font-medium text-white disabled:opacity-40">
                {busy ? 'Working…' : 'Save'}
              </button>
              {missing.length > 0 && (
                <span className="text-[11px] text-[var(--ink-3)]">
                  still needed: {missing.join(', ').replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </form>
        )}

        {result && (
          <div className="px-4 py-4">
            <div className="flex items-center gap-2 text-sm text-[var(--moss)]">
              <CheckCircle2 className="h-4 w-4" /> Done
            </div>
            {result.note && <p className="mt-2 text-xs text-[var(--ink-2)]">{result.note}</p>}
            {result.message && <p className="mt-2 text-xs text-[var(--ink-2)]">{result.message}</p>}
            {result.action_required && (
              <div className="mt-2 rounded bg-[#FBF3DC] px-3 py-2 text-xs text-[#8A6D1F]">
                {result.action_required}
              </div>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-[var(--ink-3)]">what was recorded</summary>
              <pre className="mt-1 max-h-56 overflow-auto rounded bg-[var(--paper-2)] p-2 text-[10px] leading-relaxed">
{JSON.stringify(result, null, 1)}
              </pre>
            </details>
            <button onClick={onClose}
              className="mt-3 rounded bg-[var(--moss)] px-4 py-2 text-xs font-medium text-white">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ field, value, onChange }) {
  const { name, def, required, kind } = field;
  if (kind === 'ref') return <RefField field={field} value={value} onChange={onChange} />;
  if (kind === 'file') return <FileField field={field} value={value} onChange={onChange} />;
  const label = name.replace(/_/g, ' ');
  const base = 'w-full rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--moss)]';
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-xs font-medium capitalize">{label}</span>
        {required && <span className="text-[10px] text-[var(--clay)]">required</span>}
      </div>
      {kind === 'enum' && (
        <select className={base} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {def.enum.map((o) => <option key={o} value={o}>{String(o).replace(/_/g, ' ')}</option>)}
        </select>
      )}
      {kind === 'bool' && (
        <button type="button" onClick={() => onChange(!value)}
          className={`rounded border px-3 py-1.5 text-xs ${value
            ? 'border-[var(--moss)] bg-[var(--moss)] text-white'
            : 'border-[var(--line)] text-[var(--ink-2)]'}`}>
          {value ? 'yes' : 'no'}
        </button>
      )}
      {kind === 'number' && (
        <input type="number" step="any" className={base} value={value ?? ''}
               onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
      )}
      {kind === 'list' && (
        <>
          <textarea rows={3} className={`${base} resize-y`}
                    placeholder={'One per line'}
                    value={Array.isArray(value) ? value.join('\n') : (value ?? '')}
                    onChange={(e) => onChange(e.target.value)} />
          <span className="mt-0.5 block text-[10px] text-[var(--ink-3)]">
            One per line. Commas and semicolons work too.
          </span>
        </>
      )}
      {kind === 'text' && (
        <textarea rows={3} className={`${base} resize-y`} value={value ?? ''}
                  onChange={(e) => onChange(e.target.value)} />
      )}
      {kind === 'line' && (
        <input className={base} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
      {def.description && <p className="mt-1 text-[11px] text-[var(--ink-3)]">{def.description}</p>}
    </label>
  );
}

/**
 * A field that names another row, offered as the things themselves.
 *
 * Falls back to a plain box when the list is empty or could not be fetched —
 * a member's device may not be allowed to run the listing tool, and a select
 * with no options and no escape is a form that cannot be filled in at all.
 */
function RefField({ field, value, onChange }) {
  const { name, def, required } = field;
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const ref = REFERENCES[name];

  useEffect(() => {
    let live = true;
    callTool(ref.via, {})
      .then((r) => {
        if (!live) return;
        const list = Array.isArray(r) ? r : (r?.features ?? r?.rows ?? []);
        if (!Array.isArray(list) || r?.error) { setFailed(true); setRows([]); return; }
        setRows(list);
      })
      .catch(() => { if (live) { setFailed(true); setRows([]); } });
    return () => { live = false; };
  }, [name]);

  const base = 'w-full rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--moss)]';
  const known = (rows ?? []).some((r) => r.id === value);

  return (
    <label className="block">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-xs font-medium capitalize">{name.replace(/_id$/, '').replace(/_/g, ' ')}</span>
        {required && <span className="text-[10px] text-[var(--clay)]">required</span>}
      </div>
      {rows === null ? (
        <div className="flex items-center gap-2 text-[11px] text-[var(--ink-3)]">
          <Loader2 className="h-3 w-3 animate-spin" /> looking…
        </div>
      ) : rows.length || known ? (
        <select className={base} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {/* A value handed in by whatever opened this form — the map panel,
              an action on a list — may not be in the list this tool returns:
              pending_proofs holds only what is still pending, list_tasks only
              what is open. Kept as its own option so a prefilled form never
              silently loses the thing it was opened about. */}
          {!known && value && <option value={value}>{value}</option>}
          {rows.map((r) => (
            <option key={r.id} value={r.id}>{ref.label(r) || r.id}</option>
          ))}
        </select>
      ) : (
        <>
          <input className={base} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
          <span className="mt-0.5 block text-[10px] text-[var(--ink-3)]">
            {failed ? 'The list could not be loaded on this device — paste an id.' : 'Nothing to choose from yet.'}
          </span>
        </>
      )}
      {def.description && <p className="mt-1 text-[11px] text-[var(--ink-3)]">{def.description}</p>}
    </label>
  );
}

/**
 * A photograph, chosen and sent straight away.
 *
 * The upload happens on choosing rather than on Save, so the refusals the store
 * makes — an unsupported type, a file over the limit, a photograph of people
 * with no consent record — arrive next to the thing they are about to be about,
 * instead of after somebody has filled in the rest of the form and pressed a
 * button that then throws all of it away.
 */
function FileField({ field, value, onChange }) {
  const { name, def, required } = field;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [file, setFile] = useState(null);
  const accept = useAccept();
  const which = name.startsWith('before') ? 'before' : name.startsWith('after') ? 'after' : 'the file';

  async function choose(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setErr(null); setFile(f);
    // The coordinate the browser knows, when it is offered and quickly. A
    // photograph of a place IS a coordinate, and asking afterwards is asking
    // somebody who has already walked away. Never blocking: a refused or slow
    // permission prompt must not stop evidence being filed.
    const where = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      const done = (v) => resolve(v);
      const t = setTimeout(() => done({}), 2500);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(t); done({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        () => { clearTimeout(t); done({}); },
        { timeout: 2400, maximumAge: 60000 });
    });
    const out = await uploadFile(f, where);
    setBusy(false);
    if (out?.error) { setErr(out.message || out.error); onChange(''); return; }
    onChange(out.id);
  }

  return (
    <label className="block">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-xs font-medium capitalize">{which === 'the file' ? name.replace(/_/g, ' ') : `The ${which}`}</span>
        {required && <span className="text-[10px] text-[var(--clay)]">required</span>}
      </div>
      <div className={`flex items-center gap-2 rounded border border-dashed px-2.5 py-2 ${
        value ? 'border-[var(--moss)] bg-[var(--paper-2)]' : 'border-[var(--line)]'}`}>
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--ink-3)]" />
              : value ? <ImageIcon className="h-4 w-4 shrink-0 text-[var(--moss)]" />
              : <Upload className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />}
        <input type="file" accept={accept} onChange={choose}
               className="min-w-0 flex-1 text-[11px] text-[var(--ink-2)] file:mr-2 file:rounded
                          file:border-0 file:bg-[var(--paper-3)] file:px-2 file:py-1 file:text-[11px]" />
      </div>
      {value && (
        <p className="mt-1 text-[11px] text-[var(--moss)]">
          {file?.name ?? 'Stored'} — held in this commons, on this machine.
        </p>
      )}
      {err && <p className="mt-1 text-[11px] text-[var(--clay)]">{err}</p>}
      {def.description && !err && <p className="mt-1 text-[11px] text-[var(--ink-3)]">{def.description}</p>}
    </label>
  );
}

/**
 * What the picker offers, asked of the server rather than written here.
 *
 * These two used to be written separately in every project that has ever done
 * this: the picker offers `image/*`, the browser hands over a .tiff, and the
 * server refuses it — a rejection nobody could have predicted, which reads as
 * the upload being broken rather than as a rule. core/media.mjs is the list,
 * /api/media-types serves it, and this holds no second copy.
 *
 * Fetched once for the life of the page. The fallback is deliberately `*` and
 * not a guessed list: if the server cannot be asked, an over-wide picker gets a
 * clear refusal WITH the real list in it, where a guessed list would refuse
 * good files on its own authority and say nothing.
 */
let ACCEPT_CACHE = null;
function useAccept() {
  const [accept, setAccept] = useState(ACCEPT_CACHE);
  useEffect(() => {
    if (ACCEPT_CACHE) return;
    let live = true;
    get('media-types')
      .then((r) => { if (live && r?.accept) { ACCEPT_CACHE = r.accept; setAccept(r.accept); } })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return accept ?? undefined;
}
