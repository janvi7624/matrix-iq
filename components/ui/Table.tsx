import { ReactNode } from 'react';
import styles from '../quotationHistory.module.css';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  empty?: ReactNode;
}

// Wraps the existing .tableWrap/.table CSS (quotationHistory.module.css)
// rather than introducing a second table stylesheet — see components/ui's
// established convention (Button/StatusBadge/PriorityBadge do the same).
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  const classes = [styles.tableWrap, className || ''].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}

export default function Table<T>({ columns, rows, rowKey, rowClassName, empty }: TableProps<T>) {
  return (
    <TableWrap>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.headerClassName}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((col) => (
                <td key={col.key} className={col.cellClassName}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && empty && (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </TableWrap>
  );
}
