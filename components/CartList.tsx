'use client';

import { CartItem } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { X } from 'lucide-react';
import CommonButton from '@/components/ui/CommonButton';
import styles from './calculator.module.css';

interface CartListProps {
  items: CartItem[];
  onAdd: () => void;
  onRemove: (id: number) => void;
  onChangeRemark: (id: number, remark: string) => void;
  // Whether a product is actually configured above right now — used to make
  // the "add" button visually obvious as the next step (solid, primary)
  // instead of looking like just another dashed "+" button on the page.
  hasActiveProduct: boolean;
}

export default function CartList({ items, onAdd, onRemove, onChangeRemark, hasActiveProduct }: CartListProps) {
  return (
    <div className={styles.row}>
      <div className={styles.field}>
        <label className={styles.label}>Products in this quote</label>
        <div>
          {items.map((item) => (
            <div key={item.id} className={styles.mb8}>
              <div className={styles.lineItemRow}>
                <span className={styles.flexFill}>{item.label}</span>
                <span>{formatMoney(item.subtotal)}</span>
                <CommonButton
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label="Remove product"
                  title="Remove product"
                  leadingIcon={<X />}
                  onClick={() => onRemove(item.id)}
                />
              </div>
              <input
                type="text"
                className={styles.formControl}
                placeholder="Remark for this product (optional) — shown in the PDF"
                value={item.remark || ''}
                onChange={(e) => onChangeRemark(item.id, e.target.value)}
              />
            </div>
          ))}
        </div>
        <CommonButton variant={hasActiveProduct ? 'primary' : 'secondary'} fullWidth onClick={onAdd}>
          Add This Product to the Quote
        </CommonButton>
        <div className={styles.small}>
          {hasActiveProduct
            ? 'Ready to add. Tap the button above, then pick another product to add more.'
            : 'Fill in the product details above first — this button turns solid red once it’s ready to add.'}
        </div>
      </div>
    </div>
  );
}
