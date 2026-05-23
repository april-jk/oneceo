import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AdminButton } from './AdminButton';
import { StatusBadge } from './StatusBadge';

type Reversibility = 'reversible' | 'partially_reversible' | 'irreversible';

type DangerConfirmDialogProps = {
  open: boolean;
  title: string;
  objectLabel: string;
  objectId?: string | null;
  objectName?: string | null;
  objectMeta?: Array<{ label: string; value: React.ReactNode }>;
  actionLabel: string;
  impactItems: string[];
  nonImpactItems?: string[];
  reversibility?: Reversibility;
  confirmText?: string;
  reasonRequired?: boolean;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (payload: { reason: string }) => void | Promise<void>;
};

const REVERSIBILITY_LABEL: Record<Reversibility, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  reversible: { label: '可恢复', tone: 'success' },
  partially_reversible: { label: '部分可恢复', tone: 'warning' },
  irreversible: { label: '不可逆', tone: 'danger' },
};

export function DangerConfirmDialog({
  open,
  title,
  objectLabel,
  objectId,
  objectName,
  objectMeta,
  actionLabel,
  impactItems,
  nonImpactItems,
  reversibility = 'partially_reversible',
  confirmText,
  reasonRequired = true,
  loading = false,
  error,
  onCancel,
  onConfirm,
}: DangerConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const reversibilityMeta = REVERSIBILITY_LABEL[reversibility];
  const requiredConfirmText = useMemo(() => confirmText || objectId || actionLabel, [actionLabel, confirmText, objectId]);
  const canSubmit = (!reasonRequired || reason.trim().length >= 2) && (!requiredConfirmText || typed.trim() === requiredConfirmText);

  useEffect(() => {
    if (!open) {
      setReason('');
      setTyped('');
    }
  }, [open]);

  useEffect(() => {
    setReason('');
    setTyped('');
  }, [actionLabel, objectId, objectName, requiredConfirmText]);

  const handleOpenChange = (next: boolean) => {
    if (!next && !loading) {
      setReason('');
      setTyped('');
      onCancel();
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    await onConfirm({ reason: reason.trim() });
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="admin-danger-overlay" />
        <AlertDialog.Content className="admin-danger-dialog">
          <div className="admin-danger-header">
            <div className="admin-danger-mark" aria-hidden="true"><AlertTriangle size={18} /></div>
            <div>
              <AlertDialog.Title className="admin-danger-title">{title}</AlertDialog.Title>
              <AlertDialog.Description className="admin-danger-subtitle">
                核对对象与影响后，输入确认词完成操作。
              </AlertDialog.Description>
            </div>
          </div>

          <div className="admin-danger-body">
            {/* Object summary */}
            <div className="admin-danger-summary">
              <div className="admin-danger-summary-row">
                <span className="admin-danger-summary-label">{objectLabel}</span>
                <span className="admin-danger-summary-name">{objectName || objectId || '-'}</span>
              </div>
              {objectMeta?.length ? (
                <dl className="admin-danger-meta">
                  {objectMeta.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>

            {/* Operation + reversibility */}
            <div className="admin-danger-op-row">
              <div className="admin-danger-op-item">
                <span>操作</span>
                <strong>{actionLabel}</strong>
              </div>
              <div className="admin-danger-op-item">
                <span>可逆性</span>
                <StatusBadge tone={reversibilityMeta.tone}>{reversibilityMeta.label}</StatusBadge>
              </div>
            </div>

            {/* Impact */}
            <div className="admin-danger-impact">
              <h4>影响范围</h4>
              <ul>
                {impactItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {nonImpactItems?.length ? (
                <div className="admin-danger-nonimpact">
                  <ShieldCheck size={12} aria-hidden="true" />
                  <span>不会发生：{nonImpactItems.join('；')}</span>
                </div>
              ) : null}
            </div>

            {/* Inputs */}
            <label className="admin-danger-field">
              <span>审计原因{reasonRequired ? '（必填）' : ''}</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="说明本次变更原因"
                rows={2}
              />
            </label>
            {requiredConfirmText ? (
              <label className="admin-danger-field">
                <span>
                  确认词：输入 <code>{requiredConfirmText}</code>
                </span>
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={requiredConfirmText}
                />
              </label>
            ) : null}
            {error ? <p className="admin-danger-error">{error}</p> : null}
          </div>

          <div className="admin-danger-actions">
            <AlertDialog.Cancel asChild>
              <AdminButton variant="secondary" disabled={loading}>取消</AdminButton>
            </AlertDialog.Cancel>
            <AdminButton variant="danger" loading={loading} disabled={!canSubmit} onClick={() => void submit()}>
              {actionLabel}
            </AdminButton>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
