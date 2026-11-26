import { describe, it, expect, vi } from 'vitest';

// clientMasterQuery only needs the outcome labels from the store; the store
// itself pulls in Sequelize, so it is stubbed.
vi.mock('../../lib/clientMasterStore', () => ({
  CALL_OUTCOME_LABEL: { '': 'Not called yet', suitable: 'Suitable', not_suitable: 'Not suitable', completed: 'Not interested', callback: 'Call back' }
}));

import { filterClients } from '../../lib/clientMasterQuery';
import type { ClientMasterRow } from '../../lib/clientMasterStore';

function row(over: Partial<ClientMasterRow> & { key: string }): ClientMasterRow {
  return {
    displayName: over.key,
    type: 'customer',
    callOutcome: '',
    leadCount: 0,
    contacts: [],
    productHandlers: [],
    owners: [],
    projects: [],
    statusCounts: {},
    createdAt: '',
    ...over
  } as unknown as ClientMasterRow;
}

const rows = [
  row({ key: 'Acme', owners: [{ username: 'asha', name: 'Asha' }], productHandlers: [{ product: 'AV', handledBy: 'x' }] } as never),
  row({ key: 'Beta', type: 'prospect', leadCount: 1, callOutcome: 'suitable', owners: [{ username: 'ravi', name: 'Ravi' }] } as never),
  row({ key: 'Gamma', type: 'prospect', leadCount: 1, callOutcome: '' }),
  row({ key: 'Delta', productHandlers: [{ product: 'Robotics', handledBy: 'y' }] } as never)
];
const keys = (q: Parameters<typeof filterClients>[1]) => filterClients(rows, q).map((c) => c.displayName);

describe('filterClients — multi-value filters', () => {
  it('still accepts a single value', () => {
    expect(keys({ company: 'Beta' })).toEqual(['Beta']);
    expect(keys({ outcome: 'not_called' })).toEqual(['Gamma']);
  });

  it('treats an empty list as no filter', () => {
    expect(keys({ company: [], owner: [], type: [], outcome: [], handler: [] })).toHaveLength(4);
  });

  it('ORs the values of one filter', () => {
    expect(keys({ company: ['Acme', 'Delta'] })).toEqual(['Acme', 'Delta']);
    expect(keys({ owner: ['asha', 'ravi'] })).toEqual(['Acme', 'Beta']);
    expect(keys({ handlerName: ['AV', 'Robotics'] })).toEqual(['Acme', 'Delta']);
    expect(keys({ outcome: ['not_called', 'suitable'] })).toEqual(['Beta', 'Gamma']);
    expect(keys({ type: ['customer', 'prospect'] })).toHaveLength(4);
    expect(keys({ handler: ['has', 'none'] })).toHaveLength(4);
    expect(keys({ handler: ['none'] })).toEqual(['Beta', 'Gamma']);
  });

  it('ANDs different filters', () => {
    expect(keys({ type: ['prospect'], outcome: ['suitable', 'callback'] })).toEqual(['Beta']);
  });
});
