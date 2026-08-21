import { Op } from 'sequelize';
import { db } from './db';
import { ProjectHandoverRecord } from './types';

function toRecord(row: any): ProjectHandoverRecord {
  const plain = row.get ? row.get({ plain: true }) : row;
  return {
    id: plain.id,
    project_id: plain.project_id,
    from_user_id: plain.from_user_id,
    from_username: plain.fromUser?.username ?? '',
    from_name: plain.fromUser?.name ?? '',
    to_user_id: plain.to_user_id,
    to_username: plain.toUser?.username ?? '',
    to_name: plain.toUser?.name ?? '',
    status: plain.status,
    remarks: plain.remarks ?? '',
    response_remarks: plain.response_remarks ?? '',
    project_title: plain.project?.client_name || plain.project?.company || '',
    created_at: plain.createdAt ?? plain.created_at ?? '',
    updated_at: plain.updatedAt ?? plain.updated_at ?? ''
  };
}

const ALL_INCLUDES = [
  { model: db.User, as: 'fromUser', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'toUser', attributes: ['id', 'username', 'name'] },
  { model: db.Project, as: 'project', attributes: ['id', 'client_name', 'company'] }
];

export const projectHandoverStore = {
  async create(data: { project_id: string; from_user_id: string; to_user_id: string; remarks: string }): Promise<ProjectHandoverRecord> {
    const row = await db.ProjectHandoverRequest.create(data);
    const full = await db.ProjectHandoverRequest.findByPk(row.get('id') as string, { include: ALL_INCLUDES });
    return toRecord(full);
  },

  async findById(id: string): Promise<ProjectHandoverRecord | null> {
    const row = await db.ProjectHandoverRequest.findByPk(id, { include: ALL_INCLUDES });
    return row ? toRecord(row) : null;
  },

  async findPendingForProject(projectId: string): Promise<ProjectHandoverRecord | null> {
    const row = await db.ProjectHandoverRequest.findOne({
      where: { project_id: projectId, status: 'pending' },
      include: ALL_INCLUDES,
      order: [['created_at', 'DESC']]
    });
    return row ? toRecord(row) : null;
  },

  async listForUser(userId: string): Promise<ProjectHandoverRecord[]> {
    const rows = await db.ProjectHandoverRequest.findAll({
      where: { [Op.or]: [{ from_user_id: userId }, { to_user_id: userId }] } as never,
      include: ALL_INCLUDES,
      order: [['created_at', 'DESC']]
    });
    return rows.map(toRecord);
  },

  async listPendingForUser(userId: string): Promise<ProjectHandoverRecord[]> {
    const rows = await db.ProjectHandoverRequest.findAll({
      where: { to_user_id: userId, status: 'pending' },
      include: ALL_INCLUDES,
      order: [['created_at', 'DESC']]
    });
    return rows.map(toRecord);
  },

  async respond(id: string, status: 'approved' | 'rejected' | 'cancelled', responseRemarks: string): Promise<ProjectHandoverRecord | null> {
    await db.ProjectHandoverRequest.update(
      { status, response_remarks: responseRemarks },
      { where: { id } }
    );
    return this.findById(id);
  }
};
