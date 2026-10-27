'use strict';
const path = require('path');
const ROOT = __dirname;
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env.local'), quiet: true });
const db = require(path.join(ROOT, 'db/models'));

(async () => {
  try {
    const depts = await db.Department.findAll({ attributes: ['id', 'name'] });
    console.log('DEPARTMENTS:', depts.map((d) => d.get('name')));
    const aiDept = depts.find((d) => /^ai\b/i.test(d.get('name')));
    console.log('AI DEPT MATCH:', aiDept ? { id: aiDept.get('id'), name: aiDept.get('name') } : null);

    const roles = await db.Role.findAll({ attributes: ['id', 'key', 'label'] });
    console.log('ROLES:', roles.map((r) => ({ key: r.get('key'), label: r.get('label') })));
  } catch (e) {
    console.error('ERROR', e);
  } finally {
    await db.sequelize.close();
  }
})();
