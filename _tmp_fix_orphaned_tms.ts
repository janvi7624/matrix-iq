// @ts-nocheck
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });

async function main() {
  const { db } = await import('./lib/db');
  const { Op } = await import('sequelize');
  const { cancelTmsProjectForLostDeal } = await import('./lib/tmsHandoff');

  const lostProjects = await db.Project.findAll({
    where: { stage: 'closed_lost', tms_project_id: { [Op.ne]: null } } as never,
    attributes: ['id', 'client_name', 'company', 'tms_project_id']
  });

  console.log(`Closed-Lost Sales projects with a linked TMS project: ${lostProjects.length}`);

  let fixed = 0;
  let alreadyClean = 0;
  for (const p of lostProjects) {
    const tmsId = p.get('tms_project_id') as string;
    const before = await db.TmsProject.findByPk(tmsId, { attributes: ['id', 'name', 'status'] });
    if (!before) continue;
    const statusBefore = before.get('status') as string;
    if (statusBefore === 'cancelled' || statusBefore === 'completed') {
      alreadyClean++;
      continue;
    }
    const openTasksBefore = await db.TmsTask.count({ where: { project_id: tmsId, status: { [Op.notIn]: ['completed', 'cancelled'] } } as never });
    await cancelTmsProjectForLostDeal(tmsId);
    console.log(`Cancelled: "${before.get('name')}" (${tmsId}) — was "${statusBefore}", ${openTasksBefore} open task(s) also cancelled. Sales project: ${p.get('client_name') || p.get('company')}`);
    fixed++;
  }

  console.log(`\nFixed: ${fixed}. Already clean: ${alreadyClean}. Total scanned: ${lostProjects.length}`);
  await db.sequelize.close();
}
main().catch(async (e) => { console.error('FATAL:', e.message); try { const { db } = await import('./lib/db'); await db.sequelize.close(); } catch {} process.exit(1); });
