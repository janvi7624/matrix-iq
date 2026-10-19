'use strict';

/**
 * Sales pipeline rework, step 1 of 2: the new stage values and the columns the
 * stage gates need. Deliberately does NOT write the new stage values to any
 * row — see 20261016120100-sales-pipeline-prospect-backfill.js for why.
 *
 * WHY TWO MIGRATIONS
 * This database is PostgreSQL 17. Since PG 12 an enum value may be ADDED
 * inside a transaction, but it may not be USED in that same transaction
 * ("unsafe use of new value of enum type"). sequelize-cli does not wrap
 * migrations in a transaction today, so one file would probably work — but
 * "probably" is doing a lot of load-bearing work there, and the failure mode
 * is a half-applied migration against live sales data. Splitting on the
 * commit boundary makes it correct regardless of what the runner does, and
 * makes each half independently retryable.
 *
 * WHAT IS NOT HERE, AND WHY
 * The brief asks for PO number / value / date and quote value / date as
 * mandatory stage information. Three of those already exist as real linked
 * records, and duplicating them onto `projects` would create exactly the
 * second source of truth this whole change is meant to remove:
 *
 *   purchase_orders  po_number, po_date, amount, project_id   (Project hasMany)
 *   quotations       total, project_id, revision_number       (Project hasMany)
 *
 * So Won reads its PO from purchase_orders and writes one there on the
 * transition — no project columns at all. Quotation is treated differently
 * and does get two columns, because the asymmetry is real: a purchase_orders
 * row is four fields and cheap to create, whereas a quotations row is a whole
 * document with line items, totals and a unique number, and only 19 of 185
 * projects have one. 7 of the 10 projects currently sitting in the Quotation
 * stage have no quotation record at all — their quote went out by email —
 * so a gate that demanded one would block the normal path. quote_value and
 * quotation_date are therefore stored on the project and AUTO-FILLED from the
 * newest linked quotation when one exists, which keeps the quotation module
 * authoritative where it is actually used.
 *
 * IDEMPOTENCY
 * Every column is guarded by describeTable, and the enum values use ADD VALUE
 * IF NOT EXISTS (the pattern this repo already established in
 * 20260821140000-project-cold-call-stage.js). Re-running is a no-op.
 *
 * The legacy-percent capture happens ONLY in the branch that creates the
 * column, and that matters more than it looks: closing_probability_percent
 * becomes a server-derived value after this change, so a capture that re-ran
 * later would overwrite the original hand-typed figure with the derived one —
 * destroying the very history the column exists to keep.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // --- the two new stage values -------------------------------------
    // 'prospect' is the new name for 'cold_call'; 'commit' is new. The old
    // value is NOT renamed or dropped: Postgres cannot drop an enum value,
    // and leaving 'cold_call' valid means a code rollback still works
    // against already-migrated rows.
    await queryInterface.sequelize.query('ALTER TYPE "enum_projects_stage" ADD VALUE IF NOT EXISTS \'prospect\';');
    await queryInterface.sequelize.query('ALTER TYPE "enum_projects_stage" ADD VALUE IF NOT EXISTS \'commit\';');

    const table = await queryInterface.describeTable('projects');
    const add = async (name, spec) => {
      if (table[name]) return false;
      await queryInterface.addColumn('projects', name, spec);
      return true;
    };

    // --- Legacy % -----------------------------------------------------
    // The hand-typed figure, kept for reference once Closing % becomes
    // derived. Nullable with no default, because "no estimate was ever
    // given" is a real and common state: 100 of 185 live projects have no
    // percentage at all, and recording those as 0 would be a fabrication.
    const createdLegacy = await add('legacy_closing_percent', { type: Sequelize.INTEGER, allowNull: true });
    if (createdLegacy) {
      // No WHERE clause on purpose: a plain copy carries NULL across as NULL,
      // which is the accurate preservation. Runs once, in the same branch
      // that created the column.
      await queryInterface.sequelize.query(
        'UPDATE projects SET legacy_closing_percent = closing_probability_percent;'
      );
    }

    // --- the admin override ------------------------------------------
    // Null override = "use the stage's standard figure". The reason is
    // mandatory at the API, not here: a NOT NULL constraint would be
    // unsatisfiable for the 185 existing rows that have no override.
    await add('closing_percent_override', { type: Sequelize.INTEGER, allowNull: true });
    await add('closing_percent_override_reason', { type: Sequelize.TEXT, allowNull: true });
    // Denormalised actor/time so the dashboard can show "overridden by X on Y"
    // without joining audit_logs for every row. The authoritative audit trail
    // is still audit_logs — this is for display.
    await add('closing_percent_override_by', { type: Sequelize.UUID, allowNull: true });
    await add('closing_percent_override_at', { type: Sequelize.DATE, allowNull: true });

    // --- the Commit gate ---------------------------------------------
    await add('expected_po_date', { type: Sequelize.DATEONLY, allowNull: true });
    await add('confirmed_by_contact', { type: Sequelize.STRING, allowNull: true });

    // --- the Lost gate -----------------------------------------------
    // A plain string rather than an enum, following this repo's own stated
    // reasoning for cold_call_responded: a short closed vocabulary that may
    // grow is not worth an ALTER TYPE every time. The allowed values are
    // enforced in lib/salesStageRules.ts (LOST_REASONS) on every write.
    await add('lost_reason', { type: Sequelize.STRING, allowNull: false, defaultValue: '' });

    // --- the Quotation gate ------------------------------------------
    // Auto-filled from the newest linked quotation when there is one; typed
    // in when the quote went out from outside the app. See the note above.
    await add('quote_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true });
    await add('quotation_date', { type: Sequelize.DATEONLY, allowNull: true });

    // --- when the project entered its current stage -----------------
    // A real column rather than a timeline derivation, because the
    // timeline cannot answer the question: project_timeline_events.stage
    // is written on EVERY event (a remark, an attachment and a lead change
    // all carry the stage they happened under), so counting events by
    // stage is not the same as measuring time in a stage. The one
    // discriminator is the "Stage moved to ..." label, and four routes
    // (customer-response, negotiation, po, demo-schedule) move a stage
    // without writing one — about 48 live projects — so a label-based
    // derivation would report those as never having moved.
    //
    // Backfilled in the companion migration, which has to run the backfill
    // BEFORE it renames cold_call -> prospect (the timeline rows still say
    // 'cold_call', so comparing them against an already-renamed stage would
    // match nothing and throw away the real history of 91 projects).
    await add('stage_entered_at', { type: Sequelize.DATE, allowNull: true });
  },

  async down(queryInterface) {
    // Dropping these columns discards the Legacy % capture and any override
    // reasons recorded since. That is the intended meaning of reverting this
    // migration, but it is not recoverable from the schema alone — take a
    // dump of projects(id, closing_probability_percent, legacy_closing_percent,
    // closing_percent_override, closing_percent_override_reason) first if the
    // override history matters.
    const table = await queryInterface.describeTable('projects');
    const drop = async (name) => {
      if (table[name]) await queryInterface.removeColumn('projects', name);
    };

    await drop('stage_entered_at');
    await drop('quotation_date');
    await drop('quote_value');
    await drop('lost_reason');
    await drop('confirmed_by_contact');
    await drop('expected_po_date');
    await drop('closing_percent_override_at');
    await drop('closing_percent_override_by');
    await drop('closing_percent_override_reason');
    await drop('closing_percent_override');
    await drop('legacy_closing_percent');

    // 'prospect' and 'commit' stay in enum_projects_stage: Postgres cannot
    // drop an enum value, exactly as 20260821140000-project-cold-call-stage.js
    // already notes for 'cold_call'/'catalogue_offered'. Harmless — no code
    // path writes them once this is reverted, and the companion migration's
    // down() has already moved every 'prospect' row back to 'cold_call'.
  }
};
