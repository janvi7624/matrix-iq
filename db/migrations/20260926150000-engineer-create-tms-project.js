'use strict';

// Lets the Engineer role create TMS projects.
//
// Changing ENGINEER_MODULES in lib/roleStore.ts is not enough on its own:
// ensureSeeded() only INSERTS roles that are missing, and deliberately never
// rewrites the permissions of a role that already exists ("without touching
// anything an admin already customized"). Every environment already has the
// engineer row, so the stored JSON has to be patched here.
//
// Written as a merge of one key rather than a wholesale overwrite, so any other
// permission an admin has granted or revoked on this role through Role
// Management survives untouched. Idempotent: re-running changes nothing.
const ROLE_KEY = 'engineer';
const MODULE_KEY = 'tms-projects';

async function patch(queryInterface, apply) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT id, permissions FROM roles WHERE key = :roleKey`,
    { replacements: { roleKey: ROLE_KEY } }
  );
  if (!rows.length) return { skipped: 'no engineer role row' };

  const row = rows[0];
  // The column is JSONB, so the driver hands this back already parsed.
  const permissions = row.permissions || {};
  const modules = permissions.modules || {};
  const entry = modules[MODULE_KEY] || {};

  const next = apply(entry);
  if (next === null) return { skipped: 'already in the wanted state' };

  const updated = { ...permissions, modules: { ...modules, [MODULE_KEY]: next } };
  await queryInterface.sequelize.query(
    `UPDATE roles SET permissions = :permissions, "updatedAt" = NOW() WHERE id = :id`,
    { replacements: { permissions: JSON.stringify(updated), id: row.id } }
  );
  return { updated: next };
}

module.exports = {
  async up(queryInterface) {
    const result = await patch(queryInterface, (entry) => {
      if (entry.create === true) return null;
      // view is asserted alongside it because create without view would grant
      // the ability to make a project the engineer then could not open.
      return { ...entry, view: true, create: true };
    });
    console.log(`[engineer-create-tms-project] ${JSON.stringify(result)}`);
  },

  async down(queryInterface) {
    const result = await patch(queryInterface, (entry) => {
      if (entry.create !== true) return null;
      // Only `create` is withdrawn — `view` predates this migration and is
      // left alone so a rollback cannot lock engineers out of TMS Projects.
      const next = { ...entry };
      delete next.create;
      return next;
    });
    console.log(`[engineer-create-tms-project:down] ${JSON.stringify(result)}`);
  }
};
