import * as React from "react";
import { GripVerticalIcon } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className
      )}
      {...props}
    />
  );
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      className={cn(
        "relative z-10 -mx-2 flex w-4 shrink-0 items-center justify-center border-0 bg-transparent shadow-none outline-none after:absolute after:inset-y-0 after:left-0 after:w-full after:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-hidden [&[data-resize-handle-active]>div]:opacity-100 [&[data-resize-handle-state=drag]>div]:opacity-100 [&[data-resize-handle-state=hover]>div]:opacity-100 data-[panel-group-direction=vertical]:mx-0 data-[panel-group-direction=vertical]:-my-2 data-[panel-group-direction=vertical]:h-4 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:inset-y-0 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center border-0 bg-transparent opacity-0 shadow-none">
          <GripVerticalIcon className="size-4 text-foreground/65" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
