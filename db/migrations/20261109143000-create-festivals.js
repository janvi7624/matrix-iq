'use strict';

// Company-wide Indian festival greetings — HR-managed, same shape as
// support_sla_policies: configuration a business decision changes, not a
// deploy. Previously a hardcoded array in lib/festivalCalendar.ts; moved
// into the database so HR (the role that owns this) can add next year's
// dates themselves from a screen instead of asking engineering to edit
// code every year.
//
// `date` is DATEONLY (not derived from a formula) because several of these
// follow the lunar/Islamic calendar and genuinely cannot be computed —
// see `provisional` below.
//
// `key` stays unique and immutable once used: it is the per-day dedup
// marker (`festival_<key>`, see lib/festivalStore.ts) that stops the
// greeting being sent twice in one day. Changing an existing row's key
// after it has already fired once would let that festival re-fire.
//
// Seeded with the 13 entries already researched and confirmed (DoPT
// gazetted-holiday circular where available, cross-checked elsewhere for
// lunar dates) covering Nov 2026 through Dec 2027, so the module works the
// moment it is migrated — all 13 are editable and none is special-cased in
// code.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('festivals', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      key: { type: Sequelize.STRING(60), allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      greeting: { type: Sequelize.TEXT, allowNull: false },
      // True only for a lunar-calendar date not yet officially confirmed
      // (moon-sighting festivals, confirmed only a day or two ahead each
      // year) — shown as a caution badge on the HR screen so whoever
      // maintains this knows to double-check closer to the date.
      provisional: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.sequelize.query('CREATE UNIQUE INDEX festivals_key_unique ON festivals (key)');
    await queryInterface.addIndex('festivals', ['date'], { name: 'festivals_date_idx' });

    await queryInterface.bulkInsert('festivals', [
      { key: 'gujarati-new-year', name: 'Gujarati New Year (Bestu Varas) / Govardhan Puja', date: '2026-11-10', greeting: 'Saal Mubarak! Wishing you a prosperous and joyful Gujarati New Year.', provisional: false },
      { key: 'bhai-dooj', name: 'Bhai Dooj', date: '2026-11-11', greeting: 'Happy Bhai Dooj! Celebrating the special bond between brothers and sisters.', provisional: false },
      { key: 'christmas', name: 'Christmas', date: '2026-12-25', greeting: 'Merry Christmas! Wishing you joy, warmth, and wonderful moments with your loved ones.', provisional: false },
      { key: 'republic-day', name: 'Republic Day', date: '2027-01-26', greeting: 'Happy Republic Day! Celebrating the spirit of our Constitution and the unity of our nation.', provisional: false },
      { key: 'eid-ul-fitr', name: 'Eid-ul-Fitr', date: '2027-03-10', greeting: 'Eid Mubarak! Wishing you and your family peace, happiness, and prosperity.', provisional: true },
      { key: 'holi', name: 'Holi', date: '2027-03-23', greeting: 'Happy Holi! May your life be filled with as many colours as the festival itself.', provisional: false },
      { key: 'eid-ul-adha', name: 'Eid-ul-Adha (Bakrid)', date: '2027-05-17', greeting: 'Eid Mubarak! Wishing you a blessed Bakrid filled with warmth and togetherness.', provisional: true },
      { key: 'independence-day', name: 'Independence Day', date: '2027-08-15', greeting: 'Happy Independence Day! Proud to celebrate the freedom and spirit of our nation together.', provisional: false },
      { key: 'raksha-bandhan', name: 'Raksha Bandhan', date: '2027-08-17', greeting: 'Happy Raksha Bandhan! Celebrating the bonds that protect and strengthen us.', provisional: false },
      { key: 'ganesh-chaturthi', name: 'Ganesh Chaturthi', date: '2027-09-04', greeting: 'Happy Ganesh Chaturthi! May Lord Ganesha bring wisdom, prosperity, and good fortune to you and your family.', provisional: false },
      { key: 'gandhi-jayanti', name: 'Gandhi Jayanti', date: '2027-10-02', greeting: "Remembering Mahatma Gandhi's vision of truth and non-violence on his birth anniversary.", provisional: false },
      { key: 'dussehra', name: 'Dussehra', date: '2027-10-09', greeting: 'Happy Dussehra! Wishing you the strength to overcome every challenge, just as good triumphs over evil.', provisional: false },
      { key: 'diwali', name: 'Diwali', date: '2027-10-29', greeting: 'Happy Diwali! May this festival of lights bring prosperity, joy, and brightness to you and your family.', provisional: false },
      { key: 'gujarati-new-year-2027', name: 'Gujarati New Year (Bestu Varas) / Govardhan Puja', date: '2027-10-30', greeting: 'Saal Mubarak! Wishing you a prosperous and joyful Gujarati New Year.', provisional: false },
      { key: 'bhai-dooj-2027', name: 'Bhai Dooj', date: '2027-10-31', greeting: 'Happy Bhai Dooj! Celebrating the special bond between brothers and sisters.', provisional: true },
      { key: 'christmas-2027', name: 'Christmas', date: '2027-12-25', greeting: 'Merry Christmas! Wishing you joy, warmth, and wonderful moments with your loved ones.', provisional: false }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS festivals_key_unique');
    await queryInterface.dropTable('festivals');
  }
};
