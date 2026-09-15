// ── The work inside a project ─────────────────────────────────────────────
// A quest is a project: a need, a desired condition, a smallest experiment,
// nine gates. Useful, and not something a person can pick up on a Saturday.
//
// A task is what somebody actually does. It has a place, a person, and — when
// it changes something on the land — a before and an after.
//
// Three refusals live here, and each one exists because the alternative is a
// commons that cannot tell work from the claim of work:
//
//   • a task that changes the land does not close without evidence
//   • nobody is removed from a task, they are released, with the record kept
//   • the person who did it is not the person who checks it
//
// The gates on the quest are NOT re-implemented here. A project's protocol
// state is engines/quest.mjs's business and a second copy of "is this allowed
// to proceed" is how two screens come to disagree about one project.
import { all, one, create, run } from '../core/db.mjs';
import { STAGES } from './quest.mjs';

export const STATUS = Object.freeze(['todo', 'doing', 'blocked', 'done', 'abandoned']);
export const ROLES = Object.freeze(['doing', 'leading', 'helping', 'teaching', 'learning']);

/**
 * Add a task to a project.
 *
 * The chapter comes from the QUEST, never from the caller. A task filed against
 * a project in another chapter is not a task, it is two commons quietly sharing
 * a row, and the sensitivity ladder is per chapter.
 */
export function addTask(input = {}) {
  const questId = String(input.quest_id ?? '').trim();
  const title = String(input.title ?? '').trim();
  if (!questId) return { error: 'missing_required', message: 'A task belongs to a project. Pass quest_id.' };
  if (!title) return { error: 'missing_required', message: 'A task needs a title — what somebody is actually going to do.' };

  const quest = one('SELECT id, chapter_id, title, place_id, lat, lng FROM quests WHERE id=?', questId);
  if (!quest) return { error: 'not_found', message: `No project ${questId}.` };

  if (input.stage && !STAGES.includes(input.stage)) {
    return {
      error: 'unknown_stage',
      message: `"${input.stage}" is not one of the twelve stages.`,
      stages: STAGES,
    };
  }

  const nextIndex = (one('SELECT MAX(order_index) m FROM tasks WHERE quest_id=?', questId)?.m ?? -1) + 1;

  // A coordinate is kept only when BOTH halves are present. lat and lng are
  // independent nullable columns, so a task with a latitude and no longitude is
  // a row the map draws at [null, 30] and the panel renders by calling
  // .toFixed on null. The map's own locate() makes the same check for the same
  // reason; making it here as well means a half-coordinate never reaches the row.
  const hasPoint = input.lat != null && input.lng != null
    && Number.isFinite(Number(input.lat)) && Number.isFinite(Number(input.lng));

  const task = create('tasks', 'task', quest.chapter_id, {
    chapter_id: quest.chapter_id,
    quest_id: questId,
    title,
    description: input.description ?? null,
    stage: input.stage ?? null,
    status: STATUS.includes(input.status) ? input.status : 'todo',
    order_index: Number.isInteger(input.order_index) ? input.order_index : nextIndex,
    place_id: input.place_id ?? quest.place_id ?? null,
    lat: hasPoint ? Number(input.lat) : null,
    lng: hasPoint ? Number(input.lng) : null,
    due_at: input.due_at ?? null,
    // Default ON, and switching it off is a deliberate act by whoever writes
    // the task. `input.requires_before_after === false` is the only thing that
    // turns it off — an absent field means the default, not "no".
    requires_before_after: input.requires_before_after === false ? 0 : 1,
    created_by: input.created_by ?? null,
  }, input.sensitivity ?? 'members');

  return { ...task, project: quest.title, assignees: [], proofs: [] };
}

export function getTask(taskId) {
  const t = one('SELECT * FROM tasks WHERE id=?', taskId);
  if (!t) return null;
  return decorate(t);
}

export function listTasks(chapterId, { quest_id = null, status = null, unclaimed = false } = {}) {
  if (!chapterId) return { error: 'no_chapter', tasks: [] };
  const where = ['t.chapter_id = ?'];
  const args = [chapterId];
  if (quest_id) { where.push('t.quest_id = ?'); args.push(quest_id); }
  if (status) { where.push('t.status = ?'); args.push(status); }
  const rows = all(
    `SELECT t.*, q.title project_title, q.stage project_stage
       FROM tasks t JOIN quests q ON q.id = t.quest_id
      WHERE ${where.join(' AND ')}
      -- rowid last, always. Two tasks written in the same minute with the same
      -- order_index otherwise sort arbitrarily, so a list re-reads in a
      -- different order each time and nothing anywhere reports that it did.
      ORDER BY t.quest_id, t.order_index, t.created_at, t.rowid`, ...args);
  let tasks = rows.map(decorate);
  if (unclaimed) tasks = tasks.filter((t) => !t.assignees.length && t.status !== 'done');
  return tasks;
}

