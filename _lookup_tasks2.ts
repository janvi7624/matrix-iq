import { db } from './lib/db';

async function main() {
  const names = [
    'bhatinda technical planning',
    'meetIQ chnages for dental kit',
    'Solve Server DIsconnection Issue with All Application(Matrix IQ, VisitIQ, Nanta and Allbotix Website)',
    'Check and Prepare Sheet of the Nanta and Allbotics Google Analytics',
    'Create Visiting Card for all employee as per their requirement and also created 4 to 5 letter head as per their requirement.'
  ];

  for (const n of names) {
    const rows = await db.TmsTask.findAll({ where: { name: n } as never, include: [{ model: db.User, as: 'assignee', attributes: ['id','name'] }] });
    for (const r of rows) {
      const p = r.get({ plain: true }) as Record<string, unknown>;
      console.log(JSON.stringify({
        id: p.id,
        name: p.name,
        assignee: (p.assignee as { name?: string })?.name,
        status: p.status,
        due_date: p.due_date,
        completion_date: p.completion_date,
        created_at: p.createdAt,
        updated_at: p.updatedAt
      }));
    }
    if (!rows.length) console.log('NOT FOUND:', n);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
