'use strict';

// A partner asking Sales to price something.
//
// Deliberately NOT a quotations row at status 'draft', which was the obvious
// shortcut. A quotation carries a unique quotation_number allocated at
// creation, and draft rows already appear in quotation lists and in some
// totals — so letting a partner "start a quotation" would mint a company
// quotation number for an unpriced external ask and put it in reports before
// anyone at Nanta had looked at it. The number must be spent when WE decide
// to quote, not when someone asks.
//
// It is also not an overlay the way a partner demo request is. That one
// works because demo_schedule already had a request-then-approve chain to
// join; quotations have no "requested" stage at all — a quotation is created
// fully formed, with line items and pricing. There is nowhere to overlay.
//
// So: a small table whose whole job is to carry the ask until a real
// quotation exists, at which point quotation_id links the two and the
// request is done.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('partner_quotation_requests', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },

      // RESTRICT on both: a partner or project with a live request against it
      // must not be deletable out from under it. Same call as projects.partner_id.
      partner_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'partners', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      // Required. A quotation is always FOR something, and requiring the
      // project is what gives this table its scoping for free — a partner
      // can only request against a project they already submitted.
      project_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'projects', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      // The portal user who asked. SET NULL rather than RESTRICT: a partner
      // employee leaving must not freeze their company's open requests.
      requested_by_user_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },

      // What they want priced, in their words.
      requirements: { type: Sequelize.TEXT, allowNull: false },
      // Free text, not a product-catalogue link: a partner names things the
      // way their customer does, and forcing a catalogue match at request
      // time would make the ask harder than a phone call.
      products: { type: Sequelize.TEXT, allowNull: true },
      quantity_note: { type: Sequelize.STRING(255), allowNull: true },
      needed_by: { type: Sequelize.DATEONLY, allowNull: true },
      // low | medium | high — STRING for the same reason as status below.
      urgency: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'medium' },

      // open | in_progress | quoted | declined
      //
      // STRING, not ENUM, matching support_tickets: Postgres cannot drop an
      // enum value once added, and a four-value workflow is exactly the kind
      // of list that gets revised. lib/partnerQuotationRequestStages.ts is
      // the authority on which values exist and which transitions are legal.
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'open' },

      // Set when Sales actually produces the quotation. This is what turns
      // the request from an ask into a finished thing, and it is how the
      // partner's portal links straight from their request to the document.
      // SET NULL so deleting a quotation does not delete the history of it
      // having been asked for.
      quotation_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'quotations', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },

      // Sales' reply — the reason for a decline, or a note alongside the
      // quotation. Partner-visible by definition: it exists to be read by
      // them, which is why there is no separate internal-notes column here.
      // Internal coordination belongs on the project, not on the ask.
      response_note: { type: Sequelize.TEXT, allowNull: true },
      handled_by_user_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      handled_at: { type: Sequelize.DATE, allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      // Paranoid, like projects and quotations: a withdrawn request is still
      // part of what was asked for and when.
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    // The partner portal's own list — every read there is "this partner's".
    await queryInterface.addIndex('partner_quotation_requests', ['partner_id'], {
      name: 'partner_quotation_requests_partner_id_idx'
    });
    // The internal queue is "what is still open", which is a small slice of
    // a table that only grows, so the index is partial.
    await queryInterface.addIndex('partner_quotation_requests', ['status'], {
      name: 'partner_quotation_requests_open_idx',
      where: { status: ['open', 'in_progress'] }
    });
    await queryInterface.addIndex('partner_quotation_requests', ['project_id'], {
      name: 'partner_quotation_requests_project_id_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('partner_quotation_requests');
  }
};
