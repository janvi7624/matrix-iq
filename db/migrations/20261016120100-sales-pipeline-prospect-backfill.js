'use strict';

/**
 * Sales pipeline rework, step 2 of 2: move every Cold Call project onto the
 * new 'prospect' value.
 *
 * Separate from 20261016120000-sales-pipeline-fields.js because PostgreSQL
 * will not let a newly added enum value be USED in the transaction that added
 * it. By the time this file runs, 'prospect' is committed and safe to write.
 *
 * WHAT THIS DOES NOT DO
 *
 *  - It does not recalculate closing_probability_percent. That value is
 *    derived at read time from the stage (lib/salesStageRules.ts's
 *    resolveClosingPercent), so there is nothing to recalculate and nothing
 *    that would stay correct if it were written down: the whole defect being
 *    fixed is a stored percentage drifting from the stage it claims to
 *    describe. The hand-typed figures are preserved in legacy_closing_percent
 *    by the companion migration.
 *
 *  - It does not touch catalogue_offered, site_visit or customer_response.
 *    Those three stages have no equivalent in the new five, and 39 live
 *    projects worth roughly Rs 9.6 crore sit in them. Mapping them by
 *    guesswork would re-grade that pipeline silently, so they are left as
 *    they are and reported as needing re-triage
 *    (NEEDS_RETRIAGE_STAGES), which surfaces them as an explicit,
 *    countable data-quality item rather than a wrong number.
 *
 *  - It does not fabricate stage-history events. 118 live projects have no
 *    stage-move row in project_timeline_events at all; inventing a "moved to
 *    Prospect today" event for them would both lie and reset every
 *    Days-in-Stage figure to zero. Days in Stage falls back to the project's
 *    created_at where no move was ever recorded.
 *
 * IDEMPOTENT: the UPDATE is scoped to rows that still read 'cold_call', so a
 * second run matches nothing.
 */
module.exports = {
  async up(queryInterface) {
    // ORDER MATTERS. stage_entered_at is backfilled from the timeline
    // first, while the timeline's stage values and the projects' stage
    // values still agree. Doing it after the rename below would compare
    // 'prospect' against timeline rows that say 'cold_call', match nothing,
    // and fall back to created_at for all 91 of them.
    //
    // The expression is "the earliest event carrying the CURRENT stage that
    // is later than the last event carrying a DIFFERENT stage" — i.e. the
    // start of the most recent contiguous run in that stage. That is the
    // honest reading of a table where every row carries a stage: a project
    // that went Quotation -> Demo -> Quotation gets its SECOND arrival,
    // not its first.
    //
    // Falls back to created_at, which is correct rather than a fudge: a
    // project that has never moved has genuinely been in its stage since it
    // was created, and 118 live projects have no stage-move event at all.
    // Guarded on IS NULL so a re-run cannot reset a timestamp the
    // application has since maintained itself.
    await queryInterface.sequelize.query(`
      UPDATE projects p SET stage_entered_at = COALESCE(
        (SELECT MIN(e.at) FROM project_timeline_events e
          WHERE e.project_id = p.id
            AND e.stage = p.stage::text
            AND e.at > COALESCE(
              (SELECT MAX(e2.at) FROM project_timeline_events e2
                WHERE e2.project_id = p.id AND e2.stage <> p.stage::text),
              '-infinity'::timestamptz)),
        p.created_at)
      WHERE p.stage_entered_at IS NULL;
    `);

    const [result] = await queryInterface.sequelize.query(
      "UPDATE projects SET stage = 'prospect' WHERE stage = 'cold_call';"
    );
    // sequelize returns the row count differently per dialect; log whatever
    // came back so a re-run is visibly a no-op in the migration output.
    console.log(
      '[sales-pipeline] cold_call -> prospect:',
      typeof result === 'object' && result !== null && 'rowCount' in result ? result.rowCount : 'done'
    );
  },

  async down(queryInterface) {
    // Reversible by construction, because 'cold_call' was never dropped from
    // the enum.
    //
    // One caveat worth stating plainly: any project CREATED as 'prospect'
    // after this migration ran will also be moved to 'cold_call' here. That
    // is not data loss — they are the same stage under two spellings, and
    // lib/salesStageRules.ts normalises them to one — but it does mean the
    // reversal is not a perfect inverse if the app has been running in
    // between.
    await queryInterface.sequelize.query(
      "UPDATE projects SET stage = 'cold_call' WHERE stage = 'prospect';"
    );
  }
};
