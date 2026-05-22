import { Loader2, Mic } from "lucide-react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useStreamingSpeechRecognition } from "@/hooks/useStreamingSpeechRecognition";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { transcribeTaskCreationVoiceInput } from "@/lib/task-creation-client";

type VoiceInputButtonProps = {
  disabled?: boolean;
  onRecordingStart?: () => void;
  onPreviewTranscript?: (text: string) => void;
  onResolvedTranscript: (text: string) => void;
};

export default function VoiceInputButton({
  disabled = false,
  onRecordingStart,
  onPreviewTranscript,
  onResolvedTranscript,
}: VoiceInputButtonProps) {
  const recorder = useVoiceRecorder();
  const browserTranscriptRef = useRef("");
  const browserInterimTranscriptRef = useRef("");
  const streamingTranscriptRef = useRef("");
  const streamingInterimTranscriptRef = useRef("");

  const getTranscript = useCallback((finalText: string, interimText: string) => {
    return [finalText, interimText]
      .map((item) => item.trim())
      .filter(Boolean)
      .join(" ");
  }, []);

  const getBrowserTranscript = useCallback(() => {
    return getTranscript(
      browserTranscriptRef.current,
      browserInterimTranscriptRef.current,
    );
  }, [getTranscript]);

  const getStreamingTranscript = useCallback(() => {
    return getTranscript(
      streamingTranscriptRef.current,
      streamingInterimTranscriptRef.current,
    );
  }, [getTranscript]);

  const getPreferredTranscript = useCallback(() => {
    return getBrowserTranscript() || getStreamingTranscript();
  }, [getBrowserTranscript, getStreamingTranscript]);

  const publishBrowserTranscript = useCallback(
    () => {
      onPreviewTranscript?.(getPreferredTranscript());
    },
    [getPreferredTranscript, onPreviewTranscript],
  );

  const browserSpeechRecognition = useSpeechRecognition({
    lang: "zh-CN",
    onInterimResult: (interimText) => {
      browserInterimTranscriptRef.current = interimText.trim();
      publishBrowserTranscript();
    },
    onResult: (finalChunk) => {
      const nextChunk = finalChunk.trim();
      if (!nextChunk) return;
      browserInterimTranscriptRef.current = "";
      browserTranscriptRef.current = getTranscript(
        browserTranscriptRef.current,
        nextChunk,
      );
      publishBrowserTranscript();
    },
  });

  const speechRecognition = useStreamingSpeechRecognition({
    onInterimResult: (interimText) => {
      streamingInterimTranscriptRef.current = interimText.trim();
      if (!browserSpeechRecognition.isSupported) {
        publishBrowserTranscript();
      }
    },
    onResult: (finalChunk) => {
      const nextChunk = finalChunk.trim();
      if (!nextChunk) return;
      streamingInterimTranscriptRef.current = "";
      streamingTranscriptRef.current = getTranscript(
        streamingTranscriptRef.current,
        nextChunk,
      );
      if (!browserSpeechRecognition.isSupported) {
        publishBrowserTranscript();
      }
    },
  });

  const handleClick = useCallback(async () => {
    if (!recorder.isSupported) {
      toast.error("当前浏览器不支持语音录制");
      return;
    }

    if (recorder.status === "processing") {
      return;
    }

    if (!recorder.isRecording) {
      browserTranscriptRef.current = "";
      browserInterimTranscriptRef.current = "";
      streamingTranscriptRef.current = "";
      streamingInterimTranscriptRef.current = "";
      onRecordingStart?.();
      try {
        if (browserSpeechRecognition.isSupported) {
          browserSpeechRecognition.startListening();
        }
        await speechRecognition.startListening();
        await recorder.startRecording({
          onPcmChunk: speechRecognition.sendAudioChunk,
        });
      } catch (error) {
        browserSpeechRecognition.stopListening();
        await speechRecognition.stopListening();
        toast.error(error instanceof Error ? error.message : "语音识别启动失败");
      }
      return;
    }

    const audio = await recorder.stopRecording();
    browserSpeechRecognition.stopListening();
    const streamingTranscript = await speechRecognition.stopListening();
    if (streamingTranscript) {
      streamingInterimTranscriptRef.current = "";
      streamingTranscriptRef.current = streamingTranscript.trim();
      if (!browserSpeechRecognition.isSupported) {
        publishBrowserTranscript();
      }
    }
    if (!audio) {
      return;
    }

    recorder.setProcessing(true);
    try {
      const browserTranscript = getPreferredTranscript();
      const transcript = await transcribeTaskCreationVoiceInput(audio, {
        clientTranscript: browserTranscript,
      });
      if (!transcript.text.trim()) {
        throw new Error("语音识别结果为空");
      }
      await onResolvedTranscript(transcript.text);
      toast.success("语音已转成任务输入");
    } catch (error) {
      const fallbackTranscript = getPreferredTranscript();
      if (fallbackTranscript) {
        await onResolvedTranscript(fallbackTranscript);
        toast.success("语音已转成任务输入");
        return;
      }
      toast.error(error instanceof Error ? error.message : "语音识别失败");
    } finally {
      recorder.setProcessing(false);
    }
  }, [
    onRecordingStart,
    onResolvedTranscript,
    getPreferredTranscript,
    getTranscript,
    browserSpeechRecognition,
    recorder,
    speechRecognition,
  ]);

  const isProcessing = recorder.status === "processing";
  const isRecording = recorder.isRecording;
  const isReceivingSpeech =
    speechRecognition.status === "receiving" ||
    browserSpeechRecognition.status === "receiving";

  const title = !recorder.isSupported
    ? "当前浏览器不支持语音录制"
    : isRecording
      ? "结束录音并识别"
      : recorder.status === "processing"
        ? "正在整理语音文本"
        : "开始语音输入";

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
          <Mic
            className={`relative z-10 h-4 w-4 ${
              isReceivingSpeech ? "animate-pulse" : ""
            }`}
          />
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
