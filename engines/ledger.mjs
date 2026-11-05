// ── A ledger a commons defines for itself ─────────────────────────────────
// Not a currency. The tools to make one, and refusals strong enough that
// whatever they make still adds up.
//
// THE LINE THIS FILE DRAWS. What a unit is, what it is worth, who may make
// more, what it is redeemable for and who decides any of that are the
// community's, and this has no opinion about them. The arithmetic is not
// theirs and not mine:
//
//   1. entries are append-only          (trigger, not convention)
//   2. corrections are reversals        (the mistake stays visible)
//   3. balances are DERIVED, never stored
//   4. every movement is two legs summing to zero, written together
//   5. nobody passes the credit limit their own currency declares
//
// Rule 3 is the one that matters most and is the easiest to give up. A stored
// balance is a second copy of something the entries already say, and the moment
// two copies exist one of them is wrong — Civil X's schema records the bill for
// exactly this: a cashout that debited a hard-coded unit while the balance had
// been credited in another, so the worker kept the credits AND took the cash,
// and the second balance went negative to pay for it.
//
// AND THE GOVERNMENT IS THE ONE ALREADY HERE. Creating a currency, changing it,
// opening a pool — each needs a council decision that has actually been
// DECIDED. This does not invent a second way for a commons to make up its mind;
// it refuses to move without the first one.
import { all, one, create, run, db } from '../core/db.mjs';
import { newId } from '../core/ids.mjs';

/** Where issued units come from and redeemed units go back to. */
const ISSUANCE = 'issuance';

export const ISSUE_POLICIES = Object.freeze(['council', 'steward', 'on_verified_proof', 'anyone']);

/**
 * A decision that actually decided something.
 *
 * `status='decided'` and not merely proposed — the difference between a commons
 * having agreed and somebody having suggested. Everything that changes the
 * RULES of an economy goes through this, which is how a community builds its
 * own governance here: they already have seven methods, a Land Seat report and
 * red flags, and the ledger simply will not move without them.
 */
function decidedOrRefuse(chapterId, decisionId, what) {
  if (!decisionId) {
    return {
      error: 'decision_required',
      message: `${what} is a decision this commons makes together, not a setting. Take it to ` +
               'council, and pass the decision here once it has been decided.',
      action: { tool: 'propose_decision', input: { title: what } },
    };
  }
  const d = one('SELECT * FROM decisions WHERE id=? AND chapter_id=?', decisionId, chapterId);
  if (!d) return { error: 'not_found', message: `No decision ${decisionId} in this chapter.` };
  if (d.status !== 'decided') {
    return {
      error: 'not_decided_yet',
      message: `"${d.title}" is ${d.status}, not decided. The ledger moves when the council has, ` +
               'not when somebody has proposed that it should.',
    };
  }
  if (d.red_flags && String(d.red_flags).trim()) {
    return {
      error: 'red_flag_open',
      message: `"${d.title}" carries an open red flag: ${d.red_flags}. A high score never ` +
               'overrides a red flag, and neither does an economy.',
    };
  }
  return null;
}

/** Define what this commons counts. */
export function defineCurrency(chapterId, input = {}) {
  if (!chapterId) return { error: 'no_chapter', message: 'Found a chapter first.' };
  const name = String(input.name ?? '').trim();
  const unitOf = String(input.unit_of ?? '').trim();
  if (!name) return { error: 'missing_required', message: 'What is it called?' };
  if (!unitOf) {
    return {
      error: 'missing_required',
      message: 'Say what ONE unit is, in your own words — "an hour of work", "a kilo of seed", ' +
               '"a meal". A unit nobody can define is a unit nobody can argue about the value ' +
               'of, and that argument is most of what makes one work.',
    };
  }
  const refusal = decidedOrRefuse(chapterId, input.decided_by, `Creating the currency "${name}"`);
  if (refusal) return refusal;

  if (one('SELECT id FROM currencies WHERE chapter_id=? AND name=?', chapterId, name)) {
    return { error: 'already_exists', message: `This commons already counts in "${name}".` };
  }
  const policy = input.issue_policy ?? 'council';
  if (!ISSUE_POLICIES.includes(policy)) {
    return { error: 'unknown_policy', message: `Issuing is one of: ${ISSUE_POLICIES.join(', ')}.` };
  }
  const zeroSum = input.zero_sum !== false;
  if (zeroSum && input.per_verified_proof) {
    return {
      error: 'contradiction',
      message: 'A zero-sum currency has no issuer, so nothing can be paid out per proof. Either ' +
               'turn zero_sum off, or let the work be recorded as a transfer from whoever benefits.',
    };
  }
  if (!zeroSum && policy === 'on_verified_proof' && !(Number(input.per_verified_proof) > 0)) {
    return {
      error: 'missing_required',
      message: 'Paying per checked before-and-after needs a number: how many units is one worth?',
    };
  }

  const row = create('currencies', 'currency', chapterId, {
    id: newId('cur'),
    chapter_id: chapterId,
    name,
    plural: input.plural ?? null,
    symbol: input.symbol ?? null,
    unit_of: unitOf,
    zero_sum: zeroSum ? 1 : 0,
    credit_limit: input.credit_limit != null ? Number(input.credit_limit) : null,
    issue_policy: policy,
    per_verified_proof: input.per_verified_proof != null ? Number(input.per_verified_proof) : null,
    decided_by: input.decided_by,
    created_by: input.created_by ?? null,
  }, 'members');

  return {
    ...row,
    zero_sum: !!row.zero_sum,
    note: zeroSum
      ? 'Zero-sum: nobody issues these. Every movement is a transfer, so all the balances always ' +
        'add to nothing and the unit is the promise between you.'
      : `Issued: units come into existence when somebody makes them, by "${policy}". How many ` +
        'exist is a number this commons can see and argue about.',
  };
}

