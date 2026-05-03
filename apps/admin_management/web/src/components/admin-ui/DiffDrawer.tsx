import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { AdminButton } from './AdminButton';
import { CodePanel } from './CodePanel';

export type DiffField = {
  key: string;
  label: string;
  before?: ReactNode;
  after?: ReactNode;
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
};

type DiffDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  objectLabel?: string;
  fields?: DiffField[];
  beforeText?: string;
  afterText?: string;
  language?: 'json' | 'markdown' | 'text';
  impactItems?: string[];
  rollbackHint?: ReactNode;
  syncHint?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
};

export function DiffDrawer({ open, title, subtitle, objectLabel, fields = [], beforeText, afterText, language = 'text', impactItems, rollbackHint, syncHint, onClose, footer, className }: DiffDrawerProps) {
  const hasFieldChanges = fields.some((field) => field.changeType !== 'unchanged');
  const hasTextPair = beforeText !== undefined || afterText !== undefined;
  const hasTextChanges = hasTextPair && (beforeText || '') !== (afterText || '');
  const hasComparableContent = fields.length > 0 || hasTextPair;
  const hasChanges = hasFieldChanges || hasTextChanges;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="admin-detail-overlay" />
        <Dialog.Content className={clsx('admin-diff-drawer', className)} aria-describedby={undefined}>
          <header className="admin-diff-drawer-header">
            <div>
              {objectLabel ? <p>{objectLabel}</p> : null}
              <Dialog.Title>{title}</Dialog.Title>
              {subtitle ? <Dialog.Description>{subtitle}</Dialog.Description> : null}
            </div>
            <Dialog.Close asChild>
              <AdminButton variant="ghost" size="icon" iconOnly icon={<X size={16} />} aria-label="关闭 Diff" />
            </Dialog.Close>
          </header>
          <div className="admin-diff-drawer-body">
            {impactItems?.length ? (
              <section className="admin-diff-impact">
                <h4>影响范围</h4>
                <ul>{impactItems.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ) : null}
            {hasComparableContent && !hasChanges ? (
              <section className="admin-diff-empty-state">
                <h4>当前没有未保存变更</h4>
                <p>Before 与 After 来自真实当前值，暂未检测到差异。</p>
              </section>
            ) : null}
            {fields.length && hasChanges ? (
              <section className="admin-diff-field-list">
                {fields.map((field) => (
                  <article key={field.key} className={clsx('admin-diff-field', `admin-diff-field-${field.changeType}`)}>
                    <h4>{field.label}</h4>
                    <div className="admin-diff-field-values">
                      <div><span>Before</span><strong>{field.before ?? '-'}</strong></div>
                      <div><span>After</span><strong>{field.after ?? '-'}</strong></div>
                    </div>
                  </article>
                ))}
              </section>
            ) : null}
            {hasTextPair && hasChanges ? (
              <div className="admin-diff-code-grid">
                <CodePanel title="Before" value={beforeText || ''} language={language} maxHeight={260} />
                <CodePanel title="After" value={afterText || ''} language={language} maxHeight={260} />
              </div>
            ) : null}
            {rollbackHint || syncHint ? <div className="admin-diff-hints">{rollbackHint ? <p>{rollbackHint}</p> : null}{syncHint ? <p>{syncHint}</p> : null}</div> : null}
          </div>
          {footer ? <footer className="admin-diff-drawer-footer">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
