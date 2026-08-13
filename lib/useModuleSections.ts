'use client';

import { useMemo } from 'react';
import { ModuleConfigRecord } from '@/lib/types';

export interface ModuleSection {
  label: string;
  tiles: ModuleConfigRecord[];
}

// Shared by Sidebar.tsx and Dashboard.tsx — both render the exact same
// /api/modules data, grouped by each module's free-text `section` field.
export function useModuleSections(modules: ModuleConfigRecord[] | null): ModuleSection[] {
  return useMemo(() => {
    const groups = new Map<string, ModuleConfigRecord[]>();
    (modules || []).forEach((m) => {
      const list = groups.get(m.section) || [];
      list.push(m);
      groups.set(m.section, list);
    });
    return [...groups.entries()].map(([label, tiles]) => ({ label, tiles: tiles.sort((a, b) => a.order - b.order) }));
  }, [modules]);
}
