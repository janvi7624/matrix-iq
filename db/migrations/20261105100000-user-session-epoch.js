'use strict';

/**
 * Dedicated session-revocation epoch for users (db/models/user.js's
 * sessionEpoch) — split out from lastLoginAt because that column is
 * re-stamped on every ordinary login, so reusing it as the revocation
 * marker meant a second login (another tab, another device) silently
 * signed the account out everywhere else too. This column is bumped only
 * by touchSessionEpoch (logout, password change) — never by login.
 *
 * Defaults to NOW() so every existing row gets a real value: any token
 * already in circulation was issued before this column existed and carries
 * no sessionEpoch claim at all, which isSessionEpochCurrent() treats as
 * "nothing to compare against" — so backfilling this doesn't invalidate
 * anyone's current session.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'sessionEpoch', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn('now')
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'sessionEpoch');
  }
};
