import { useCallback, useEffect, useRef, useState } from "react";
import { computeSpeechDelta } from "@/lib/speechRecognition";

type StreamingSpeechStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "receiving"
  | "error";

type StreamingSpeechOptions = {
  onInterimResult?: (text: string) => void;
  onResult?: (text: string) => void;
  onError?: (message: string) => void;
};

type PendingStop = {
  resolve: (text: string) => void;
  timer: ReturnType<typeof setTimeout>;
};

function createFrame(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
  payload: Uint8Array,
): Uint8Array {
  const frame = new Uint8Array(8 + payload.length);
  frame[0] = 0x11;
  frame[1] = ((messageType & 0x0f) << 4) | (flags & 0x0f);
  frame[2] = ((serialization & 0x0f) << 4) | (compression & 0x0f);
  frame[3] = 0x00;
  new DataView(frame.buffer).setUint32(4, payload.length, false);
  frame.set(payload, 8);
  return frame;
}

function getVoiceAsrWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/task-creation/voice/asr`;
}

function buildInitFrame(): Uint8Array {
  const payload = {
    user: { uid: `oneceo-voice-${Date.now()}` },
    audio: {
      format: "pcm",
      codec: "raw",
      rate: 16000,
      bits: 16,
      channel: 1,
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      show_utterances: true,
      enable_nonstream: true,
    },
  };
  return createFrame(
    0x01,
    0x00,
    0x01,
    0x00,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
}

function decodeServerFrame(data: ArrayBuffer): {
  text: string;
  final: boolean;
  error?: string;
} | null {
  const bytes = new Uint8Array(data);
  if (bytes.length < 8) return null;

  const byte0 = bytes[0] ?? 0;
  const byte1 = bytes[1] ?? 0;
  const byte2 = bytes[2] ?? 0;
  const headerSize = (byte0 & 0x0f) * 4;
  const messageType = byte1 >> 4;
  const flags = byte1 & 0x0f;
  const compression = byte2 & 0x0f;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (messageType === 0x0f) {
    const errorSize = view.getUint32(headerSize + 4, false);
    const errorBytes = bytes.slice(headerSize + 8, headerSize + 8 + errorSize);
    return {
      text: "",
      final: false,
      error: new TextDecoder().decode(errorBytes),
    };
  }

  if (messageType !== 0x09 || bytes.length < headerSize + 8) {
    return null;
  }

  const sequence = view.getInt32(headerSize, false);
  const payloadSize = view.getUint32(headerSize + 4, false);
  const payloadBytes = bytes.slice(headerSize + 8, headerSize + 8 + payloadSize);
  if (compression !== 0x00) {
    return null;
  }

  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
    result?: {
      text?: string;
      utterances?: Array<{ definite?: boolean; text?: string }>;
    };
  };
  const text = payload.result?.text?.trim() ?? "";
  const hasDefiniteUtterance =
    payload.result?.utterances?.some((utterance) => utterance.definite) ??
    false;
  return {
    text,
    final: flags === 0x03 || sequence < 0 || hasDefiniteUtterance,
  };
}

export function useStreamingSpeechRecognition(
  options: StreamingSpeechOptions = {},
) {
  const { onInterimResult, onResult, onError } = options;
  const [status, setStatus] = useState<StreamingSpeechStatus>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const lastServerFinalRef = useRef("");
  const pendingStopRef = useRef<PendingStop | null>(null);
  const onInterimResultRef = useRef(onInterimResult);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onInterimResultRef.current = onInterimResult;
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  }, [onInterimResult, onResult, onError]);

  const getTranscript = useCallback(() => {
    return [finalTranscriptRef.current, interimTranscriptRef.current]
      .map((item) => item.trim())
      .filter(Boolean)
      .join(" ");
  }, []);

  const resolvePendingStop = useCallback(() => {
    const pending = pendingStopRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingStopRef.current = null;
    pending.resolve(getTranscript());
  }, [getTranscript]);

  const closeSocket = useCallback(() => {
    try {
      wsRef.current?.close();
    } catch {
      // Ignore close races; the UI has its own state recovery.
    }
    wsRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    closeSocket();
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    lastServerFinalRef.current = "";
    setStatus("connecting");

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(getVoiceAsrWebSocketUrl());
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      const timeout = window.setTimeout(() => {
        reject(new Error("语音识别连接超时"));
        closeSocket();
      }, 8000);

      ws.onopen = () => {
        window.clearTimeout(timeout);
        ws.send(buildInitFrame());
        setStatus("listening");
        resolve();
      };

      ws.onerror = () => {
        window.clearTimeout(timeout);
        setStatus("error");
        reject(new Error("语音识别连接失败"));
      };

      ws.onmessage = (event) => {
        try {
          const parsed = decodeServerFrame(event.data as ArrayBuffer);
          if (!parsed) return;
          if (parsed.error) {
            setStatus("error");
            onErrorRef.current?.("语音识别暂时不可用");
            return;
          }
          if (!parsed.text) return;
          setStatus("receiving");
          if (parsed.final) {
            const nextFinal = parsed.text.trim();
            const delta = computeSpeechDelta(
              nextFinal,
              lastServerFinalRef.current,
            );
            lastServerFinalRef.current = nextFinal;
            interimTranscriptRef.current = "";
            if (delta) {
              finalTranscriptRef.current = [
                finalTranscriptRef.current,
                delta,
              ]
                .map((item) => item.trim())
                .filter(Boolean)
                .join(" ");
              onResultRef.current?.(delta);
            }
            resolvePendingStop();
            return;
          }
          interimTranscriptRef.current = parsed.text;
          onInterimResultRef.current?.(parsed.text);
        } catch {
          // Keep the stream alive; a malformed partial frame should not break recording.
        }
      };

      ws.onclose = () => {
        setStatus("idle");
        resolvePendingStop();
      };
    });
  }, [closeSocket, resolvePendingStop]);

  const sendAudioChunk = useCallback((chunk: Uint8Array) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || chunk.length === 0) {
      return;
    }
    ws.send(createFrame(0x02, 0x00, 0x00, 0x00, chunk));
  }, []);

  const stopListening = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      resolvePendingStop();
      return getTranscript();
    }

    ws.send(createFrame(0x02, 0x02, 0x00, 0x00, new Uint8Array(0)));
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        resolvePendingStop();
        closeSocket();
        resolve(getTranscript());
      }, 2500);
      pendingStopRef.current = { resolve, timer };
    });
  }, [closeSocket, getTranscript, resolvePendingStop]);

  useEffect(() => {
    return () => {
      resolvePendingStop();
      closeSocket();
    };
  }, [closeSocket, resolvePendingStop]);

  return {
    status,
    getTranscript,
    startListening,
    sendAudioChunk,
    stopListening,
  };
}
