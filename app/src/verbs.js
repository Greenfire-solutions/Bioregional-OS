// ── What a button says ────────────────────────────────────────────────────
// One label per tool, in one place.
//
// There were three copies — Today.jsx, Commons.jsx and MapPanel.jsx — and by
// the time anybody looked, eight of twenty had already drifted: "Respond" and
// "Answer", "Open a project" and "Start a project", "Resolve flag" and
// "Resolve the flag", "Pull water data" and "Pull the data". Nothing broke.
// The same button simply said different things depending on which screen you
// were standing on, which is how an interface stops feeling like one thing.
//
// This is the one-registry rule applied to wording: a tool is added here once,
// and every button that runs it says the same word.
//
// A verb, not a name. `satisfy_quest_gate` tells a person nothing; "Close a
// gate" tells them what is about to happen. Where no label exists the fallback
// un-snakes the tool name, which is ugly on purpose — an ugly button is a
// reminder to add the row.

const VERB = {
  // the work
  open_quest: 'Start a project',
  update_quest: 'Define it',
  advance_quest: 'Advance a stage',
  satisfy_quest_gate: 'Close a gate',
  override_gate: 'Pass it, with a reason',
  add_indicator: 'Add a measure',
  record_measurement: 'Record a reading',
  set_indicator_baseline: 'Set the baseline',

  // the work inside a project
  add_task: 'Add a task',
  claim_task: 'I will do this',
  release_task: 'Step back',
  complete_task: 'Mark it done',
  set_task_status: 'Change its state',
  task_board: 'See the work',
  // Not "Upload evidence". Two photographs of the same ground is what a person
  // is actually about to go and take, and the button says that.
  submit_proof: 'Add the before & after',
  review_proof: 'Check this work',
  pending_proofs: 'See what needs checking',
  check_evidence: 'Check the evidence is still there',
  withdraw_media: 'Withdraw this file',

  // listening and council
  submit_intake: 'Bring a need',
  respond_to_intake: 'Answer',
  propose_decision: 'Propose to council',
  decide_council_item: 'Decide',
  clear_red_flag: 'Resolve the flag',
  council_agenda: 'Open the agenda',

  // the ground
  add_place: 'Add the place',
  add_signal: 'Write it down',
  add_agent: 'Name them',
  locate_place: 'Locate it',
  ingest_water_data: 'Pull the water data',
  download_region: 'Download this region',
  approve_dataset: 'Read the licence',

  // people and care
  add_gathering: 'Schedule a gathering',
  update_gathering: 'Add care',
  record_exchange: 'Log a contribution',
  name_deputy: 'Name a deputy',
  carrying: 'See who is carrying it',
  who_could_help: 'See who could help',
  place_attention: 'See where nobody has been',

  // devices — a second person writing, without an account
  invite_device: 'Add a device',
  enrol_device: 'Join with this code',
  revoke_device: 'Revoke',
  list_devices: 'See the devices',

  // the week
  the_round: 'See this week',
  set_aside: 'Not this week',

  // what travels
  // A verb for the person, not for the machine: they are not "generating a
  // weekly card", they are writing to the group. The OS never sends it.
  card_for_the_week: 'Write to the group',
  publish_learning: 'Write it up',
  open_season: 'Open the season',
  close_season: 'Close the season',
  look_around: 'Find my bioregion',
  discover_peers: 'Find the neighbours',
};

export function verb(tool) {
  return VERB[tool] ?? String(tool ?? '').replace(/_/g, ' ');
}

/**
 * The tools this file has a label for. Exported so the suite can assert they
 * all still exist — a row here for a renamed tool is a label nothing will ever
 * show, and the fallback quietly prints the snake_case name instead.
 */
export const VERB_NAMES = Object.keys(VERB);

export default VERB;
