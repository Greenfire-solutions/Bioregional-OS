import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { callTool, get } from '../api.js';

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
        kind: def.enum ? 'enum' : def.type === 'boolean' ? 'bool'
            : def.type === 'number' ? 'number'
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