/** Everything about a task that is not in its own row. */
function decorate(t) {
  const assignees = all(
    `SELECT id, person_id, person_name, role, assigned_at, released_at, released_reason
       FROM task_assignees WHERE task_id=? AND released_at IS NULL
      ORDER BY assigned_at, rowid`, t.id);
  const past = all(
    `SELECT person_name, role, assigned_at, released_at, released_reason
       FROM task_assignees WHERE task_id=? AND released_at IS NOT NULL ORDER BY released_at DESC`, t.id);
  const proofs = all(
    `SELECT p.id, p.status, p.note, p.submitted_by, p.created_at, p.reviewed_by, p.reviewed_at,
            p.review_note, p.before_media_id, p.after_media_id,
            bm.withdrawn_at before_withdrawn, am.withdrawn_at after_withdrawn
       FROM proofs p
       LEFT JOIN media bm ON bm.id = p.before_media_id
       LEFT JOIN media am ON am.id = p.after_media_id
      WHERE p.task_id=? ORDER BY p.created_at DESC, p.rowid DESC`, t.id);
  return {
    ...t,
    requires_before_after: !!t.requires_before_after,
    assignees,
    released: past,
    proofs,
    // What is actually true about this task right now, said once here so that
    // the map, the list and the panel cannot each work it out differently.
    evidence: t.requires_before_after
      ? (proofs.some((p) => p.status === 'verified') ? 'verified'
        : proofs.length ? 'submitted' : 'none')
      : 'not_required',
  };
}

/**
 * Take a task on.
 *
 * Self-service on purpose. A commons where work has to be handed out by a
 * coordinator is a commons that stops when the coordinator is away, and the
 * failure mode of open claiming — two people claiming the same thing — is
 * visible, cheap, and fixed by them talking to each other.
 */
export function claimTask(taskId, { person_name, person_id = null, role = 'doing' } = {}) {
  const name = String(person_name ?? '').trim();
  if (!name) {
    return {
      error: 'missing_required',
      message: 'A claim needs a name. Not a login — a name, so the commons can say who is carrying this.',
    };
  }
  const t = one('SELECT * FROM tasks WHERE id=?', taskId);
  if (!t) return { error: 'not_found', message: `No task ${taskId}.` };
  if (t.status === 'done') {
    return { error: 'already_done', message: `"${t.title}" is already finished.`, task: decorate(t) };
  }
  if (!ROLES.includes(role)) role = 'doing';

  const already = one(
    'SELECT id FROM task_assignees WHERE task_id=? AND person_name=? AND released_at IS NULL', taskId, name);
  if (already) {
    return { already: true, message: `${name} is already on this task.`, task: decorate(t) };
  }

  try {
    create('task_assignees', 'assignment', t.chapter_id, {
      task_id: taskId, person_id, person_name: name, role,
    }, 'members');
  } catch (err) {
    // The partial unique index fired, which means somebody else's identical
    // claim landed between the read above and this write. That is the race the
    // index exists for, and it is not an error worth showing a person.
    if (/UNIQUE|constraint/i.test(err.message)) {
      return { already: true, message: `${name} is already on this task.`, task: decorate(t) };
    }
    throw err;
  }
  // Picking something up moves it, so the board does not need a second act to
  // say the obvious. Only from todo: a task somebody marked blocked stays
  // blocked, because that was a statement about the world, not about staffing.
  if (t.status === 'todo') run("UPDATE tasks SET status='doing' WHERE id=?", taskId);
  return { claimed: true, task: getTask(taskId) };
}

/**
 * Step back from a task. The row stays.
 *
 * Deleting it would make the record say that person was never there, which is
 * the same mistake the people and devices tables refuse with triggers — and a
 * task that three people carried before it was finished is a fact about the
 * commons worth more than a tidy list.
 */
