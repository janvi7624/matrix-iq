# Common UI components

One header, one button, one chip, all built on the `--mx-*` tokens in `app/globals.css`. Use these instead of hand-rolling a `<button className={styles.whatever}>`.

## Design tokens

Base tokens (brand, neutrals, semantic colours, radius, shadow, spacing, type, motion, z-index) are in the first `:root` block of `app/globals.css`. The **Component tokens** block below them gives each one a role:

| Group | Tokens |
|---|---|
| Roles | `--mx-primary`, `--mx-primary-hover`, `--mx-on-primary`, `--mx-secondary`, `--mx-bg`, `--mx-text-primary`, `--mx-text-secondary` |
| Selection | `--mx-selected-bg`, `--mx-selected-bg-hover`, `--mx-selected-fg`, `--mx-selected-border`, `--mx-unselected-bg/-fg/-border/-hover-border` |
| Disabled | `--mx-disabled-opacity`, `--mx-disabled-bg`, `--mx-disabled-fg` |
| Focus | `--mx-focus-ring-color`, `--mx-focus-ring-width`, `--mx-focus-ring-offset` |
| Touch | `--mx-touch-target` (44px) |
| Buttons | `--mx-btn-h-{sm,md,lg}`, `--mx-btn-px-*`, `--mx-btn-font-*`, `--mx-btn-radius`, `--mx-btn-gap` |
| Chips | `--mx-chip-h-*`, `--mx-chip-px-*`, `--mx-chip-font-*`, `--mx-chip-radius`, `--mx-chip-gap` |
| Icons | `--mx-icon-{xs,sm,md,lg,xl}` (14–24px) |
| Header | `--mx-header-bg/-fg/-fg-muted/-fg-faint/-accent/-control-hover/-px/-py/-title-size` |

Selected always means a **solid brand fill with white text**, so a selected chip or toggle never looks like its unselected neighbours.

## CommonHeader — `components/ui/CommonHeader.tsx`

```
[logo] [breadcrumb / title / subtitle] ............ [search] [custom] [actions] [⋮]
```

Every signed-in page gets the dark app bar through `AppShell` (or `PartnerShell`). **The app bar has no back button.**

```tsx
<AppShell title="Task" subtitle="On Project X" headerActions={[{ key: 'export', label: 'Export', icon: <Download />, onClick: exportCsv }]}>
```

Props: `title`, `subtitle`, `breadcrumb`, `rightActions`, `customActions`, `showSearch` / `search` / `searchValue` / `onSearchChange`, `menuItems` (⋮ menu), `className`. With `tone="light"` it becomes an in-page sub-header whose back button is on by default: `<CommonHeader tone="light" title=… onBack={closeDetail} />`.

## PageBackButton — `components/ui/PageBackButton.tsx`

The back control for **sub-pages only**: detail `[id]` pages, new/edit/import pages, and in-page detail views opened from a list. Top-level pages reached from the sidebar don't get one.

```tsx
<div className={styles.topRow}>            {/* the page's own first row */}
  <PageBackButton fallbackRoute="/tms/tasks" />   {/* always the FIRST item */}
  <StatusBadge … /> <CommonButton …>View Project</CommonButton>
</div>
<PageBackButton onBack={() => setOpenId(null)} label="Back to list" />   {/* state-based */}
<PageBackButton rootRoute="/partner" />                                     {/* partner portal */}
```

- It is a 44×44 chevron-left icon button with `aria-label="Go back"` and no "Back" text.
- **Behaviour:** if this tab has an in-app screen behind the current one, it calls `router.back()`. Otherwise it goes to `fallbackRoute`, or, by default, the nearest real parent page (`/tms/tasks/123` → `/tms/tasks`). See `lib/backNavigation.ts`. It renders as a real link to the fallback, so new-tab and middle-click work.

## CommonButton — `components/ui/CommonButton.tsx`

