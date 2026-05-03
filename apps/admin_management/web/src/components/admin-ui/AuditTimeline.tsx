import type { ReactNode } from 'react';
import clsx from 'clsx';
import { CodePanel } from './CodePanel';

export type AuditTimelineItem = {
  id: string;
  time?: string | null;
  title: string;
  description?: ReactNode;
  actor?: ReactNode;
  reason?: ReactNode;
  status?: ReactNode;
  tone?: 'neutral' | 'success' | 'info' | 'warning' | 'danger' | 'processing';
  icon?: ReactNode;
  meta?: Array<{ label: string; value: ReactNode }>;
  raw?: unknown;
  onOpenTarget?: () => void;
};

type AuditTimelineProps = {
  items: AuditTimelineItem[];
  compact?: boolean;
  maxItems?: number;
  emptyText?: string;
  className?: string;
};

export function AuditTimeline({ items, compact = false, maxItems, emptyText = '暂无可展示的审计事件。', className }: AuditTimelineProps) {
  const visibleItems = typeof maxItems === 'number' ? items.slice(0, maxItems) : items;
  if (!visibleItems.length) {
    return <p className={clsx('admin-audit-timeline-empty', className)}>{emptyText}</p>;
  }
  return (
    <ol className={clsx('admin-audit-timeline', compact && 'admin-audit-timeline-compact', className)}>
      {visibleItems.map((item) => (
        <li key={item.id} className={clsx('admin-audit-timeline-item', `admin-audit-timeline-item-${item.tone || 'neutral'}`)}>
          <div className="admin-audit-timeline-marker">{item.icon}</div>
          <div className="admin-audit-timeline-card">
            <div className="admin-audit-timeline-head">
              <div>
                <strong>{item.title}</strong>
                {item.time ? <time>{item.time}</time> : null}
              </div>
              {item.status ? <span>{item.status}</span> : null}
            </div>
            {item.description ? <p>{item.description}</p> : null}
            {item.actor || item.reason ? <p className="admin-audit-timeline-meta">{item.actor ? <>操作人：{item.actor}</> : null}{item.actor && item.reason ? ' · ' : null}{item.reason ? <>原因：{item.reason}</> : null}</p> : null}
            {item.meta?.length ? (
              <dl className="admin-audit-timeline-kv">
                {item.meta.map((meta) => <div key={meta.label}><dt>{meta.label}</dt><dd>{meta.value}</dd></div>)}
              </dl>
            ) : null}
            {!compact && item.raw !== undefined ? <CodePanel title="Raw payload" value={item.raw} language="json" maxHeight={180} /> : null}
            {item.onOpenTarget ? <button type="button" className="admin-audit-timeline-link" onClick={item.onOpenTarget}>打开关联对象</button> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