export function releaseTask(taskId, { person_name, reason = null } = {}) {
  const name = String(person_name ?? '').trim();
  if (!name) return { error: 'missing_required', message: 'Who is stepping back?' };
  const row = one(
    'SELECT id FROM task_assignees WHERE task_id=? AND person_name=? AND released_at IS NULL', taskId, name);
  if (!row) return { error: 'not_found', message: `${name} is not currently on that task.` };
  run(`UPDATE task_assignees SET released_at=datetime('now'), released_reason=? WHERE id=?`,
    reason ? String(reason).trim() : null, row.id);
  const t = one('SELECT * FROM tasks WHERE id=?', taskId);
  const left = all('SELECT id FROM task_assignees WHERE task_id=? AND released_at IS NULL', taskId).length;
  if (!left && t?.status === 'doing') run("UPDATE tasks SET status='todo' WHERE id=?", taskId);
  return { released: true, task: getTask(taskId) };
}

/**
 * Finish a task.
 *
 * THE REFUSAL THIS FILE EXISTS FOR. A task marked as requiring a before and an
 * after does not close without one. Not a warning — a refusal, because a
 * warning above a Save button is a warning nobody reads, and because the
 * evidence is worth most at exactly the moment it is least convenient: standing
 * in the mud, having just finished.
 *
 * What it requires is a SUBMITTED pair, not a verified one. Requiring
 * verification would mean the person who did the work cannot close it until
 * somebody else looks — so the task sits open, the board fills with work that
 * is actually finished, and within a month everybody has learned to mark things
 * done first and photograph them never. Checking is a separate act by a
 * separate person, and it has its own place in the board.
 */
export function completeTask(taskId, { by = null, note = null } = {}) {
  const t = one('SELECT * FROM tasks WHERE id=?', taskId);
  if (!t) return { error: 'not_found', message: `No task ${taskId}.` };
  if (t.status === 'done') return { already: true, task: decorate(t) };

  if (t.requires_before_after) {
    const pairs = all(
      `SELECT id FROM proofs
        WHERE task_id=? AND before_media_id IS NOT NULL AND after_media_id IS NOT NULL
          AND status <> 'rejected'`, taskId);
    if (!pairs.length) {
      return {
        error: 'evidence_required',
        message: `"${t.title}" needs a before and an after before it closes. Two photographs of ` +
                 'the same ground is the one form of evidence somebody who was not there can check.',
        // The action, so a refusal is a door rather than a wall.
        action: { tool: 'submit_proof', input: { task_id: taskId } },
        note: 'If this task never changed anything visible — a phone call, a permit filed — say so ' +
              'when you write it, with requires_before_after false.',
      };
    }
  }

  run(`UPDATE tasks SET status='done', completed_at=datetime('now'), completed_by=? WHERE id=?`,
    by ? String(by).trim() : null, taskId);
  // Single quotes. In SQLite a DOUBLE-quoted token is an identifier, so `""`
  // is a zero-length column name and the statement throws — `no such column:
  // ""`. It shipped in both places that append to a description, and every test
  // and every end-to-end run missed it for the same reason: not one of them
  // passed a note, so neither line ever executed. The tests below now do.
  if (note) run(`UPDATE tasks SET description = COALESCE(description || char(10), '') || ? WHERE id=?`,
    `Finished: ${String(note).trim()}`, taskId);
  return { done: true, task: getTask(taskId) };
}

/**
 * Correct a task that was written down wrong.
 *
 * Every field a person could get wrong on the way in, and nothing else. Status
 * is not here — moving a task between states is `setTaskStatus`, which has
 * rules (finishing needs evidence, abandoning needs a reason) that an
 * edit-any-field tool would quietly walk straight past. That is the shape of
 * bug this project keeps finding: a second door into a guarded room.
 */
export function updateTask(taskId, input = {}) {
  const t = one('SELECT * FROM tasks WHERE id=?', taskId);
  if (!t) return { error: 'not_found', message: `No task ${taskId}.` };

  const set = {};
  if (input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title) return { error: 'missing_required', message: 'A task needs a title.' };
    set.title = title;
  }
  if (input.description !== undefined) set.description = input.description || null;
  if (input.due_at !== undefined) set.due_at = input.due_at || null;
  if (input.stage !== undefined) {
    if (input.stage && !STAGES.includes(input.stage)) {
      return { error: 'unknown_stage', message: `"${input.stage}" is not one of the twelve stages.`, stages: STAGES };
    }
    set.stage = input.stage || null;
  }
  // Both halves or neither, the same rule addTask applies. A task edited to
  // have a latitude and no longitude is drawn at [null, 30] and rendered by
  // calling .toFixed on null — and an EDIT is the likelier way to get there,
  // because somebody correcting one number does not think of the other.
  if (input.lat !== undefined || input.lng !== undefined) {
    const lat = input.lat ?? t.lat;
    const lng = input.lng ?? t.lng;
    const both = lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    if (!both && (lat != null || lng != null)) {
      return {
        error: 'half_a_coordinate',
        message: 'A point needs both halves. Give a latitude and a longitude, or neither.',
      };
    }
    set.lat = both ? Number(lat) : null;
    set.lng = both ? Number(lng) : null;
  }
  if (input.requires_before_after !== undefined) {
    // Turning the evidence requirement OFF on a task that already has evidence
    // filed would leave a proof attached to a task that claims not to need one.
    // Allowed, because the task may genuinely have been mis-written — but the
    // proof stays and still has to be checked.
    set.requires_before_after = input.requires_before_after === false ? 0 : 1;
  }

  const fields = Object.keys(set);
  if (!fields.length) {
    return { error: 'nothing_to_update', message: 'Nothing was changed. Pass a field to correct.' };
  }
  run(`UPDATE tasks SET ${fields.map((f) => `${f}=?`).join(',')} WHERE id=?`,
    ...fields.map((f) => set[f]), taskId);
  return getTask(taskId);
}

