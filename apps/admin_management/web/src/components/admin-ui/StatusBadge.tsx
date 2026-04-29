import type { ReactNode } from 'react';
import clsx from 'clsx';

export type StatusBadgeTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'processing';

type StatusBadgeProps = {
  tone?: StatusBadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  title?: string;
};

export function statusToneFromValue(value?: string | null): StatusBadgeTone {
  const normalized = String(value || '').toLowerCase();
  if (['active', 'running', 'ready', 'success', 'published', 'validated', 'completed', 'enabled'].includes(normalized)) return 'success';
  if (['creating', 'pending', 'uploaded', 'draft', 'waiting_user', 'in_progress', 'processing'].includes(normalized)) return 'processing';
  if (['paused', 'archived', 'disabled', 'closed', 'expired'].includes(normalized)) return 'warning';
  if (['failed', 'error', 'stopped', 'revoked', 'deleted'].includes(normalized)) return 'danger';
  return 'neutral';
}

export function StatusBadge({ tone = 'neutral', children, icon, className, title }: StatusBadgeProps) {
  return (
    <span className={clsx('admin-status-badge', `admin-status-badge-${tone}`, className)} title={title}>
      <span className="admin-status-badge-dot" aria-hidden="true">{icon || null}</span>
      <span>{children}</span>
    </span>
  );
}
