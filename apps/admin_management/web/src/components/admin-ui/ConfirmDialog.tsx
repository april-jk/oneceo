import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AdminButton } from './AdminButton';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  loading = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const handleOpenChange = (next: boolean) => {
    if (!next && !loading) {
      onCancel();
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="admin-danger-overlay" />
        <AlertDialog.Content className="admin-danger-dialog" style={{ maxWidth: 420 }}>
          <AlertDialog.Title className="admin-danger-dialog-title">{title}</AlertDialog.Title>
          {description && (
            <AlertDialog.Description className="admin-danger-dialog-description">
              {description}
            </AlertDialog.Description>
          )}
          <div className="admin-danger-actions">
            <AlertDialog.Cancel asChild>
              <AdminButton variant="secondary" disabled={loading}>{cancelLabel}</AdminButton>
            </AlertDialog.Cancel>
            <AdminButton variant="primary" loading={loading} onClick={() => void onConfirm()}>{confirmLabel}</AdminButton>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
