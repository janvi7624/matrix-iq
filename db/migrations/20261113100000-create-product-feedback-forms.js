'use strict';

// A Product Manager's own Google-Forms-style survey: they write a set of
// questions about their product (text/rating/choice), share the link with
// internal colleagues, and the answers roll up on the form itself. Separate
// from product_manager_notes (the PM's own feedback/action/plan log) — this
// is what feeds that log from OTHER people, not written by the PM.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('product_feedback_forms', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      // Whose form this is — only this user may edit it or see responses.
      product_manager_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      title: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT },
      // [{ id, label, type: 'text'|'rating'|'choice', options?: string[] }]
      questions: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'open' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.createTable('product_feedback_responses', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      form_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'product_feedback_forms', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      // SET NULL (not CASCADE) so a response survives the respondent's
      // account being deleted later — the PM's results shouldn't shrink
      // just because someone who filled it out left.
      respondent_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      respondent_name: { type: Sequelize.STRING(255) },
      // { [questionId]: string | number }
      answers: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      submitted_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('product_feedback_forms', ['product_manager_id'], { name: 'product_feedback_forms_pm_idx' });
    await queryInterface.addIndex('product_feedback_responses', ['form_id'], { name: 'product_feedback_responses_form_idx' });
    // One response per person per form — resubmitting replaces the previous answer (see lib/productFeedbackFormStore.ts).
    await queryInterface.addIndex('product_feedback_responses', ['form_id', 'respondent_id'], { name: 'product_feedback_responses_form_respondent_uq', unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_feedback_responses');
    await queryInterface.dropTable('product_feedback_forms');
  }
};
