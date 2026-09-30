'use strict';

// Project / Tender Proposal quotations.
//
// A third quotation mode alongside the Standard and Custom estimators. Those
// two build a total from line items (products_json); a proposal instead records
// the commercial terms of a bid and carries the prepared commercial document as
// an attachment.
//
//   proposal_kind  'project' | 'tender' | NULL. NULL is every existing
//                  quotation and every future Standard/Custom one — it is what
//                  distinguishes a proposal from a priced quotation, so it is a
//                  real column rather than a key inside the JSON.
//   proposal_json  the terms themselves (see lib/quotationProposal.ts's
//                  ProposalDetails). A JSONB blob for the same reason
//                  products_json is one: it is a tall, form-shaped set of
//                  fields that is read back whole and never filtered on, and
//                  ~18 sparse columns would be read by nothing else.
//
// Deliberately NOT stored: the quote's expiry date and the total contract
// length. Both are derived (submitted date + expiry days; implementation + AMC)
// and storing them would let a stored copy drift from the inputs it came from.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'proposal_kind', { type: Sequelize.STRING(20) });
    await queryInterface.addColumn('quotations', 'proposal_json', { type: Sequelize.JSONB });
    // Proposals are listed and filtered by kind on the quotation list; without
    // this every such view is a sequential scan of the whole table.
    await queryInterface.addIndex('quotations', ['proposal_kind'], { name: 'quotations_proposal_kind' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('quotations', 'quotations_proposal_kind');
    await queryInterface.removeColumn('quotations', 'proposal_json');
    await queryInterface.removeColumn('quotations', 'proposal_kind');
  }
};