export function currencies(chapterId) {
  return all('SELECT * FROM currencies WHERE chapter_id=? ORDER BY created_at', chapterId)
    .map((c) => ({ ...c, zero_sum: !!c.zero_sum, ...totals(c.id) }));
}

export function currency(currencyId) {
  const c = one('SELECT * FROM currencies WHERE id=?', currencyId);
  return c ? { ...c, zero_sum: !!c.zero_sum, ...totals(c.id) } : null;
}

/** How much exists, and how much is out with people. Added up, never stored. */
function totals(currencyId) {
  const issued = one(
    `SELECT COALESCE(SUM(-amount), 0) n FROM ledger_entries
      WHERE currency_id=? AND counterparty='issuance'`, currencyId)?.n ?? 0;
  const held = one(
    `SELECT COALESCE(SUM(amount), 0) n FROM ledger_entries
      WHERE currency_id=? AND agent_id IS NOT NULL`, currencyId)?.n ?? 0;
  return { in_existence: round(issued), held_by_people: round(held) };
}

const round = (n) => Number(Number(n ?? 0).toFixed(4));

/**
 * What somebody has. Summed from the entries, every time, on purpose.
 *
 * There is no balance column anywhere in this schema and there must never be
 * one. A stored balance is a second copy of what the entries already say, and
 * the day the two disagree the entries are right and the number everybody has
 * been reading is wrong.
 */
export function balance(currencyId, agentId) {
  const n = one(
    'SELECT COALESCE(SUM(amount), 0) n FROM ledger_entries WHERE currency_id=? AND agent_id=?',
    currencyId, agentId)?.n ?? 0;
  return round(n);
}

export function balances(currencyId) {
  return all(
    `SELECT e.agent_id, a.name, COALESCE(SUM(e.amount), 0) balance
       FROM ledger_entries e LEFT JOIN agents a ON a.id = e.agent_id
      WHERE e.currency_id=? AND e.agent_id IS NOT NULL
      GROUP BY e.agent_id
      ORDER BY balance DESC`, currencyId)
    .map((r) => ({ ...r, balance: round(r.balance) }));
}

/**
 * Write one movement: two legs, one group, both or neither.
 *
 * The transaction is the point. A half-written movement is a ledger that does
 * not add up, and "it crashed between the two inserts" is not a state anybody
 * can reconcile afterwards.
 */
