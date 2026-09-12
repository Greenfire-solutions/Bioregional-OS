// ── The operator ──────────────────────────────────────────────────────────
// One question: what is waiting on a human right now?
//
// The twelve-stage loop only turns if somebody knows where it has stalled.
// This walks every stage, collects what is blocked or slipped, and ranks it.
// Nothing here invents priorities — each item cites the protocol rule it comes
// from, so a steward can argue with it.
import { all, one } from '../core/db.mjs';
import { carrying, placeAttention } from './attention.mjs';

// blocking  — other work cannot proceed until this moves
// slipped   — a commitment already made has passed its date
// open      — waiting, but nothing is stuck behind it
// gap       — something the protocol expects to exist and does not
const WEIGHT = { blocking: 0, slipped: 1, gap: 2, open: 3 };

export function whatsNext(chapterId) {
  if (!chapterId) return { error: 'no_chapter' };
  const items = [];
  const add = (o) => items.push(o);

  // ── Stage 2: Listen — someone is waiting for an answer ──────────────────
  for (const r of all(
    `SELECT * FROM intake WHERE chapter_id=? AND status='received' ORDER BY created_at`, chapterId)) {
    const days = daysSince(r.created_at);
    add({
      kind: days > 14 ? 'slipped' : 'open',
      stage: 'Listen',
      title: `${r.submitted_by || 'Someone'} brought a ${r.kind} and has had no answer`,
      detail: truncate(r.body, 160),
      age_days: days,
      rule: 'A person must be able to submit a need, receive a response, and appeal.',
      action: { tool: 'respond_to_intake', input: { intake_id: r.id } },
    });
  }

  // ── Stage 4: Map — a discovered dataset nobody has read the terms of ────
  // These sit here rather than approving themselves because accepting somebody
  // else's licence on behalf of a commons is a decision a person has to make.
  // Public-domain datasets never reach this list; they approve on their licence.
  for (const d of all(
    `SELECT * FROM discovered_datasets WHERE chapter_id=? AND status='candidate'
      ORDER BY discovered_at LIMIT 8`, chapterId)) {
    items.push({
      kind: 'gap', stage: 'Map',
      title: `"${truncate(d.title, 60)}" is published locally but nobody has read its licence`,
      detail: `${d.publisher || d.portal || 'A local portal'} — ${d.license_note}`,
      rule: 'Sensitive and third-party material is only published under terms someone has accepted.',
      action: { tool: 'approve_dataset', input: { dataset_id: d.id } },
    });
  }

  // ── Stage 1: Locate — a place with no ecological ground ─────────────────
  for (const p of all(
    `SELECT * FROM places WHERE chapter_id=? AND (watershed_huc IS NULL OR ecoregion_name IS NULL)`,
    chapterId)) {
    add({
      kind: 'gap', stage: 'Locate',
      title: `${p.name} is not matched to a real watershed or ecoregion`,
      detail: 'Until it is, the council cannot name the ecological context it is deciding inside.',
      rule: 'The council must be able to name its watershed, ecoregion, seasonal risks and baseline.',
      action: { tool: 'locate_place', input: { place_id: p.id } },
    });
  }

  // ── Stage 3: Observe — critical signals and stale water ─────────────────
  for (const s of all(
    `SELECT * FROM signals WHERE chapter_id=? AND severity='Critical'
       AND id NOT IN (SELECT signal_id FROM quests WHERE signal_id IS NOT NULL)`, chapterId)) {
    add({
      kind: 'blocking', stage: 'Observe',
      title: `Critical signal with no project behind it: ${s.title}`,
      detail: truncate(s.description, 160),
      rule: 'Observation must lead somewhere, or it is surveillance of a place nobody is helping.',
      action: { tool: 'open_quest', input: { signal_id: s.id, place_id: s.place_id, title: s.title } },
    });
  }
  const lastWater = one(
    `SELECT MAX(observed_at) t FROM signals WHERE chapter_id=? AND source_adapter='usgs'`, chapterId)?.t;
  if (!lastWater || daysSince(lastWater) > 7) {
    add({
      kind: 'gap', stage: 'Observe',
      title: lastWater ? `Water readings are ${daysSince(lastWater)} days old` : 'No live water readings yet',
      detail: 'Public USGS gage data refreshes on demand and needs no account.',
      rule: 'Observe: what are water, soil, species, climate, food, energy and materials showing?',
      action: { tool: 'ingest_water_data', input: {} },
    });
  }
  const unverified = one(
    `SELECT COUNT(*) n FROM signals WHERE chapter_id=? AND verified=0 AND source_adapter!='usgs'`,
    chapterId)?.n ?? 0;
  if (unverified > 0) {
    add({
      kind: 'open', stage: 'Observe',
      title: `${unverified} observation${unverified === 1 ? '' : 's'} nobody has verified`,
      detail: 'Verification is a human act. Nothing verifies itself here.',
      rule: 'Dual intake: ecological conditions are understood through observation, not assumption.',
    });
  }

  // ── Stages 7-8: Design & Build — gates and definitions ──────────────────
  for (const q of all(
    `SELECT * FROM quests WHERE chapter_id=? AND status IN ('Open','Active')`, chapterId)) {
    const openGates = all(
      `SELECT gate FROM quest_gates WHERE quest_id=? AND required=1 AND satisfied=0`, q.id);
    if (openGates.length) {
      add({
        kind: 'blocking', stage: 'Design',
        title: `${q.title} cannot be built — ${openGates.length} gate${openGates.length === 1 ? '' : 's'} open`,
        detail: openGates.map((g) => g.gate.replace(/_/g, ' ')).join(', '),
        rule: 'A high project score never overrides a red flag, missing consent, or an absent maintenance owner.',
        action: { tool: 'satisfy_quest_gate', input: { quest_id: q.id, gate: openGates[0].gate } },
      });
    }
    if (!q.smallest_experiment || !q.maintenance_owner) {
      add({
        kind: 'gap', stage: 'Design',
        title: `${q.title} is not fully defined`,
        detail: [!q.smallest_experiment && 'no smallest useful experiment',
                 !q.maintenance_owner && 'no maintenance owner'].filter(Boolean).join('; '),
        rule: 'Every project defines the smallest useful experiment and who maintains it afterwards.',
        action: { tool: 'update_quest', input: { quest_id: q.id } },
      });
    }
    const hasIndicator = one(
      `SELECT COUNT(*) n FROM indicators WHERE quest_id=? AND baseline_value IS NOT NULL`, q.id)?.n ?? 0;
    if (!hasIndicator && ['prototype', 'teach_tell', 'test', 'decide'].includes(q.stage)) {
      add({
        kind: 'blocking', stage: 'Measure',
        title: `${q.title} is being built with nothing to measure it against`,
        detail: 'No indicator carries a baseline, so no result can ever show change.',
        rule: 'Every major project includes a baseline, target, review date and adaptation rule.',
        action: { tool: 'add_indicator', input: { quest_id: q.id } },
      });
    }
  }

  // ── Stage 5: Convene — decisions due, red flags open ────────────────────
  for (const d of all(
    `SELECT * FROM decisions WHERE chapter_id=? AND status='decided'
       AND review_date IS NOT NULL AND date(review_date) <= date('now')`, chapterId)) {
    add({
      kind: 'slipped', stage: 'Convene',
      title: `Review date has passed: ${d.title}`,
      detail: `Due ${d.review_date}. A review date that passes unnoticed is the same as no review date.`,
      age_days: daysSince(d.review_date),
      rule: 'Monitoring must change decisions.',
      action: { tool: 'council_agenda', input: {} },
    });
  }
  for (const d of all(
    `SELECT * FROM decisions WHERE chapter_id=? AND red_flags IS NOT NULL AND red_flags != ''`, chapterId)) {
    add({
      kind: 'blocking', stage: 'Convene',
      title: `Red flag open on: ${d.title}`,
      detail: truncate(d.red_flags, 160),
      rule: 'A red flag blocks a decision. It is answered, not outvoted.',
      action: { tool: 'clear_red_flag', input: { decision_id: d.id } },
    });
  }
  for (const d of all(
    `SELECT * FROM decisions WHERE chapter_id=? AND status='proposed'`, chapterId)) {
    add({
      kind: 'open', stage: 'Convene',
      title: `Waiting on council: ${d.title}`,
      detail: `Method: ${d.method.replace(/_/g, ' ')}`,
      age_days: daysSince(d.created_at),
      rule: 'Decisions are made at the smallest scale capable of holding the consequences.',
      action: { tool: 'decide_council_item', input: { decision_id: d.id } },
    });
  }

  // ── Stage 11: Measure — indicators nobody reads ─────────────────────────
  for (const ind of all(
    `SELECT i.*, (SELECT MAX(measured_at) FROM measurements m WHERE m.indicator_id=i.id) last_at
       FROM indicators i WHERE i.chapter_id=?`, chapterId)) {
    if (!ind.last_at) {
      add({
        kind: 'gap', stage: 'Measure',
        title: `"${ind.name}" has a baseline but has never been measured again`,
        detail: ind.decision_trigger ? `Trigger: ${truncate(ind.decision_trigger, 120)}` : null,
        rule: 'Measure: what changed, for whom, and with what uncertainty?',
        action: { tool: 'record_measurement', input: { indicator_id: ind.id } },
      });
    } else if (ind.target_by && new Date(ind.target_by) < new Date() &&
               new Date(ind.last_at) < new Date(ind.target_by)) {
      add({
        kind: 'slipped', stage: 'Measure',
        title: `"${ind.name}" passed its target date without a reading`,
        detail: `Target was ${ind.target_by}; last measured ${ind.last_at}.`,
        age_days: daysSince(ind.target_by),
        rule: 'Monitoring must change decisions.',
        action: { tool: 'record_measurement', input: { indicator_id: ind.id } },
      });
    }
  }

  // ── Stage 10: Exchange & Care ───────────────────────────────────────────
  for (const e of all(
    `SELECT e.*, a.name provider FROM exchange_events e LEFT JOIN agents a ON a.id=e.provider_id
      WHERE e.chapter_id=? AND e.terms_ack=0 AND e.relationship!='volunteer'`, chapterId)) {
    add({
      kind: 'blocking', stage: 'Exchange',
      title: `${e.provider || 'Someone'} is doing ${e.relationship.replace(/_/g, ' ')} work with no agreed terms`,
      detail: e.resource_name,
      rule: 'Before work begins, contributors understand compensation, ownership, verification, exit and return.',
    });
  }
  for (const g of all(
    `SELECT * FROM gatherings WHERE chapter_id=?
       AND (care_meals+care_transport+care_childcare+care_accessibility) < 2
       AND (starts_at IS NULL OR date(starts_at) >= date('now'))`, chapterId)) {
    add({
      kind: 'gap', stage: 'Exchange',
      title: `${g.title} has almost no care provision`,
      detail: 'Meals, transport, childcare, accessibility — fewer than two of four.',
      rule: 'Ecological work fails when people are exhausted, excluded, unpaid, unsafe or unsupported.',
      action: { tool: 'add_gathering', input: { title: g.title } },
    });
  }

  // A person carrying most of the open work is a blocking item, and the stage
  // it belongs to is Exchange & Care — the same mandate as unpaid hours and
  // missing childcare, arriving through a different column. It is blocking
  // rather than open because everything that person holds is queued behind one
  // human's remaining capacity, which is the definition the top of this file
  // gives. The wording addresses the council, never the person: they are the
  // last one who will raise it, and telling somebody they are overloaded is
  // not the same as relieving them.
  try {
    const care = carrying(chapterId);
    for (const name of care.overloaded ?? []) {
      const p = care.people.find((x) => x.name === name);
      if (!p) continue;
      add({
        kind: 'blocking', stage: 'Exchange',
        title: `${p.name} is named on ${p.holding} of ${care.total_open} open responsibilities`,
        detail: `Longest held: ${p.longest_held?.of ?? '—'}, ${p.longest_held_days} days. ` +
                'Somebody else has to offer to take one.',
        age_days: p.longest_held_days,
        rule: 'Exhaustion is a failure of the commons, not of the person carrying it.',
        action: { tool: 'carrying', input: {} },
      });
    }
    // Work whose owner is a committee. A Design gap, not a care one: the
    // maintenance-owner gate is satisfied in the field and unsatisfied in the
    // world, and no amount of relieving anybody fixes it.
    for (const u of (care.owned_by_a_group ?? []).slice(0, 3)) {
      add({
        kind: 'gap', stage: 'Design',
        title: `${u.of} is kept alive by ${u.name}, not by a person`,
        detail: u.certain
          ? 'Registered as an organisation. Ask which member would notice if the work stopped.'
          : 'That name reads like a group. If it is one person, ignore this.',
        rule: 'No project proceeds without a named maintenance owner and an end-of-life plan.',
        action: { tool: 'carrying', input: {} },
      });
    }
    for (const l of care.held_too_long ?? []) {
      if ((care.overloaded ?? []).includes(l.name)) continue;   // already said, louder
      add({
        kind: 'open', stage: 'Exchange',
        title: `${l.name} has held the same responsibility for ${l.days} days`,
        detail: 'Worth asking whether they still want it. Nothing is wrong.',
        age_days: l.days,
        rule: 'Exhaustion is a failure of the commons, not of the person carrying it.',
        action: { tool: 'carrying', input: {} },
      });
    }
  } catch { /* a chapter with no ledger yet has nobody carrying anything */ }

  // Ground nobody has been to. A gap rather than a slip: no commitment was
  // broken, and the place is not going to complain.
  try {
    const att = placeAttention(chapterId, { days: 90 });
    for (const n of (att.neglected ?? []).slice(0, 3)) {
      add({
        kind: 'gap', stage: 'Observe',
        title: n.never_visited
          ? `Nobody has been to ${n.name} since it was added`
          : `Nobody has been to ${n.name} in ${n.days_since} days`,
        detail: n.open_work
          ? `${n.open_work} open project${n.open_work === 1 ? '' : 's'} there.`
          : 'Gage readings are not visits — only what a person recorded counts here.',
        age_days: n.days_since ?? n.added_days_ago,
        rule: 'Observation must lead somewhere, or it is surveillance of a place nobody is helping.',
        action: { tool: 'place_attention', input: {} },
      });
    }
  } catch { /* no places yet */ }

  // ── Stage 12: Adapt & Replicate ─────────────────────────────────────────
  for (const q of all(
    `SELECT * FROM quests WHERE chapter_id=? AND status='Complete'
       AND id NOT IN (SELECT quest_id FROM learn WHERE quest_id IS NOT NULL)`, chapterId)) {
    add({
      kind: 'gap', stage: 'Replicate',
      title: `${q.title} finished and nothing was written down`,
      detail: 'Knowledge that is not documented cannot travel, and will be relearned from scratch.',
      rule: 'Methods are documented so other places can adapt them without extracting local culture.',
      action: { tool: 'publish_learning', input: { quest_id: q.id, title: q.title } },
    });
  }

  // ── Data / AI engine ────────────────────────────────────────────────────
  for (const c of all(
    `SELECT * FROM media_consent WHERE chapter_id=? AND withdrawn_at IS NOT NULL`, chapterId)) {
    add({
      kind: 'blocking', stage: 'Media',
      title: `Consent withdrawn: ${c.subject}`,
      detail: `Anything published under "${c.purpose}" must come down or be re-cleared.`,
      rule: 'Knowledge holders determine what may be recorded, shared, archived or kept private.',
    });
  }
  const unreviewedAI = one(
    `SELECT COUNT(*) n FROM ai_log WHERE chapter_id=? AND human_reviewer IS NULL`, chapterId)?.n ?? 0;
  if (unreviewedAI) {
    add({
      kind: 'blocking', stage: 'Data / AI',
      title: `${unreviewedAI} AI output${unreviewedAI === 1 ? '' : 's'} with no human reviewer`,
      rule: 'AI assists but does not govern. Every material use names a human reviewer.',
    });
  }

  items.sort((a, b) =>
    (WEIGHT[a.kind] - WEIGHT[b.kind]) || ((b.age_days ?? 0) - (a.age_days ?? 0)));

  const byKind = items.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {});
  return {
    chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
    generated_at: new Date().toISOString(),
    total: items.length,
    by_kind: byKind,
    // The one thing to do first, when someone has ten minutes and no idea where to start.
    first: items[0] ?? null,
    items,
  };
}

function daysSince(ts) {
  if (!ts) return 0;
  const d = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
function truncate(s, n) {
  if (!s) return null;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
