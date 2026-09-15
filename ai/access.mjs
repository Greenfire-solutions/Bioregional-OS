// ── What a connection may ask the registry to do ──────────────────────────
// server/clearance.mjs decides what a connection has EARNED: `sacred` at the
// steward's own keyboard, `members` or `council` for an enrolled device, and
// `public` for a stranger on the wifi. It was consulted by three export routes
// and by nothing else. `POST /api/tool` ran every tool in the registry for
// whoever asked — so with --share on, anybody on the gathering wifi could
// mint themselves a coordinator code, revoke the steward's devices, or decide
// a council item, and the enrolment engine beneath it, hashed tokens and
// constant-time compares and all, protected a door that was never closed.
//
// This is the door. One policy, stated once, read by runTool on every call
// that arrived over a network.
//
// THE DEFAULT IS THE KEYBOARD. A tool not named here can only be run from the
// machine the commons lives on. That is the direction a mistake should fail in:
// forgetting to list a new tool makes it unreachable from the wifi, which
// somebody notices and fixes, rather than reachable by strangers, which nobody
// notices at all. Local callers — Claude Code over MCP, the in-app assistant,
// the test suite, the prover — are the steward's own process and are never
// gated by this.
//
// The tiers follow the sensitivity ladder because a device's role IS its
// clearance (see ROLE_CLEARANCE in engines/enrol.mjs), so there is exactly one
// ladder in the system and not a second one for verbs.
//
//   public    a stranger who scanned the code on the wall. The join page.
//             Bringing a need, noticing something, saying they are coming,
//             and redeeming an invitation. Nothing that reads the commons.
//   members   an enrolled device. Reads the commons at members level and does
//             ordinary field work: places, readings, gatherings, contributions.
//   council   a coordinator's device. Council work: proposing and deciding,
//             answering needs, closing gates, the season.
//   keyboard  everything else. Founding, consent, devices, overrides, the
//             deputy, publishing to the world, anything that reads or writes
//             this machine's files.
//
// Two placements that are judgement rather than lookup:
//
//   satisfy_quest_gate is council, not members, because three of the gates it
//   closes are the ones that never graduate — rights-holder consent, indigenous
//   consent, youth safeguarding — and the test for those is whether the person
//   clicking could be the person the gate protects. A device enrolled in a
//   room is a device somebody handed over, not a council.
//
//   record_consent and withdraw_consent stay at the keyboard. A consent record
//   is the one row a rights-holder may later ask to see honoured, and the
//   protocol's whole position is that nothing over a network reaches what
//   they protect. Writing the record from the wifi would be a promise the
//   transport cannot keep.

import { LADDER } from '../server/clearance.mjs';

const PUBLIC = [
  // Bringing something.
  'submit_intake', 'add_signal', 'rsvp_to_gathering', 'enrol_device',
  // And ONE read, which is the day clock.
  //
  // This list was four tools and every one of them was a write. A stranger
  // handed a link could contribute to the commons and could not look at it,
  // which is exactly inverted from how people use community software: the 90 in
  // 90-9-1 participate BY READING, and most lurkers report that browsing IS
  // their participation rather than a phase before it. DAILY_USE.md §4 already
  // specified the day clock as "60 seconds, ANYONE — it gives before it asks",
  // and the OS was delivering it to nobody.
  //
  // `ground_today` is the only read here, and it does not hand over the
  // commons: it declares a `public_view` in the registry, an ALLOWLIST that
  // drops coordinates, the place id, and the chapter's own historical records,
  // leaving the sky, the weather, the gage and an upstream species feed. See
  // forAStranger() in engines/ground.mjs for what is excluded and why.
  //
  // The comment above still holds for everything else: nothing else here reads
  // the commons. `this_week_last_year` in particular stays at members, because
  // it is made ENTIRELY of the chapter's own records — the part the projection
  // deliberately removes.
  'ground_today',
];

const MEMBERS = [
  // reading the commons
  'chapter_status', 'list_places', 'get_ecoregion_layer', 'list_signals', 'list_quests',
  'quest_gates', 'check_quest_advance', 'council_agenda', 'minimum_viable_test',
  'benefit_flow', 'list_indicators', 'list_gatherings', 'list_agents', 'list_atlas_layers',
  'this_week_last_year', 'soil_at', 'life_here', 'hazards_at',
  'upstream_sources', 'what_moved', 'intake_promise', 'carrying', 'place_attention',
  'vitals', 'neighbours', 'seasons', 'land_seat_brief', 'quest_score',
  'seasonal_priorities', 'map_features', 'commons_board', 'who_could_help',
  'list_discovered', 'card_for_the_week', 'community_here', 'culture_here',
  'growing_year', 'water_here', 'whats_next', 'the_round', 'library_status', 'list_regions',
  'region_brief', 'find_species', 'settling_in',
  // The work inside the projects. Reading it, writing it down, picking it up,
  // putting it down, and filing the evidence — all of it ordinary field work by
  // somebody holding a device a steward handed them in a room.
  'list_tasks', 'task_board', 'pending_proofs', 'list_media',
  // ordinary field work
  'add_place', 'locate_place', 'ingest_water_data', 'record_measurement', 'add_indicator',
  'propose_baseline', 'set_indicator_baseline', 'add_gathering', 'update_gathering',
  'record_exchange', 'publish_learning', 'mark_card_sent', 'add_hub', 'add_agent',
  'open_quest', 'update_quest',
  // Adding a task, taking one on, stepping back, finishing one, and filing a
  // before-and-after. `complete_task` is here rather than in COUNCIL on
  // purpose: it already refuses without evidence, so the control on closing
  // work is the evidence, not a rank. Requiring a coordinator to close a task
  // somebody finished in the mud is how a board fills with work that is done.
  'add_task', 'claim_task', 'release_task', 'complete_task', 'set_task_status',
  'submit_proof',
  // Setting something aside is housekeeping on the week, not a protocol gate —
  // the work is untouched and stays in whats_next. A member doing the round is
  // the point of there being a round.
  'set_aside',
];

