'use strict';

// The AI Daily Report <-> TMS Task link is a hidden field inside
// daily_report_entries.data (JSONB), not a real column — see
// lib/aiTmsTaskLink.ts's own comment on why: entries have no stable id
// across saves (replaceEntries hard-deletes and recreates every row on
// every save), so a real FK column keyed to DailyReportEntry.id would break
// the moment a report is re-saved. The link value itself round-trips fine
// inside `data`, same as GEM Sales' existing proposal_quotation_id hidden
// field.
//
// What a plain column WOULD have given for free is an indexed lookup —
// "every Daily Report entry linked to this TMS task", the query behind the
// task detail page's new Linked Daily Reports panel. A expression index on
// the JSONB path gives the same thing without the column, scoped to rows
// that actually carry a link (most rows never will).
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE INDEX daily_report_entries_tms_task_id_idx
      ON daily_report_entries ((data ->> 'tms_task_id'))
      WHERE data ->> 'tms_task_id' IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS daily_report_entries_tms_task_id_idx;`);
  }
};
