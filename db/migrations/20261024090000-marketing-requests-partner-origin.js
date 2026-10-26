'use strict';

// Partner-raised marketing requests.
//
// An overlay on marketing_requests, for the same reason the project and demo
// overlays are overlays: the seven-step workflow (submit -> assign -> accept
// -> marketing work -> technical review -> final submission -> approve) is
// long, well-tested, and has nothing to do with WHO asked. A separate
// partner_marketing_requests table would have meant either duplicating that
// chain or copying rows across on approval, which forks the id the partner is
// tracking.
//
// So a partner request IS a marketing_requests row from the start, carrying
// partner_id. Everything downstream runs unchanged; the partner sees a
// whitelisted projection (lib/partnerMarketingVisibility.ts) rather than the
// internal workspace.
//
// Unlike demo_schedule, created_by is NOT forced to an internal account here.
// marketing_requests has no department-scoped visibility chain keyed on it —
// list() scopes on created_by/assigned_to_id/technical_assigned_to_id only —
// so pointing it at the partner user is both accurate and harmless, and it is
// what makes "deliver to the original requester" reach the right person.
//
// Note what is NOT added: nothing that lets a partner influence assignment.
// assigned_to_id and technical_assigned_to_id stay purely internal.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('marketing_requests', 'partner_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'partners', key: 'id' },
      onUpdate: 'CASCADE',
      // RESTRICT, not CASCADE: a partner with marketing work in flight must
      // not be deletable out from under it. Same call as projects.partner_id.
      onDelete: 'RESTRICT'
    });

    // Partner-origin requests are a small slice of the table and are always
    // queried as "this partner's", never scanned across partners.
    await queryInterface.addIndex('marketing_requests', ['partner_id'], {
      name: 'marketing_requests_partner_id_idx',
      where: { partner_id: { [Sequelize.Op.ne]: null } }
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('marketing_requests', 'marketing_requests_partner_id_idx');
    await queryInterface.removeColumn('marketing_requests', 'partner_id');
  }
};
