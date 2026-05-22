import { Loader2, Mic } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { transcribeTaskCreationVoiceInput } from "@/lib/task-creation-client";

type VoiceInputButtonProps = {
  disabled?: boolean;
  onResolvedTranscript: (text: string) => Promise<void> | void;
};

export default function VoiceInputButton({
  disabled = false,
  onResolvedTranscript,
}: VoiceInputButtonProps) {
  const recorder = useVoiceRecorder();

  const handleClick = useCallback(async () => {
    if (!recorder.isSupported) {
      toast.error("当前浏览器不支持语音录制");
      return;
    }

    if (recorder.status === "processing") {
      return;
    }

    if (!recorder.isRecording) {
      await recorder.startRecording();
      return;
    }

    const audio = await recorder.stopRecording();
    if (!audio) {
      return;
    }

    recorder.setProcessing(true);
    try {
      const transcript = await transcribeTaskCreationVoiceInput(audio);
      if (!transcript.text.trim()) {
        throw new Error("语音识别结果为空");
      }
      await onResolvedTranscript(transcript.text);
      toast.success("语音已转成任务输入");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "语音识别失败",
      );
    } finally {
      recorder.setProcessing(false);
    }
  }, [onResolvedTranscript, recorder]);

  const title = !recorder.isSupported
    ? "当前浏览器不支持语音录制"
    : recorder.isRecording
      ? "结束录音并发送"
      : recorder.status === "processing"
        ? "正在识别语音"
        : "开始语音输入";

  const isProcessing = recorder.status === "processing";
  const isRecording = recorder.isRecording;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => {
        void handleClick();
      }}
      disabled={disabled || recorder.status === "requesting"}
      className={`relative h-9 w-9 rounded-full transition-all hover:bg-accent ${
        isRecording
          ? "bg-red-50 text-red-600 shadow-[0_0_0_4px_rgba(220,38,38,0.12)] hover:bg-red-100"
          : ""
      } ${isProcessing ? "text-primary" : ""}`}
      title={title}
      aria-label={title}
    >
      {isRecording ? (
        <>
          <span className="absolute inset-0 rounded-full border border-red-300 animate-ping" />
          <span className="absolute inset-[3px] rounded-full bg-red-100/80" />
          <Mic className="relative z-10 h-4 w-4 animate-pulse" />
        </>
      ) : isProcessing ? (
        <>
          <Mic className="h-4 w-4 opacity-30" />
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background">
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        </>
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
