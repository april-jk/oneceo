import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, Plus, X } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';

interface CreateEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  managerId: string;
  managerName: string;
  onCreateEmployee: (data: {
    name: string;
    skills: string[];
    managerId: string;
  }) => void;
}

const commonSkills = [
  'React',
  'TypeScript',
  'Node.js',
  'Python',
  'API Design',
  'Database',
  'Testing',
  'DevOps',
  'UI/UX',
  'Data Analysis',
];

export default function CreateEmployeeDialog({
  open,
  onOpenChange,
  managerId,
  managerName,
  onCreateEmployee,
}: CreateEmployeeDialogProps) {
  const [name, setName] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [customSkill, setCustomSkill] = useState('');

  const handleAddSkill = (skill: string) => {
    if (!skills.includes(skill)) {
      setSkills([...skills, skill]);
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setSkills(skills.filter((s) => s !== skill));
  };

  const handleAddCustomSkill = () => {
    if (customSkill.trim() && !skills.includes(customSkill.trim())) {
      setSkills([...skills, customSkill.trim()]);
      setCustomSkill('');
    }
  };

  const handleCreate = () => {
    if (!name.trim() || skills.length === 0) return;

    onCreateEmployee({
      name: name.trim(),
      skills,
      managerId,
    });

    // Reset form
    setName('');
    setSkills([]);
    setCustomSkill('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            Create Employee
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a new AI agent employee for {managerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Employee Name */}
          <div className="space-y-2">
            <Label htmlFor="employee-name" className="text-foreground font-semibold">
              Employee Name
            </Label>
            <Input
              id="employee-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Frontend Developer Agent"
              className="rounded-xl border-border"
            />
          </div>

          {/* Skills */}
          <div className="space-y-3">
            <Label className="text-foreground font-semibold">Skills</Label>
            
            {/* Selected Skills */}
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <Badge
                    key={skill}
                    variant="secondary"
                    className="rounded-lg px-3 py-1 text-sm"
                  >
                    {skill}
                    <button
                      onClick={() => handleRemoveSkill(skill)}
                      className="ml-2 hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Common Skills */}
            <div className="flex flex-wrap gap-2">
              {commonSkills.map((skill) => (
                <motion.button
                  key={skill}
                  onClick={() => handleAddSkill(skill)}
                  disabled={skills.includes(skill)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`px-3 py-1 rounded-lg text-sm transition-all ${
                    skills.includes(skill)
                      ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                      : 'bg-card border border-border hover:border-foreground'
                  }`}
                >
                  {skill}
                </motion.button>
              ))}
            </div>

            {/* Custom Skill Input */}
            <div className="flex gap-2">
              <Input
                value={customSkill}
                onChange={(e) => setCustomSkill(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddCustomSkill()}
                placeholder="Add custom skill..."
                className="rounded-xl border-border"
              />
              <Button
                onClick={handleAddCustomSkill}
                variant="outline"
                className="rounded-xl border-border"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex-1">
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || skills.length === 0}
                className="w-full rounded-xl bg-foreground hover:bg-foreground/90 text-background font-medium"
              >
                <Bot className="w-4 h-4 mr-2" />
                Create Employee
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