function post(chapterId, currencyId, legs, common = {}) {
  const groupId = newId('grp');
  const sum = legs.reduce((n, l) => n + l.amount, 0);
  // Belt and braces on the property the whole file exists to keep. If this ever
  // fires, something above built a movement that creates or destroys value
  // without saying so, and refusing is better than recording it.
  if (Math.abs(sum) > 1e-9) {
    return { error: 'does_not_balance', message: `Those legs sum to ${sum}, not zero.` };
  }
  const d = db();
  d.exec('BEGIN');
  try {
    const written = [];
    for (const leg of legs) {
      written.push(create('ledger_entries', 'ledger', chapterId, {
        id: newId('led'),
        chapter_id: chapterId,
        currency_id: currencyId,
        group_id: groupId,
        ...common,
        ...leg,
      }, 'members'));
    }
    d.exec('COMMIT');
    return { group_id: groupId, entries: written };
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

/** Would this movement push somebody past what their currency allows? */
function limitRefusal(cur, agentId, delta) {
  if (delta >= 0) return null;
  const after = balance(cur.id, agentId) + delta;
  if (after >= 0) return null;
  if (cur.credit_limit == null) {
    // No limit declared. A commons may choose that, and then they can see it.
    return null;
  }
  if (after < -Math.abs(cur.credit_limit)) {
    const agent = one('SELECT name FROM agents WHERE id=?', agentId);
    return {
      error: 'past_the_limit',
      message: `That would take ${agent?.name ?? 'them'} to ${round(after)}, past the limit of ` +
               `−${Math.abs(cur.credit_limit)} this commons set for ${cur.name}.`,
      balance: balance(cur.id, agentId),
      limit: cur.credit_limit,
    };
  }
  return null;
}

function usable(currencyId) {
  const cur = currency(currencyId);
  if (!cur) return { error: 'not_found', message: 'No such currency.' };
  if (cur.retired_at) {
    return { error: 'retired', message: `${cur.name} was retired. The entries stand; nothing new moves.` };
  }
  return cur;
}

/**
 * Bring units into existence.
 *
 * Refused outright for a zero-sum currency, because that is what zero-sum
 * MEANS — and a commons that chose mutual credit and then found a way to mint
 * would have chosen nothing at all.
 */
export function issue(chapterId, { currency_id, agent_id, amount, note = null,
  decided_by = null, proof_id = null, task_id = null, quest_id = null, created_by = null } = {}) {
  const cur = usable(currency_id);
  if (cur.error) return cur;
  const n = Number(amount);
  if (!(n > 0)) return { error: 'bad_amount', message: 'Issue a positive number of units.' };
  if (cur.zero_sum) {
    return {
      error: 'zero_sum',
      message: `${cur.name} is zero-sum: nobody issues it. Units move between people and always ` +
               'add to nothing, which is the whole of what this commons decided it would be.',
    };
  }
  if (!one('SELECT id FROM agents WHERE id=?', agent_id)) {
    return { error: 'not_found', message: 'No such person or organisation to issue to.' };
  }
  // The policy the commons declared, enforced. `council` and `steward` differ
  // in WHO may call this — ai/access.mjs decides that — but `council` also
  // means every issue names the decision behind it.
  if (cur.issue_policy === 'council') {
    const refusal = decidedOrRefuse(chapterId, decided_by, `Issuing ${n} ${cur.name}`);
    if (refusal) return refusal;
  }
  if (cur.issue_policy === 'on_verified_proof' && !proof_id) {
    return {
      error: 'proof_required',
      message: `${cur.name} is issued for checked work. Name the proof it is for.`,
    };
  }
  if (proof_id) {
    const p = one('SELECT status FROM proofs WHERE id=?', proof_id);
    if (!p) return { error: 'not_found', message: 'No such proof.' };
    if (p.status !== 'verified') {
      return {
        error: 'not_verified',
        message: 'That before-and-after has not been checked yet. Evidence pays when somebody ' +
                 'who was not there has looked at it.',
      };
    }
    const already = one(
      `SELECT id FROM ledger_entries WHERE proof_id=? AND kind='issue' AND agent_id IS NOT NULL`,
      proof_id);
    if (already) {
      return {
        error: 'already_paid',
        message: 'That proof has already been paid for. Reverse the first entry if it was wrong.',
      };
    }
  }

  return post(chapterId, currency_id, [
    { agent_id, amount: n },
    { counterparty: ISSUANCE, amount: -n },
  ], { kind: 'issue', note, decided_by, proof_id, task_id, quest_id, created_by });
}

/** Move units between two holders. The only movement a zero-sum currency has. */
export function transfer(chapterId, { currency_id, from_agent_id, to_agent_id, amount,
  note = null, exchange_event_id = null, created_by = null } = {}) {
  const cur = usable(currency_id);
  if (cur.error) return cur;
  const n = Number(amount);
  if (!(n > 0)) return { error: 'bad_amount', message: 'Transfer a positive number of units.' };
  if (from_agent_id === to_agent_id) {
    return { error: 'same_holder', message: 'That is a transfer to the same person.' };
  }
  for (const [which, id] of [['from', from_agent_id], ['to', to_agent_id]]) {
    if (!one('SELECT id FROM agents WHERE id=?', id)) {
      return { error: 'not_found', message: `No such person or organisation to transfer ${which}.` };
    }
  }
  const limit = limitRefusal(cur, from_agent_id, -n);
  if (limit) return limit;

  return post(chapterId, currency_id, [
    { agent_id: from_agent_id, amount: -n },
    { agent_id: to_agent_id, amount: n },
  ], { kind: 'transfer', note, exchange_event_id, created_by });
}

/**
 * Spend units on what a pool holds.
 *
 * The units go back where they came from rather than to another person, which
 * is what makes a pool a pool: redeeming takes them OUT of circulation and
 * hands over something real.
 */
export function redeem(chapterId, { pool_id, agent_id, amount, got = null, note = null,
  created_by = null } = {}) {
  const pool = one('SELECT * FROM pools WHERE id=? AND chapter_id=?', pool_id, chapterId);
  if (!pool) return { error: 'not_found', message: 'No such pool.' };
  if (pool.closed_at) {
    return { error: 'closed', message: `${pool.name} is closed${pool.closed_reason ? `: ${pool.closed_reason}` : '.'}` };
  }
  const cur = usable(pool.currency_id);
  if (cur.error) return cur;
  const n = Number(amount);
  if (!(n > 0)) return { error: 'bad_amount', message: 'Redeem a positive number of units.' };
  if (!one('SELECT id FROM agents WHERE id=?', agent_id)) {
    return { error: 'not_found', message: 'No such person or organisation.' };
  }
  const limit = limitRefusal(cur, agent_id, -n);
  if (limit) return limit;
  if (!String(got ?? '').trim()) {
    return {
      error: 'say_what_for',
      message: `Say what came out of ${pool.name} — "2 kg garlic", "£15", "the van on Saturday". ` +
               'A pool whose outgoings are not written down is a pool nobody can check.',
    };
  }

  return {
    ...post(chapterId, pool.currency_id, [
      { agent_id, amount: -n },
      { counterparty: 'pool', amount: n, pool_id },
    ], { kind: 'redeem', note: note ?? null, created_by }),
    got: String(got).trim(),
    pool: pool.name,
    terms: pool.terms ?? null,
  };
}

/**
 * Undo a movement by writing its opposite.
 *
 * Both stay. Somebody reading this ledger in a year sees the mistake and sees
 * it being corrected, which is the difference between a record and a story.
 */
export function reverse(chapterId, { group_id, reason, created_by = null } = {}) {
  if (!String(reason ?? '').trim()) {
    return {
      error: 'reason_required',
      message: 'A reversal needs a reason. Both entries stay on the ledger forever, so the reason ' +
               'is the only thing that explains what a reader is looking at.',
    };
  }
  const legs = all('SELECT * FROM ledger_entries WHERE group_id=? AND chapter_id=?', group_id, chapterId);
  if (!legs.length) return { error: 'not_found', message: 'No movement with that group id.' };
  if (legs[0].kind === 'reversal') {
    return { error: 'already_a_reversal', message: 'That is itself a reversal. Reverse the original.' };
  }
  const undone = one(
    `SELECT id FROM ledger_entries WHERE reverses IN (${legs.map(() => '?').join(',')})`,
    ...legs.map((l) => l.id));
  if (undone) return { error: 'already_reversed', message: 'That movement has already been reversed.' };

  return post(chapterId, legs[0].currency_id,
    legs.map((l) => ({
      agent_id: l.agent_id, counterparty: l.counterparty, amount: -l.amount,
      pool_id: l.pool_id, reverses: l.id,
    })),
    { kind: 'reversal', note: String(reason).trim(), created_by });
}

/** Open a pool. A council decision, like everything else that sets the rules. */
export function openPool(chapterId, input = {}) {
  const cur = usable(input.currency_id);
  if (cur.error) return cur;
  const name = String(input.name ?? '').trim();
  const holds = String(input.holds ?? '').trim();
  if (!name || !holds) {
    return {
      error: 'missing_required',
      message: 'A pool needs a name and what is actually in it — "£420", "60 kg seed garlic", ' +
               '"8 hours of the van".',
    };
  }
  const refusal = decidedOrRefuse(chapterId, input.decided_by, `Opening the pool "${name}"`);
  if (refusal) return refusal;
  return create('pools', 'pool', chapterId, {
    id: newId('pool'),
    chapter_id: chapterId,
    currency_id: input.currency_id,
    name, holds,
    terms: input.terms ?? null,
    rate: input.rate != null ? Number(input.rate) : null,
    decided_by: input.decided_by,
    created_by: input.created_by ?? null,
  }, 'members');
}

export function pools(chapterId) {
  return all(
    `SELECT p.*, c.name currency_name,
            (SELECT COALESCE(SUM(amount),0) FROM ledger_entries e
              WHERE e.pool_id = p.id AND e.counterparty='pool') taken_in
       FROM pools p JOIN currencies c ON c.id = p.currency_id
      WHERE p.chapter_id=? ORDER BY p.created_at`, chapterId)
    .map((p) => ({ ...p, taken_in: round(p.taken_in) }));
}

export function entries(chapterId, { currency_id = null, agent_id = null, limit = 100 } = {}) {
  const where = ['e.chapter_id = ?'];
  const args = [chapterId];
  if (currency_id) { where.push('e.currency_id = ?'); args.push(currency_id); }
  if (agent_id) { where.push('e.agent_id = ?'); args.push(agent_id); }
  return all(
    `SELECT e.*, a.name agent_name, c.name currency_name, c.symbol
       FROM ledger_entries e
       LEFT JOIN agents a ON a.id = e.agent_id
       JOIN currencies c ON c.id = e.currency_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?`, ...args, limit);
}

/**
 * Does it add up?
 *
 * The question a ledger exists to be able to answer, asked of itself. Every
 * movement must sum to zero; a zero-sum currency's holdings must too; and an
 * issued one's holdings must equal exactly what was issued, less what pools
 * took back.
 *
 * A ledger nobody ever checks is a spreadsheet with a trigger on it.
 */
export function check(chapterId) {
  const out = { currencies: [], ok: true, problems: [] };
  for (const cur of currencies(chapterId)) {
    const groups = all(
      `SELECT group_id, ROUND(SUM(amount), 6) s FROM ledger_entries
        WHERE currency_id=? GROUP BY group_id HAVING ABS(s) > 0.000001`, cur.id);
    const heldTotal = one(
      `SELECT COALESCE(SUM(amount),0) n FROM ledger_entries
        WHERE currency_id=? AND agent_id IS NOT NULL`, cur.id)?.n ?? 0;
    const everything = one(
      `SELECT COALESCE(SUM(amount),0) n FROM ledger_entries WHERE currency_id=?`, cur.id)?.n ?? 0;

    const problems = [];
    for (const g of groups) problems.push(`movement ${g.group_id} sums to ${g.s}, not zero`);
    if (Math.abs(everything) > 1e-6) {
      problems.push(`every entry in ${cur.name} together sums to ${round(everything)}, not zero`);
    }
    if (cur.zero_sum && Math.abs(heldTotal) > 1e-6) {
      problems.push(`${cur.name} is zero-sum but what people hold adds to ${round(heldTotal)}`);
    }
    // Somebody below a limit their currency declares. Not necessarily an error
    // — a limit can be lowered after the fact — but it is always worth saying.
    const over = cur.credit_limit == null ? [] : balances(cur.id)
      .filter((b) => b.balance < -Math.abs(cur.credit_limit));
    for (const b of over) problems.push(`${b.name ?? b.agent_id} is at ${b.balance}, past −${Math.abs(cur.credit_limit)}`);

    out.currencies.push({
      id: cur.id, name: cur.name, zero_sum: cur.zero_sum,
      in_existence: cur.in_existence, held_by_people: cur.held_by_people,
      movements: one('SELECT COUNT(DISTINCT group_id) n FROM ledger_entries WHERE currency_id=?', cur.id)?.n ?? 0,
      ok: !problems.length, problems,
    });
    if (problems.length) { out.ok = false; out.problems.push(...problems); }
  }
  out.sentence = !out.currencies.length
    ? 'This commons does not count anything yet.'
    : out.ok
      ? `${out.currencies.length} ${out.currencies.length === 1 ? 'currency' : 'currencies'}, every movement balanced.`
      : `${out.problems.length} ${out.problems.length === 1 ? 'problem' : 'problems'} in the ledger.`;
  return out;
}

/**
 * Retire a currency. Not a delete — the entries stand and still add up.
 *
 * What stops is new movement. A commons that stops using a unit has not made
 * the work that earned it stop having happened.
 */
export function retireCurrency(chapterId, { currency_id, reason, decided_by = null } = {}) {
  const cur = usable(currency_id);
  if (cur.error) return cur;
  if (!String(reason ?? '').trim()) {
    return { error: 'reason_required', message: 'Say why it is being retired. It stays on the record.' };
  }
  const refusal = decidedOrRefuse(chapterId, decided_by, `Retiring ${cur.name}`);
  if (refusal) return refusal;
  run(`UPDATE currencies SET retired_at=datetime('now'), retired_reason=? WHERE id=?`,
    String(reason).trim(), currency_id);
  return {
    ...currency(currency_id),
    note: 'Retired. Every entry stands and the ledger still balances; nothing new moves.',
  };
}
