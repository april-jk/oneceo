import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { ChevronDown, ChevronRight, MoreVertical, Palette, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface TreeNode {
  id: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  children: TreeNode[];
  expanded: boolean;
}

interface DraggableTreeProps {
  nodes: TreeNode[];
  onNodesChange: (nodes: TreeNode[]) => void;
}

const ICON_OPTIONS = ['📁', '📋', '🎯', '✅', '🔧', '💡', '📊', '🚀', '🎨', '⚙️', '🔐', '📝'];
const COLOR_OPTIONS = [
  { name: 'Gray', value: 'bg-gray-100 text-gray-700' },
  { name: 'Blue', value: 'bg-blue-100 text-blue-700' },
  { name: 'Green', value: 'bg-green-100 text-green-700' },
  { name: 'Red', value: 'bg-red-100 text-red-700' },
  { name: 'Yellow', value: 'bg-yellow-100 text-yellow-700' },
  { name: 'Purple', value: 'bg-purple-100 text-purple-700' },
  { name: 'Pink', value: 'bg-pink-100 text-pink-700' },
  { name: 'Indigo', value: 'bg-indigo-100 text-indigo-700' },
];

const reorderNodes = (nodes: TreeNode[], source: any, destination: any): TreeNode[] => {
  if (!destination) return nodes;

  const newNodes = JSON.parse(JSON.stringify(nodes));
  const sourceParent = findNodeById(newNodes, source.droppableId);
  const destParent = findNodeById(newNodes, destination.droppableId);

  if (!sourceParent || !destParent) return nodes;

  const [removed] = sourceParent.children.splice(source.index, 1);
  destParent.children.splice(destination.index, 0, removed);

  return newNodes;
};

const findNodeById = (nodes: TreeNode[], id: string): TreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
};

const updateNodeInTree = (nodes: TreeNode[], nodeId: string, updates: Partial<TreeNode>): TreeNode[] => {
  return nodes.map(node => {
    if (node.id === nodeId) {
      return { ...node, ...updates };
    }
    return {
      ...node,
      children: updateNodeInTree(node.children, nodeId, updates),
    };
  });
};

