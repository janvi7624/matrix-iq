'use strict';

/**
 * Partner onboarding: a new partner uploads their Agreement, NDA and Payment
 * Agreement, and gets the rest of the portal only once the person who
 * created their account has approved all three.
 *
 * Three parts:
 *
 * 1. partner_documents — one live row per (partner, kind). The partner
 *    uploads, the creator approves or rejects with a remark, and a rejected
 *    document is re-uploaded into the SAME row (status back to 'pending').
 *    A separate table rather than three columns on partners because each
 *    document carries its own reviewer, timestamp and remark, and because a
 *    fourth kind later should not mean another migration on the main table.
 *
 * 2. partners.onboarded_at — the gate itself, as one nullable timestamp.
 *    Null means "onboarding incomplete": the partner may sign in, but every
 *    portal page except onboarding redirects there. Set when the last
 *    document is approved.
 *
 *    EXISTING partners are backfilled to their created_at, deliberately.
 *    They are already working, have no documents on file, and locking them
 *    out of a portal they use today to satisfy a rule introduced after they
 *    joined would be the wrong way round. The requirement is for new
 *    partners; onboarding is enforced from here forward.
 *
 * 3. app_config.partner_creator_ids — which staff may create partners.
 *    Permissions in this app are per-ROLE, and the people named for this
 *    (prashant.bhatt, mahendra.singh.chauhan) share the generic 'user' role
 *    with 12 other active accounts, so granting it to the role would hand
 *    partner creation to all 14. A per-user list is the only way to say what
 *    was actually asked. Same shape as the existing single-user settings
 *    (marketing_owner_id, bom_finance_approver_id), just a list.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('partner_documents', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      partner_id: { type: Sequelize.UUID, allowNull: false },
      // 'agreement' | 'nda' | 'payment_agreement' — see
      // PARTNER_DOCUMENT_KINDS in lib/partnerOnboarding.ts.
      kind: { type: Sequelize.STRING(32), allowNull: false },
      // [{ name, path, size }] from the app's existing upload pipeline,
      // stored under the partner's own prefix (lib/partnerUploads.ts) so one
      // partner can never read another's agreement.
      files: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      // 'pending' (uploaded, awaiting review) | 'approved' | 'rejected'.
      // A row only exists once the partner has uploaded something, so there
      // is no 'not_started' state — absence is that state.
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      submitted_at: { type: Sequelize.DATE },
      submitted_by: { type: Sequelize.UUID },
      reviewed_by: { type: Sequelize.UUID },
      reviewed_at: { type: Sequelize.DATE },
      // Required on a rejection: the partner has to know what to fix.
      review_remarks: { type: Sequelize.TEXT },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE }
    });

    // One live document per kind. Re-uploading after a rejection updates the
    // existing row rather than stacking a second one, so "which agreement is
    // current" is never ambiguous.
    await queryInterface.addIndex('partner_documents', ['partner_id', 'kind'], {
      name: 'partner_documents_partner_kind_unique',
      unique: true,
      where: { deleted_at: null }
    });
    await queryInterface.addIndex('partner_documents', ['status'], { name: 'partner_documents_status_idx' });

    await queryInterface.addColumn('partners', 'onboarded_at', { type: Sequelize.DATE });
    // Grandfather every partner that already exists — see the note above.
    await queryInterface.sequelize.query('UPDATE partners SET onboarded_at = created_at WHERE onboarded_at IS NULL');

    await queryInterface.addColumn('app_config', 'partnerCreatorIds', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('app_config', 'partnerCreatorIds');
    await queryInterface.removeColumn('partners', 'onboarded_at');
    await queryInterface.removeIndex('partner_documents', 'partner_documents_status_idx');
    await queryInterface.removeIndex('partner_documents', 'partner_documents_partner_kind_unique');
    await queryInterface.dropTable('partner_documents');
  }
};