/** Reopen, abandon, block — the states that are not "finished". */
export function setTaskStatus(taskId, status, { note = null } = {}) {
  if (!STATUS.includes(status)) {
    return { error: 'unknown_status', message: `Status is one of: ${STATUS.join(', ')}.` };
  }
  const t = one('SELECT * FROM tasks WHERE id=?', taskId);
  if (!t) return { error: 'not_found', message: `No task ${taskId}.` };
  if (status === 'done') return completeTask(taskId, { note });

  // ── Abandoning is this system's version of deleting ────────────────────
  // There is no delete. A task row carries who claimed it, who released it and
  // every before-and-after filed against it, and `ON DELETE CASCADE` would take
  // the evidence with it — destroying the proof of work somebody actually did,
  // to tidy a list. The same reasoning the people, devices and media tables
  // enforce with triggers.
  //
  // What abandoning does is what a person wants from a delete: the task leaves
  // the map, the board and every count, because both read `status NOT IN
  // ('done','abandoned')`. What it does not do is make it untrue that the task
  // was there.
  //
  // The reason is required for the same purpose an override's reason is: so the
  // commons can argue with the person rather than with the software.
  if (status === 'abandoned' && !String(note ?? '').trim()) {
    return {
      error: 'reason_required',
      message: 'Dropping a task needs a reason — a sentence is enough. It is kept, because a task ' +
               'somebody wrote down and the commons then decided against is worth more than a gap.',
      note: 'Nothing is deleted here. The task leaves the map and the board; the record stays.',
    };
  }
  // Reopening clears the completion, so a task cannot read as both open and
  // finished-by-somebody-on-a-date.
  run(`UPDATE tasks SET status=?, completed_at=NULL, completed_by=NULL WHERE id=?`, status, taskId);
  if (note) {
    run(`UPDATE tasks SET description = COALESCE(description || char(10), '') || ? WHERE id=?`,
      `${status === 'abandoned' ? 'Dropped' : 'Changed'}: ${String(note).trim()}`, taskId);
  }
  return { task: getTask(taskId) };
}

/**
 * The work of this commons, arranged by what a person is looking for.
 *
 * Not a scoreboard and deliberately not counting anybody's completed tasks —
 * DAILY_USE.md refuses streaks on evidence, and "tasks completed per person" is
 * a streak with names on it.
 */
export function taskBoard(chapterId) {
  if (!chapterId) return { error: 'no_chapter' };
  const open = listTasks(chapterId).filter((t) => t.status !== 'done' && t.status !== 'abandoned');
  const waiting = all(
    `SELECT p.id, p.task_id, p.submitted_by, p.created_at, t.title task_title, q.title project_title
       FROM proofs p JOIN tasks t ON t.id=p.task_id JOIN quests q ON q.id=t.quest_id
      WHERE p.chapter_id=? AND p.status='pending'
      ORDER BY p.created_at, p.rowid`, chapterId);
  const unclaimed = open.filter((t) => !t.assignees.length);
  return {
    open: open.length,
    unclaimed,
    in_hand: open.filter((t) => t.assignees.length),
    needs_checking: waiting,
    sentence: !open.length
      ? 'No open tasks. Every project here is either finished or has nothing written down to do.'
      : `${open.length} open · ${unclaimed.length} nobody has picked up · ` +
        `${waiting.length} waiting to be checked`,
    note: 'Nothing here counts what anybody has completed. Work is not a score.',
  };
}
