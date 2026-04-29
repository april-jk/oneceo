import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AdminButton } from './AdminButton';
import { IdToken } from './IdToken';
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
          <div className="admin-danger-dialog-mark" aria-hidden="true"><AlertTriangle size={22} /></div>
          <AlertDialog.Title className="admin-danger-dialog-title">{title}</AlertDialog.Title>
          <AlertDialog.Description className="admin-danger-dialog-description">
            这是一项需要审计的管理操作，请先核对对象、影响范围与确认词。
          </AlertDialog.Description>

          <section className="admin-danger-object-panel">
            <div>
              <span>对象</span>
              <strong>{objectLabel}</strong>
            </div>
            {objectName ? <p>{objectName}</p> : null}
            {objectId ? <IdToken label="ID" value={objectId} /> : null}
            {objectMeta?.length ? (
              <dl className="admin-danger-meta-grid">
                {objectMeta.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>

          <section className="admin-danger-impact-grid">
            <div>
              <h4>操作</h4>
              <p>{actionLabel}</p>
            </div>
            <div>
              <h4>不可逆程度</h4>
              <StatusBadge tone={reversibilityMeta.tone}>{reversibilityMeta.label}</StatusBadge>
            </div>
          </section>

          <section className="admin-danger-list-section">
            <h4>影响范围</h4>
            <ul>{impactItems.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          {nonImpactItems?.length ? (
            <section className="admin-danger-list-section admin-danger-nonimpact">
              <h4><ShieldCheck size={14} aria-hidden="true" /> 不会发生</h4>
              <ul>{nonImpactItems.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          ) : null}

          <label className="admin-danger-field">
            <span>审计原因{reasonRequired ? '（必填）' : ''}</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="说明本次变更原因，便于后续追溯" rows={3} />
          </label>
          {requiredConfirmText ? (
            <label className="admin-danger-field">
              <span>确认词：输入 <code>{requiredConfirmText}</code></span>
              <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={requiredConfirmText} />
            </label>
          ) : null}
          {error ? <p className="admin-danger-error">{error}</p> : null}

          <div className="admin-danger-actions">
            <AlertDialog.Cancel asChild>
              <AdminButton variant="secondary" disabled={loading}>取消</AdminButton>
            </AlertDialog.Cancel>
            <AdminButton variant="danger" loading={loading} disabled={!canSubmit} onClick={() => void submit()}>{actionLabel}</AdminButton>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
