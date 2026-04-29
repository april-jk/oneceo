import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { AdminButton } from './AdminButton';

type AdminDetailShellProps = {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
  originTrail?: ReactNode;
  entityType?: ReactNode;
  icon?: ReactNode;
  status?: ReactNode;
  risk?: ReactNode;
  lastUpdated?: ReactNode;
  metrics?: Array<{
    label: string;
    value: ReactNode;
    hint?: ReactNode;
    tone?: 'neutral' | 'success' | 'info' | 'warning' | 'danger' | 'processing';
  }>;
  summary?: ReactNode;
  tabs?: ReactNode;
  actions?: ReactNode;
  moreActions?: ReactNode;
  footer?: ReactNode;
  dangerZone?: ReactNode;
  inspector?: ReactNode;
  inspectorMode?: 'sticky' | 'none';
  children: ReactNode;
  size?: 'md' | 'lg' | 'xl' | 'fullscreen';
  className?: string;
  contentClassName?: string;
  zIndex?: number;
  onClose: () => void;
};

export function AdminDetailShell({
  open,
  title,
  subtitle,
  eyebrow,
  originTrail,
  entityType,
  icon,
  status,
  risk,
  lastUpdated,
  metrics,
  summary,
  tabs,
  actions,
  moreActions,
  footer,
  dangerZone,
  inspector,
  inspectorMode = 'sticky',
  children,
  size = 'xl',
  className,
  contentClassName,
  zIndex,
  onClose,
}: AdminDetailShellProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="admin-detail-overlay" style={zIndex ? { zIndex } : undefined} />
        <Dialog.Content className={clsx('admin-detail-shell', `admin-detail-shell-${size}`, className)} style={zIndex ? { zIndex: zIndex + 1 } : undefined}>
          <header className={clsx('admin-detail-header', (icon || metrics?.length || risk || lastUpdated || entityType) && 'admin-command-header')}>
            <div className="admin-detail-heading">
              {eyebrow || originTrail ? <div className="admin-detail-eyebrow">{originTrail || eyebrow}</div> : null}
              <div className="admin-command-identity-row">
                {icon ? <div className="admin-command-icon" aria-hidden="true">{icon}</div> : null}
                <div className="admin-command-title-stack">
                  <div className="admin-detail-title-row">
                    <Dialog.Title className="admin-detail-title">{title}</Dialog.Title>
                    {status ? <div className="admin-detail-status">{status}</div> : null}
                  </div>
                  <div className="admin-command-meta-row">
                    {entityType ? <span>{entityType}</span> : null}
                    {lastUpdated ? <span>{lastUpdated}</span> : null}
                    {risk ? <span>{risk}</span> : null}
                  </div>
                </div>
              </div>
              {subtitle ? <Dialog.Description className="admin-detail-subtitle">{subtitle}</Dialog.Description> : null}
              {metrics?.length ? (
                <dl className="admin-command-metrics">
                  {metrics.map((metric) => (
                    <div key={metric.label} className={clsx('admin-command-metric', `admin-command-metric-${metric.tone || 'neutral'}`)}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                      {metric.hint ? <small>{metric.hint}</small> : null}
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
            <div className="admin-detail-header-actions">
              {actions}
              {moreActions}
              <Dialog.Close asChild>
                <AdminButton variant="ghost" size="icon" iconOnly icon={<X size={16} />} aria-label="关闭详情" />
              </Dialog.Close>
            </div>
          </header>
          {summary ? <section className="admin-detail-summary">{summary}</section> : null}
          {tabs ? <div className="admin-detail-tabs">{tabs}</div> : null}
          <div className={clsx('admin-detail-body', inspector && inspectorMode !== 'none' && 'admin-command-body', contentClassName)}>
            <div className="admin-command-main">{children}</div>
            {inspector && inspectorMode !== 'none' ? <div className="admin-command-inspector-slot">{inspector}</div> : null}
          </div>
          {dangerZone || footer ? (
            <footer className="admin-detail-footer">
              <div className="admin-detail-danger-zone">{dangerZone}</div>
              <div className="admin-detail-footer-actions">{footer}</div>
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