```tsx
<CommonButton variant="primary" leadingIcon={<Plus />} onClick={create}>New lead</CommonButton>
<CommonButton variant="destructive" size="sm" onClick={remove}>Delete</CommonButton>
<CommonButton iconOnly aria-label="Edit" leadingIcon={<Pencil />} size="sm" onClick={edit} />
<CommonButton selected={view === 'grid'} variant="outlined" onClick={() => setView('grid')}>Grid</CommonButton>
<CommonButton type="submit" loading={saving} loadingLabel="Saving…">Save</CommonButton>
<CommonButton href="/projects">Projects</CommonButton>              {/* next/link */}
<CommonButton href="/api/leads/export.csv" native>Export</CommonButton> {/* plain <a> */}
```

| Prop | Values |
|---|---|
| `variant` | `primary` · `secondary` (default) · `outlined` · `ghost` · `destructive` · `destructiveSolid` · `success` · `link` |
| `size` | `sm` (36px, rows/inline) · `md` (46px, default) · `lg` (52px) |
| states | hover, active, `selected` (aria-pressed), `disabled`, `loading` (+`loadingLabel`) |
| other | `leadingIcon`, `trailingIcon`, `iconOnly` (needs `aria-label`), `fullWidth`, `tone="inverse"` for dark surfaces, `href` / `native` |

It defaults to `type="button"`. Pass `type="submit"` for form submit buttons.

The older wrappers `ui/Button`, `ui/ToolbarButton` (`ToolbarLink`, `DeleteButton`), `ui/SubmitButton` and `ui/SegmentedToggle` still work and now render through CommonButton.

## CommonChip — `components/ui/CommonChip.tsx`

```tsx
<CommonChip selected={status === 'open'} onClick={() => setStatus('open')}>Open</CommonChip>   {/* controlled */}
<CommonChip defaultSelected onSelectedChange={(on) => …}>Remote</CommonChip>                    {/* uncontrolled */}
<CommonChip onRemove={() => clearCity()}>Pune</CommonChip>                                       {/* removable tag */}
<CommonChip tone="info" size="sm">Draft</CommonChip>                                             {/* static tag */}

<CommonChipGroup ariaLabel="Status" options={opts} value={status} onChange={setStatus} />             {/* single */}
<CommonChipGroup ariaLabel="Tags" multiple options={opts} value={tags} onChange={setTags} />          {/* multi */}
```

- Selectable chips render `<button aria-pressed>`. They show a check mark when selected (`showCheck={false}` turns it off).
- Sizes: `sm` / `md` / `lg`. Also: `disabled`, `leadingIcon`, `trailingIcon`, `count`.
- Status badges (`StatusBadge`, `PriorityBadge`) are not chips. Keep using them for status.

## StatCard — `components/ui/StatCard.tsx`

The one KPI / summary / count card. Clean and neutral: white card, grey icon tile, big dark value, muted label. **Clickable cards show a → arrow top-right**; on hover/focus/selected they lift, get a red-to-navy accent line on top, the icon tile turns dark and the arrow turns red. Static cards have no arrow.

```tsx
<StatCardGrid>                                                   {/* responsive grid, minWidth={160} default */}
  <StatCard value={31} label="Total Projects" />                                   {/* static */}
  <StatCard value={22} label="Active Projects" onClick={openActive} actionLabel="View active projects" />
  <StatCard value={5} label="Delayed Projects" tone="danger" onClick={openDelayed} />
  <StatCard value={3} label="Overdue" href="/my-tasks?f=overdue" />                 {/* link card */}
  <StatCard value={8} label="Pending" onClick={() => setKpi('pending')} selected={kpi === 'pending'} />  {/* filter card */}
</StatCardGrid>
```

| Prop | Values |
|---|---|
| content | `value`, `label`, `sub` (third line), `icon` (tinted square), `children` (e.g. a progress bar) |
| `tone` | `default` · `danger` · `warning` · `success` · `info` · `accent` · `brand` — only tints the icon tile; values and backgrounds stay neutral |
| interaction | `onClick` → `<button>`, `href` → link (`native` for a plain `<a>`), `selected` (aria-pressed), `disabled`, `actionLabel` (screen-reader hint), `actionIcon` |
| layout | `valueSize="sm"` (text values), `size="compact"`, `align="center"`, `className`, `style` |

`ui/StatTile` still works and now renders through StatCard.
