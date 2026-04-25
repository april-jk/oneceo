import * as Tabs from '@radix-ui/react-tabs';
import clsx from 'clsx';

export type AdminTabItem<T extends string = string> = {
  key: T;
  label: string;
  count?: number | null;
  warning?: boolean;
  dirty?: boolean;
  disabled?: boolean;
};

type AdminTabsProps<T extends string = string> = {
  value: T;
  items: AdminTabItem<T>[];
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
};

export function AdminTabs<T extends string = string>({ value, items, onChange, className, ariaLabel }: AdminTabsProps<T>) {
  return (
    <Tabs.Root value={value} onValueChange={(next) => onChange(next as T)} className={clsx('admin-tabs', className)}>
      <Tabs.List className="admin-tabs-list" aria-label={ariaLabel || '详情分页'}>
        {items.map((item) => (
          <Tabs.Trigger
            key={item.key}
            value={item.key}
            disabled={item.disabled}
            className={clsx('admin-tabs-trigger', item.warning && 'admin-tabs-trigger-warning', item.dirty && 'admin-tabs-trigger-dirty')}
          >
            <span>{item.label}</span>
            {typeof item.count === 'number' ? <span className="admin-tabs-count">{item.count}</span> : null}
            {item.dirty ? <span className="admin-tabs-dot" aria-label="有未保存变更" /> : null}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
