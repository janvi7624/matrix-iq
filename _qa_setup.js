'use strict';
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const ROOT = __dirname;
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env.local'), quiet: true });
const db = require(path.join(ROOT, 'db/models'));

const QA_USERNAME = 'QA_TEST_ai_dropdown';
const QA_PASSWORD = 'QA_TEST_pw_7f3k9!';

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

(async () => {
  try {
    const aiDept = await db.Department.findOne({ where: { name: 'AI' } });
    if (!aiDept) throw new Error('AI department not found');
    const aiDeptId = aiDept.get('id');

    const engineerRole = await db.Role.findOne({ where: { key: 'engineer' } });
    if (!engineerRole) throw new Error('engineer role not found');

    const passwordHash = await hashPassword(QA_PASSWORD);

    const user = await db.User.create({
      username: QA_USERNAME,
      passwordHash,
      name: 'QA_TEST AI Dropdown',
      phone: '',
      email: 'qa_test_ai_dropdown@nantatech.com',
      roleId: engineerRole.get('id'),
      employeeId: 'QA_TEST_EMP',
      department: 'AI',
      departmentId: aiDeptId,
      designation: 'QA Test Engineer',
      status: 'active',
      mustChangePassword: false
    });
    const userId = user.get('id');

    const project = await db.TmsProject.create({
      project_code: 'TMS-PRJ-QATEST-0001',
      name: 'QA_TEST dropdown Project',
      client_name: 'QA_TEST Client',
      description: 'QA_TEST fixture project for AI daily-report dropdown verification. Safe to delete.',
      department_id: aiDeptId,
      project_manager_id: userId,
      team_member_ids: [userId],
      status: 'in_progress',
      project_type: 'department',
      priority: 'medium',
      progress_percent: 0,
      remarks: 'QA_TEST fixture',
      attachments: [],
      created_by: userId
    });
    const projectId = project.get('id');

    console.log('QA_SETUP_OK', JSON.stringify({ userId, username: QA_USERNAME, password: QA_PASSWORD, aiDeptId, projectId }));
  } catch (e) {
    console.error('QA_SETUP_ERROR', e);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
})();
