import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Briefcase, Code, TrendingUp, Wrench, Search, Palette, CheckCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ManagerType } from '../../../shared/types';

interface CreateManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateManager: (data: {
    name: string;
    type: ManagerType;
    description: string;
  }) => void;
}

const managerTypeDefs: Array<{
  type: ManagerType;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    type: 'development',
    icon: Code,
  },
  {
    type: 'operations',
    icon: TrendingUp,
  },
  {
    type: 'maintenance',
    icon: Wrench,
  },
  {
    type: 'market_research',
    icon: Search,
  },
  {
    type: 'design',
    icon: Palette,
  },
  {
    type: 'qa',
    icon: CheckCircle,
  },
];

export default function CreateManagerDialog({
  open,
  onOpenChange,
  onCreateManager,
}: CreateManagerDialogProps) {
  const { t } = useTranslation();
  const [selectedType, setSelectedType] = useState<ManagerType>('development');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const managerTypes = managerTypeDefs.map((type) => ({
    ...type,
    label: t(`createManagerDialog.types.${type.type}.label`),
    description: t(`createManagerDialog.types.${type.type}.description`),
  }));

  const handleCreate = () => {
    if (!name.trim()) return;

    onCreateManager({
      name: name.trim(),
      type: selectedType,
      description: description.trim() || managerTypes.find((t) => t.type === selectedType)?.description || '',
    });

    // Reset form
    setName('');
    setDescription('');
    setSelectedType('development');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            {t('createManagerDialog.title')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('createManagerDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Manager Type Selection */}
          <div className="space-y-3">
            <Label className="text-foreground font-semibold">{t('createManagerDialog.typeLabel')}</Label>
            <div className="grid grid-cols-2 gap-2">
              {managerTypes.map((type) => {
                const Icon = type.icon;
                return (
                  <motion.button
                    key={type.type}
                    onClick={() => setSelectedType(type.type)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`p-3 rounded-xl border transition-all duration-200 text-left ${
                      selectedType === type.type
                        ? 'border-foreground bg-foreground/5 ring-2 ring-foreground/20'
                        : 'border-border hover:border-foreground/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          selectedType === type.type
                            ? 'bg-foreground text-background'
                            : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{type.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {type.description}
                        </p>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Manager Name */}
          <div className="space-y-2">
            <Label htmlFor="manager-name" className="text-foreground font-semibold">
              {t('createManagerDialog.nameLabel')}
            </Label>
            <Input
              id="manager-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('createManagerDialog.namePlaceholder')}
              className="rounded-xl border-border"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="manager-description" className="text-foreground font-semibold">
              {t('createManagerDialog.managerDescriptionLabel')}
            </Label>
            <Textarea
              id="manager-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('createManagerDialog.managerDescriptionPlaceholder')}
              className="rounded-xl border-border min-h-[80px]"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex-1">
              <Button
                onClick={handleCreate}
                disabled={!name.trim()}
                className="w-full rounded-xl bg-foreground hover:bg-foreground/90 text-background font-medium"
              >
                <Briefcase className="w-4 h-4 mr-2" />
                {t('createManagerDialog.create')}
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                onClick={() => onOpenChange(false)}
                variant="outline"
                className="rounded-xl border-border font-medium"
              >
                {t('common.cancel')}
              </Button>
            </motion.div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
