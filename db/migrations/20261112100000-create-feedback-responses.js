'use strict';

// Staff feedback on MatrixIQ itself — a TIME-BOXED collection, open until
// 18 Nov 2026 and then closed automatically (see lib/feedbackWindow.ts).
//
// The table is deliberately NOT dropped when the window closes. The window
// controls who can submit and who can see the form; the answers are the
// point of the exercise and stay for the admin to read afterwards. Dropping
// them on the 18th would throw away the only artefact this produces.
//
// `module_feedback` is JSONB rather than a child table on purpose: it holds
// one row per feature THAT PARTICULAR PERSON can see, and which features
// those are is decided at submit time by their role and department
// (lib/moduleConfigStore.ts's listVisibleModules). A relational child table
// would need a foreign key to a module list that an admin can edit or
// retire mid-window, which would either block those edits or orphan the
// answers. The submitted JSON is a snapshot of what they were actually
// asked about, which is what makes the answer readable a month later.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('feedback_responses', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      // SET NULL rather than CASCADE: if someone leaves the company their
      // feedback should not vanish with their account — the answers were
      // given about the product, not about them.
      user_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // Denormalised at submit time so the response stays readable even
      // after a user is deleted, renamed, moved department or promoted.
      // Reading "what did Sales think" a month later must not depend on the
      // roster still looking the way it did today.
      username: { type: Sequelize.STRING(120), allowNull: false },
      name: { type: Sequelize.STRING(160), allowNull: false },
      role: { type: Sequelize.STRING(60), allowNull: false },
      department: { type: Sequelize.STRING(120), allowNull: true },
      designation: { type: Sequelize.STRING(160), allowNull: true },
      // 1-5. Nullable because a person may want to write a comment without
      // scoring, and forcing a number would make them pick one at random.
      overall_rating: { type: Sequelize.INTEGER, allowNull: true },
      overall_comment: { type: Sequelize.TEXT, allowNull: true },
      // [{ key, label, section, rating, comment }] — see the note above.
      module_feedback: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      works_well: { type: Sequelize.TEXT, allowNull: true },
      slows_me_down: { type: Sequelize.TEXT, allowNull: true },
      missing_features: { type: Sequelize.TEXT, allowNull: true },
      // Lets someone revisit and replace their answer during the window
      // without losing when they first responded.
      submitted_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    // One response per person: submitting again REPLACES their answer rather
    // than adding a second one, so the admin reads a roster of opinions, not
    // a pile where whoever clicked twice counts double. Enforced here rather
    // than only in the store, because a double-submit from an impatient
    // double-click is exactly the race application code loses.
    await queryInterface.addIndex('feedback_responses', ['username'], {
      unique: true,
      name: 'feedback_responses_username_unique'
    });
    // The admin screen reads newest-first.
    await queryInterface.addIndex('feedback_responses', ['submitted_at'], {
      name: 'feedback_responses_submitted_at_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('feedback_responses', 'feedback_responses_submitted_at_idx');
    await queryInterface.removeIndex('feedback_responses', 'feedback_responses_username_unique');
    await queryInterface.dropTable('feedback_responses');
  }
};
