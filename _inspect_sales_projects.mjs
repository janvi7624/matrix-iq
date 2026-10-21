import { db } from './lib/db.ts';

const PROJECT_ID = '0eadae4c-56f0-4c2e-84bf-682dabb5f38d';
const QUOTATION_ID = 'c2063490-1388-43d4-b3d6-b70277dac8c4';

async function main() {
  const [notes, timeline, followUps, products, demos, revisions] = await Promise.all([
    db.ProjectNote.count({ where: { project_id: PROJECT_ID } }),
    db.ProjectTimelineEvent.count({ where: { project_id: PROJECT_ID } }),
    db.QuotationFollowUp.count({ where: { quotation_id: QUOTATION_ID } }),
    db.QuotationProduct.count({ where: { quotation_id: QUOTATION_ID } }),
    db.DemoSchedule.count({ where: { quotation_id: QUOTATION_ID } }),
    db.Quotation.count({ where: { original_quotation_id: QUOTATION_ID } })
  ]);
  console.log({ notes, timeline, followUps, products, demos, revisions });
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
