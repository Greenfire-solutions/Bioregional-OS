// ── The heartbeat ─────────────────────────────────────────────────────────
// The machine tending itself while it is running.
//
// Deliberately NOT launchd. On macOS, launchd agents cannot read anything under
// ~/Desktop or ~/Documents without a TCC grant, and they fail *silently* when
// they can't — a scheduler that lies about running is worse than none. The OS
// is something you start; while it is up, it keeps itself current.
import { all, one, run, create } from '../core/db.mjs';
import * as bio from './bioregional.mjs';
import { whatsNext } from './operator.mjs';

const MINUTE = 60_000;

const TASKS = [
  {
    name: 'locate_places',
    every: 6 * 60 * MINUTE,
    why: 'A place with no watershed or ecoregion cannot ground a council decision.',
    async run(chapterId) {
      const pending = all(
        `SELECT id, name FROM places WHERE chapter_id=? AND (watershed_huc IS NULL OR ecoregion_name IS NULL)`,
        chapterId);
      if (!pending.length) return null;
      let done = 0;
      for (const p of pending) {
        try { await bio.locate(p.id); done++; } catch { /* offline; try again next beat */ }
      }
      return done ? `located ${done} place${done === 1 ? '' : 's'}` : null;
    },
  },
  {
    name: 'refresh_water',
    every: 3 * 60 * MINUTE,
    why: 'Public USGS gage data is free, and stale water readings mislead the Land Seat.',
    async run(chapterId) {
      const places = all('SELECT id FROM places WHERE chapter_id=? AND lat IS NOT NULL', chapterId);
      let added = 0, updated = 0;
      for (const p of places) {
        try {
          const r = await bio.ingestWater(p.id);
          added += r.added ?? 0; updated += r.updated ?? 0;
        } catch { /* offline */ }
      }
      return (added || updated) ? `water: ${added} new, ${updated} updated` : null;
    },
  },
  {
    name: 'watch_reviews',
    every: 60 * MINUTE,
    why: 'A review date that passes unnoticed is the same as having no review date.',
    async run(chapterId) {
      const due = all(
        `SELECT title, review_date FROM decisions WHERE chapter_id=? AND status='decided'
           AND review_date IS NOT NULL AND date(review_date) <= date('now')`, chapterId);
      return due.length
        ? `${due.length} decision${due.length === 1 ? '' : 's'} past review: ${due.map((d) => d.title).join('; ')}`
        : null;
    },
  },
  {
    name: 'take_stock',
    every: 30 * MINUTE,
    why: 'Someone should always be able to ask what needs doing and get an answer.',
    async run(chapterId) {
      const n = whatsNext(chapterId);
      if (n.error || !n.total) return null;
      const blocking = n.by_kind.blocking ?? 0;
      return `${n.total} open · ${blocking} blocking · first: ${n.first.title}`;
    },
  },
];

const log = [];           // in-memory; the durable record is the data itself
let timers = [];
let started = null;

export function start(chapterId, { quiet = false } = {}) {
  if (timers.length) return;
  started = new Date().toISOString();

  for (const task of TASKS) {
    const tick = async () => {
      const t0 = Date.now();
      try {
        const result = await task.run(chapterId);
        if (result) {
          const entry = { at: new Date().toISOString(), task: task.name, result, ms: Date.now() - t0 };
          log.unshift(entry);
          log.length = Math.min(log.length, 200);
          if (!quiet) console.log(`  ♦ ${task.name}: ${result}`);
        }
      } catch (err) {
        log.unshift({ at: new Date().toISOString(), task: task.name, error: err.message });
      }
    };
    // Stagger the first run so starting the OS is not a thundering herd.
    const delay = 8_000 + TASKS.indexOf(task) * 12_000;
    const t = setTimeout(() => { tick(); timers.push(setInterval(tick, task.every)); }, delay);
    timers.push(t);
  }
  return TASKS.map((t) => ({ name: t.name, every_minutes: t.every / MINUTE, why: t.why }));
}

export function stop() {
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  timers = [];
}

export function status() {
  return {
    running: timers.length > 0,
    started,
    tasks: TASKS.map((t) => ({
      name: t.name,
      every_minutes: t.every / MINUTE,
      why: t.why,
      last: log.find((l) => l.task === t.name) ?? null,
    })),
    recent: log.slice(0, 30),
    note: 'The heartbeat runs only while the OS is running. Nothing happens when it is closed — ' +
          'that is deliberate: a scheduler that fails silently is worse than no scheduler.',
  };
}
