import { useState } from 'react';
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

const managerTypes: Array<{
  type: ManagerType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    type: 'development',
    label: '开发经理 (Development Manager)',
    icon: Code,
    description: '负责软件开发、编码和技术实现，管理开发员工',
  },
  {
    type: 'operations',
    label: '运营经理 (Operations Manager)',
    icon: TrendingUp,
    description: '监督业务运营、流程和效率，管理运营员工',
  },
  {
    type: 'maintenance',
    label: '运维经理 (Maintenance Manager)',
    icon: Wrench,
    description: '处理系统维护、更新和技术支持，管理运维员工',
  },
  {
    type: 'market_research',
    label: '市场调研经理 (Market Research Manager)',
    icon: Search,
    description: '进行市场分析、竞争对手研究和趋势识别，管理调研员工',
  },
  {
    type: 'design',
    label: '设计经理 (Design Manager)',
    icon: Palette,
    description: '管理 UI/UX 设计、品牌和视觉资产，管理设计员工',
  },
  {
    type: 'qa',
    label: 'QA 经理 (QA Manager)',
    icon: CheckCircle,
    description: '确保质量保证、测试和错误跟踪，管理 QA 员工',
  },
];

export default function CreateManagerDialog({
  open,
  onOpenChange,
  onCreateManager,
}: CreateManagerDialogProps) {
  const [selectedType, setSelectedType] = useState<ManagerType>('development');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

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
            创建经理 (Create Manager)
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            选择经理类型并配置他们在项目中的角色。经理将负责创建和管理员工。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Manager Type Selection */}
          <div className="space-y-3">
            <Label className="text-foreground font-semibold">经理类型 (Manager Type)</Label>
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
              Manager Name
            </Label>
            <Input
              id="manager-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Senior Development Manager"
              className="rounded-xl border-border"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="manager-description" className="text-foreground font-semibold">
              Description (Optional)
            </Label>
            <Textarea
              id="manager-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the manager's responsibilities and focus areas..."
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
                Create Manager
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                onClick={() => onOpenChange(false)}
                variant="outline"
                className="rounded-xl border-border font-medium"
              >
                Cancel
              </Button>
            </motion.div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
