import { useId, useMemo, useRef, useState } from "react";
import {
  Cloud,
  Download,
  FolderPlus,
  HardDriveUpload,
  Plus,
  Sparkles,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ATTACHMENT_ACCEPT, tagSkillAttachmentFile } from "@/lib/task-attachments";
import {
  fetchRemoteTaskAttachment,
  type RemoteAttachmentProvider,
} from "@/lib/task-creation-client";
import {
  SKILL_ATTACHMENT_TEMPLATES,
  type SkillAttachmentTemplate,
} from "@/lib/skill-attachment-templates";

type AttachmentPickerButtonProps = {
  onSelectFiles: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
};

const CLOUD_PROVIDER_ITEMS: Array<{
  provider: RemoteAttachmentProvider;
  label: string;
  description: string;
}> = [
  {
    provider: "google-drive",
    label: "Google Drive",
    description: "导入公开分享的 Drive 文件",
  },
  {
    provider: "onedrive",
    label: "OneDrive",
    description: "导入公开分享的 OneDrive 文件",
  },
  {
    provider: "website",
    label: "网站",
    description: "从网页链接直接下载文件",
  },
];

function buildSkillAttachment(template: SkillAttachmentTemplate): File {
  const file = new File([template.content], `skill-${template.id}.md`, {
    type: "text/markdown",
    lastModified: Date.now(),
  });
  return tagSkillAttachmentFile(file, {
    templateId: template.id,
    templateName: template.name,
    content: template.content,
  });
}

function getProviderLabel(provider: RemoteAttachmentProvider): string {
  return CLOUD_PROVIDER_ITEMS.find((item) => item.provider === provider)?.label || provider;
}

export default function AttachmentPickerButton({
  onSelectFiles,
  disabled = false,
}: AttachmentPickerButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogProvider, setDialogProvider] = useState<RemoteAttachmentProvider | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [isImportingRemote, setIsImportingRemote] = useState(false);

  const dialogCopy = useMemo(() => {
    if (!dialogProvider) return null;
    if (dialogProvider === "website") {
      return {
        title: "从网站添加文件",
        description: "输入可直接访问的文件地址，系统会先下载再作为附件加入当前对话。",
        placeholder: "https://example.com/files/spec.pdf",
      };
    }
    if (dialogProvider === "google-drive") {
      return {
        title: "从 Google Drive 添加",
        description: "输入公开分享的 Google Drive 文件链接，系统会转换成可下载地址。",
        placeholder: "https://drive.google.com/file/d/xxx/view?usp=sharing",
      };
    }
    return {
      title: "从 OneDrive 添加",
      description: "输入公开分享的 OneDrive 文件链接，系统会通过分享地址下载文件。",
      placeholder: "https://1drv.ms/u/s!example",
    };
  }, [dialogProvider]);

  const handleLocalSelect = async (files: File[]) => {
    await Promise.resolve(onSelectFiles(files));
  };

  const handleSkillImport = async (template: SkillAttachmentTemplate) => {
    try {
      setMenuOpen(false);
      await handleLocalSelect([buildSkillAttachment(template)]);
      toast.success(`已添加技能附件：${template.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "技能附件添加失败";
      toast.error(message);
    }
  };

  const handleRemoteImport = async () => {
    const trimmedUrl = remoteUrl.trim();
    if (!dialogProvider || !trimmedUrl) {
      toast.error("请输入文件链接");
      return;
    }
    setIsImportingRemote(true);
    try {
      const file = await fetchRemoteTaskAttachment({
        provider: dialogProvider,
        url: trimmedUrl,
      });
      await handleLocalSelect([file]);
      toast.success(`已从${getProviderLabel(dialogProvider)}添加 ${file.name}`);
      setDialogProvider(null);
      setRemoteUrl("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "远程文件添加失败";
      toast.error(message);
    } finally {
      setIsImportingRemote(false);
    }
  };

  return (
    <>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length > 0) {
            void handleLocalSelect(files).catch((error) => {
              const message = error instanceof Error ? error.message : "本地附件添加失败";
              toast.error(message);
            });
          }
          event.target.value = "";
        }}
      />

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
                disabled={disabled}
                aria-label="添加附件"
                data-testid="attachment-picker-trigger"
              >
                <Plus className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>添加附件</p>
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          align="start"
          className="w-64 rounded-2xl border-border/70 p-2 shadow-xl"
          data-testid="attachment-picker-menu"
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="rounded-xl px-3 py-2">
              <Cloud className="h-4 w-4" />
              <div className="flex min-w-0 flex-1 flex-col items-start">
                <span className="text-sm font-medium">从云端添加</span>
                <span className="text-xs text-muted-foreground">Drive、OneDrive、网站下载</span>
              </div>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72 rounded-2xl border-border/70 p-2 shadow-xl">
              {CLOUD_PROVIDER_ITEMS.map((item) => (
                <DropdownMenuItem
                  key={item.provider}
                  className="rounded-xl px-3 py-2"
                  onSelect={() => {
                    setMenuOpen(false);
                    setDialogProvider(item.provider);
                    setRemoteUrl("");
                  }}
                >
                  <Download className="h-4 w-4" />
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.description}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="rounded-xl px-3 py-2">
              <Sparkles className="h-4 w-4" />
              <div className="flex min-w-0 flex-1 flex-col items-start">
                <span className="text-sm font-medium">使用技能</span>
                <span className="text-xs text-muted-foreground">附加预设技能说明，指导后续执行</span>
              </div>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72 rounded-2xl border-border/70 p-2 shadow-xl">
              {SKILL_ATTACHMENT_TEMPLATES.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="rounded-xl px-3 py-2"
                  onSelect={() => {
                    void handleSkillImport(item);
                  }}
                >
                  <Wrench className="h-4 w-4" />
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.description}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem
            className="rounded-xl px-3 py-2"
            onSelect={() => {
              setMenuOpen(false);
              inputRef.current?.click();
            }}
          >
            <HardDriveUpload className="h-4 w-4" />
            <div className="flex min-w-0 flex-1 flex-col items-start">
              <span className="text-sm font-medium">从本地文件添加</span>
              <span className="text-xs text-muted-foreground">选择电脑上的文档、图片或代码文件</span>
            </div>
            <FolderPlus className="ml-2 h-4 w-4 text-muted-foreground" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={Boolean(dialogProvider)}
        onOpenChange={(open) => {
          if (open || isImportingRemote) return;
          setDialogProvider(null);
          setRemoteUrl("");
        }}
      >
        <DialogContent className="max-w-md rounded-3xl p-0" showCloseButton={!isImportingRemote}>
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle>{dialogCopy?.title || "添加远程文件"}</DialogTitle>
            <DialogDescription>{dialogCopy?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>文件链接</span>
              <Input
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
                placeholder={dialogCopy?.placeholder}
                autoFocus
                data-testid="remote-attachment-url-input"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isImportingRemote) {
                    event.preventDefault();
                    void handleRemoteImport();
                  }
                }}
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              支持公开可访问的分享链接。文件会先下载到浏览器，再按普通附件加入当前会话。
            </p>
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => {
                setDialogProvider(null);
                setRemoteUrl("");
              }}
              disabled={isImportingRemote}
            >
              取消
            </Button>
            <Button onClick={() => void handleRemoteImport()} disabled={isImportingRemote || !remoteUrl.trim()}>
              {isImportingRemote ? "导入中..." : "添加文件"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