export default function DraggableTree({ nodes, onNodesChange }: DraggableTreeProps) {
  const [editingNode, setEditingNode] = useState<TreeNode | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({ icon: '', color: '' });

  const handleDragEnd = (result: DropResult) => {
    const { source, destination } = result;

    if (!destination) return;

    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    const newNodes = reorderNodes(nodes, source, destination);
    onNodesChange(newNodes);
  };

  const toggleNodeExpanded = (nodeId: string) => {
    const newNodes = updateNodeInTree(nodes, nodeId, {
      expanded: !findNodeById(nodes, nodeId)?.expanded,
    });
    onNodesChange(newNodes);
  };

  const handleEditNode = (node: TreeNode) => {
    setEditingNode(node);
    setEditForm({
      icon: node.icon || '📁',
      color: node.color || 'bg-gray-100 text-gray-700',
    });
    setIsEditDialogOpen(true);
  };

  const handleSaveNodeEdit = () => {
    if (editingNode) {
      const newNodes = updateNodeInTree(nodes, editingNode.id, {
        icon: editForm.icon,
        color: editForm.color,
      });
      onNodesChange(newNodes);
      setIsEditDialogOpen(false);
      setEditingNode(null);
    }
  };

  const renderTreeNode = (node: TreeNode, index: number, parentId: string) => {
    return (
      <Draggable key={node.id} draggableId={node.id} index={index}>
        {(provided, snapshot) => (
          <motion.div
            ref={provided.innerRef}
            {...provided.draggableProps}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2 }}
            className={`mb-2 transition-all ${
              snapshot.isDragging
                ? 'opacity-60 scale-98 shadow-lg'
                : ''
            }`}
          >
            <div className="flex items-start gap-1.5">
              <div className="flex-shrink-0 flex items-center gap-0.5 mt-1">
                {node.children.length > 0 ? (
                  <button
                    onClick={() => toggleNodeExpanded(node.id)}
                    className="p-1 hover:bg-secondary rounded-lg transition-colors duration-200"
                  >
                    {node.expanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                ) : (
                  <div className="w-6" />
                )}
                <div
                  {...provided.dragHandleProps}
                  className="p-1 cursor-grab active:cursor-grabbing rounded-lg hover:bg-secondary transition-colors duration-200"
                  title="Drag to reorder"
                >
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <Card className="border-border rounded-xl overflow-hidden hover:shadow-sm transition-shadow group">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <motion.div
                          whileHover={{ scale: 1.1 }}
                          className={`text-lg flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 ${
                            node.color || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {node.icon || '📁'}
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{node.name}</p>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{node.description}</p>
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <motion.div
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                            >
                              <MoreVertical className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          </motion.div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl">
                          <DropdownMenuItem
                            onClick={() => handleEditNode(node)}
                            className="rounded-lg cursor-pointer"
                          >
                            <Palette className="w-4 h-4 mr-2" />
                            Customize
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Child Nodes */}
            <AnimatePresence>
              {node.expanded && node.children.length > 0 && (
                <Droppable droppableId={node.id} type={`level-${node.id}`}>
                  {(provided, snapshot) => (
                    <motion.div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`ml-6 mt-2 space-y-2 rounded-lg transition-all duration-200 ${
                        snapshot.isDraggingOver
                          ? 'bg-secondary/50 p-2 ring-1 ring-border'
                          : 'p-0'
                      }`}
                    >
                      {node.children.map((child, childIndex) =>
                        renderTreeNode(child, childIndex, node.id)
                      )}
                      {provided.placeholder}
                    </motion.div>
                  )}
                </Droppable>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </Draggable>
    );
  };

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="root" type="level-root">
          {(provided, snapshot) => (
            <motion.div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`space-y-2 rounded-lg transition-all duration-200 ${
                snapshot.isDraggingOver
                  ? 'bg-secondary/30 p-4 ring-1 ring-border'
                  : 'p-0'
              }`}
            >
              <AnimatePresence>
                {nodes.map((node, index) => renderTreeNode(node, index, 'root'))}
              </AnimatePresence>
              {provided.placeholder}
            </motion.div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Edit Node Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Customize Node</DialogTitle>
            <DialogDescription>
              Change the icon and color of this node
            </DialogDescription>
          </DialogHeader>

          {editingNode && (
              <div className="space-y-4">
              <div className="space-y-3">
                <Label className="text-foreground font-semibold">Icon</Label>
                <div className="grid grid-cols-6 gap-2">
                  {ICON_OPTIONS.map((icon) => (
                    <motion.button
                      key={icon}
                      onClick={() => setEditForm({ ...editForm, icon })}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`p-3 rounded-xl text-2xl transition-all duration-200 ${
                        editForm.icon === icon
                          ? 'bg-foreground text-background ring-2 ring-foreground shadow-md'
                          : 'bg-secondary hover:bg-accent'
                      }`}
                    >
                      {icon}
                    </motion.button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-foreground font-semibold">Color</Label>
                <div className="grid grid-cols-4 gap-2">
                  {COLOR_OPTIONS.map((option) => (
                    <motion.button
                      key={option.value}
                      onClick={() => setEditForm({ ...editForm, color: option.value })}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`p-3 rounded-xl text-sm font-medium transition-all duration-200 ${option.value} ${
                        editForm.color === option.value
                          ? 'ring-2 ring-foreground shadow-md'
                          : 'hover:opacity-80'
                      }`}
                    >
                      {option.name}
                    </motion.button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex-1">
                  <Button
                    onClick={handleSaveNodeEdit}
                    className="w-full rounded-xl bg-foreground hover:bg-foreground/90 text-background font-medium"
                  >
                    Save Changes
                  </Button>
                </motion.div>
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex-1">
                  <Button
                    onClick={() => setIsEditDialogOpen(false)}
                    variant="outline"
                    className="w-full rounded-xl border-border font-medium"
                  >
                    Cancel
                  </Button>
                </motion.div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
