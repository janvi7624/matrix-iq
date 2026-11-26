'use client';

import { useMemo } from 'react';
import Dropdown from './Dropdown';

export interface TeamMemberOption {
  id: string;
  username: string;
  name: string;
  phone: string;
  email: string;
}

interface TeamMemberSelectProps {
  options: TeamMemberOption[];
  value: string; // selected user id
  onChange: (option: TeamMemberOption) => void;
  placeholder?: string;
}

// Searchable team-member picker on the app's common Dropdown, so it looks
// and behaves like every other dropdown. onChange hands back the whole
// option (callers fill phone / email from it).
export default function TeamMemberSelect({ options, value, onChange, placeholder = 'Search team member…' }: TeamMemberSelectProps) {
  const items = useMemo(() => options.map((o) => ({ value: o.id, label: o.name, description: o.username ? `@${o.username}` : undefined })), [options]);

  return (
    <Dropdown
      options={items}
      value={options.some((o) => o.id === value) ? value : ''}
      onChange={(id) => {
        const picked = options.find((o) => o.id === id);
        if (picked) onChange(picked);
      }}
      placeholder={placeholder}
      searchable
      clearable={false}
      fullWidth
    />
  );
}
