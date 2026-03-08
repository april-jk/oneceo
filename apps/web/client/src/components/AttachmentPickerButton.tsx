import { useId, useRef } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ATTACHMENT_ACCEPT } from "@/lib/task-attachments";

type AttachmentPickerButtonProps = {
  onSelectFiles: (files: File[]) => void;
  disabled?: boolean;
};

export default function AttachmentPickerButton({
  onSelectFiles,
  disabled = false,
}: AttachmentPickerButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

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
            onSelectFiles(files);
          }
          event.target.value = "";
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <Plus className="w-4 h-4 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Add attachment</p>
        </TooltipContent>
      </Tooltip>
    </>
  );
}
