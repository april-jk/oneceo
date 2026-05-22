import { Loader2, Mic } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useStreamingSpeechRecognition } from "@/hooks/useStreamingSpeechRecognition";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import {
  DEFAULT_VOICE_RECOGNITION_PROVIDER,
  readVoiceRecognitionProvider,
  type VoiceRecognitionProvider,
} from "@/lib/altus-settings";
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
  const [voiceRecognitionProvider, setVoiceRecognitionProvider] =
    useState<VoiceRecognitionProvider>(DEFAULT_VOICE_RECOGNITION_PROVIDER);
  const [isBrowserProcessing, setIsBrowserProcessing] = useState(false);
  const browserTranscriptRef = useRef("");
  const browserInterimTranscriptRef = useRef("");
  const streamingTranscriptRef = useRef("");
  const streamingInterimTranscriptRef = useRef("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncProvider = () => {
      setVoiceRecognitionProvider(readVoiceRecognitionProvider());
    };

    syncProvider();
    window.addEventListener("storage", syncProvider);
    window.addEventListener("altus-settings-changed", syncProvider);
    return () => {
      window.removeEventListener("storage", syncProvider);
      window.removeEventListener("altus-settings-changed", syncProvider);
    };
  }, []);

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

  const isBrowserMode = voiceRecognitionProvider === "browser";
  const isVolcengineMode = voiceRecognitionProvider === "volcengine";

  const publishBrowserTranscript = useCallback(
    () => {
      onPreviewTranscript?.(
        isBrowserMode ? getBrowserTranscript() : getStreamingTranscript(),
      );
    },
    [
      getBrowserTranscript,
      getStreamingTranscript,
      isBrowserMode,
      onPreviewTranscript,
    ],
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
      if (isBrowserMode) {
        publishBrowserTranscript();
      }
    },
  });

  const speechRecognition = useStreamingSpeechRecognition({
    onInterimResult: (interimText) => {
      streamingInterimTranscriptRef.current = interimText.trim();
      if (isVolcengineMode) {
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
      if (isVolcengineMode) {
        publishBrowserTranscript();
      }
    },
  });

  const handleClick = useCallback(async () => {
    if (isBrowserMode) {
      try {
        if (!browserSpeechRecognition.isSupported) {
          throw new Error("当前浏览器不支持原生语音识别，请在设置中切换到火山语音识别");
        }

        if (!browserSpeechRecognition.isListening) {
          browserTranscriptRef.current = "";
          browserInterimTranscriptRef.current = "";
          streamingTranscriptRef.current = "";
          streamingInterimTranscriptRef.current = "";
          onRecordingStart?.();
          browserSpeechRecognition.startListening();
          return;
        }

        setIsBrowserProcessing(true);
        browserSpeechRecognition.stopListening();
        const transcript = getBrowserTranscript();
        if (!transcript.trim()) {
          throw new Error("未识别到有效语音内容");
        }
        await onResolvedTranscript(transcript);
        toast.success("语音已转成任务输入");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "浏览器语音识别失败",
        );
      } finally {
        setIsBrowserProcessing(false);
      }
      return;
    }

    if (!recorder.isSupported) {
      toast.error("当前浏览器不支持语音录制");
      return;
    }

    if (recorder.status === "processing") {
      return;
    }

    try {
      if (!recorder.isRecording) {
        browserTranscriptRef.current = "";
        browserInterimTranscriptRef.current = "";
        streamingTranscriptRef.current = "";
        streamingInterimTranscriptRef.current = "";
        onRecordingStart?.();
        await speechRecognition.startListening();
        await recorder.startRecording({
          onPcmChunk: speechRecognition.sendAudioChunk,
        });
        return;
      }

      const audio = await recorder.stopRecording();
      const streamingTranscript = await speechRecognition.stopListening();
      if (streamingTranscript) {
        streamingInterimTranscriptRef.current = "";
        streamingTranscriptRef.current = streamingTranscript.trim();
        publishBrowserTranscript();
      }
      if (!audio) {
        return;
      }

      recorder.setProcessing(true);
      const transcript = await transcribeTaskCreationVoiceInput(audio, {
        clientTranscript: getStreamingTranscript(),
      });
      if (!transcript.text.trim()) {
        throw new Error("语音识别结果为空");
      }
      await onResolvedTranscript(transcript.text);
      toast.success("语音已转成任务输入");
    } catch (error) {
      const fallbackTranscript = getStreamingTranscript();
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
    getBrowserTranscript,
    getStreamingTranscript,
    onRecordingStart,
    onResolvedTranscript,
    getTranscript,
    browserSpeechRecognition,
    isBrowserMode,
    isVolcengineMode,
    publishBrowserTranscript,
    recorder,
    speechRecognition,
  ]);

  const isProcessing = isBrowserMode
    ? isBrowserProcessing
    : recorder.status === "processing";
  const isRecording = isBrowserMode
    ? browserSpeechRecognition.isListening
    : recorder.isRecording;
  const isReceivingSpeech = isBrowserMode
    ? browserSpeechRecognition.status === "receiving"
    : speechRecognition.status === "receiving";

  const title = useMemo(() => {
    if (isBrowserMode) {
      if (!browserSpeechRecognition.isSupported) {
        return "当前浏览器不支持原生语音识别";
      }
      if (isRecording) {
        return "结束录音";
      }
      if (isProcessing) {
        return "正在识别语音";
      }
      return "开始语音输入（浏览器）";
    }

    if (!recorder.isSupported) {
      return "当前浏览器不支持语音录制";
    }
    if (isRecording) {
      return "结束录音";
    }
    if (recorder.status === "processing") {
      return "正在整理语音文本";
    }
    return "开始语音输入（火山）";
  }, [
    browserSpeechRecognition.isSupported,
    isBrowserMode,
    isProcessing,
    isRecording,
    recorder.isSupported,
    recorder.status,
  ]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => {
        void handleClick();
      }}
      disabled={
        disabled ||
        isProcessing ||
        recorder.status === "requesting" ||
        browserSpeechRecognition.status === "starting"
      }
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