// Sharing is a decision about a room, made at the machine the commons lives on.
// Not listed anywhere below: unlisted means keyboard, which is the right
// direction for this one. A device on the wifi must never be able to widen the
// door it came through, and `sharing_status` is at the keyboard too, because
// telling a stranger whether the wifi door is open is telling them about a door.

const COUNCIL = [
  'propose_decision', 'decide_council_item', 'clear_red_flag', 'satisfy_quest_gate',
  'advance_quest', 'respond_to_intake', 'list_intake', 'season_review', 'open_season',
  'close_season', 'register_atlas_layer', 'discover_peers', 'discover_local_data',
  'murmurations_profile', 'approve_dataset', 'decline_dataset',
  // Checking somebody else's evidence is the act that turns a photograph into a
  // record the commons stands behind, so it sits where the other acts of
  // saying-this-is-so sit. The engine separately refuses a check signed by the
  // person who submitted it, which is the rule that actually matters; this is
  // about who is doing the checking, not about whether the rule is enforced.
  'review_proof',
];

// `withdraw_media` and `check_evidence` are unlisted, which means the keyboard.
// Withdrawal destroys bytes on the steward's disk and is the counterpart of
// withdraw_consent, which is at the keyboard for the same reason: it is the one
// row a rights holder may later ask to see honoured. Re-hashing the whole store
// reads every file this machine holds.

const REQUIRED = new Map();
/**
 * A tool named in two tiers is resolved by whichever list is walked last, which
 * is insertion order in this file and nothing a reader would think to check.
 * Moving `ground_today` to PUBLIC while it was still listed in MEMBERS left it
 * members-only, silently, and the only symptom was a stranger being refused a
 * tool the policy said was public.
 *
 * The direction of the accident matters: MEMBERS is walked after PUBLIC, so a
 * duplicate currently fails SAFE. Walk the lists in another order one day and
 * the same mistake hands a stranger a council tool. Refuse the ambiguity rather
 * than depending on the order being the lucky one.
 */
const claim = (name, tier) => {
  if (REQUIRED.has(name) && REQUIRED.get(name) !== tier) {
    throw new Error(
      `ai/access.mjs: ${name} is listed in two tiers (${REQUIRED.get(name)} and ${tier}). ` +
      'A tool has one clearance. Remove it from the one that is wrong.');
  }
  REQUIRED.set(name, tier);
};
for (const n of PUBLIC) claim(n, 'public');
for (const n of MEMBERS) claim(n, 'members');
for (const n of COUNCIL) claim(n, 'council');

/** The keyboard, spelled as the top of the ladder so one comparison serves. */
export const KEYBOARD = 'sacred';

/** The clearance a tool needs. Unlisted means the keyboard. */
export function requiredFor(name) {
  return REQUIRED.get(name) ?? KEYBOARD;
}

/** Whether a connection at `clearance` may run `name`. */
export function mayRun(name, clearance) {
  const need = LADDER.indexOf(requiredFor(name));
  const have = LADDER.indexOf(clearance);
  return have >= 0 && have >= need;
}

/** The refusal, worded for the person holding the device rather than the code. */
export function refusal(name, clearance) {
  const need = requiredFor(name);
  const message = need === KEYBOARD
    ? `${name} is done at the computer the commons lives on, not over the wifi.`
    : need === 'council'
      ? `${name} is council work. This device is enrolled as a member; a coordinator's device or the steward's computer can do it.`
      : `${name} needs a device enrolled in this commons. Ask the steward for a code.`;
  return { error: 'not_from_here', message, needs: need, has: clearance };
}

/** Every name the policy mentions, so a test can check none has gone stale. */
export const POLICY_NAMES = [...PUBLIC, ...MEMBERS, ...COUNCIL];

/**
 * The tiers themselves, so the suite can assert the property `claim()` enforces
 * — no tool in two of them — rather than only catching it when the module
 * throws at import time, which is a failure with no name attached to it.
 */
export const PUBLIC_NAMES = [...PUBLIC];
export const MEMBERS_NAMES = [...MEMBERS];
export const COUNCIL_NAMES = [...COUNCIL];
