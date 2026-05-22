import { useCallback, useEffect, useRef, useState } from "react";
import { computeSpeechDelta } from "@/lib/speechRecognition";

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error:
    | "no-speech"
    | "aborted"
    | "audio-capture"
    | "network"
    | "not-allowed"
    | "service-not-allowed"
    | "bad-grammar"
    | "language-not-supported";
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
    | null;
  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void)
    | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export type SpeechRecognitionStatus =
  | "idle"
  | "starting"
  | "listening"
  | "receiving"
  | "error";

export interface UseSpeechRecognitionOptions {
  lang?: string;
  onResult?: (transcript: string) => void;
  onInterimResult?: (transcript: string) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

export interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  status: SpeechRecognitionStatus;
  interimTranscript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionReturn {
  const { lang, onResult, onInterimResult, onEnd, onError } = options;
  const [isSupported] = useState(() => !!getSpeechRecognition());
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<SpeechRecognitionStatus>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isStoppingRef = useRef(false);
  const receivingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastFinalTranscriptRef = useRef("");

  const onResultRef = useRef(onResult);
  const onInterimResultRef = useRef(onInterimResult);
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onResultRef.current = onResult;
    onInterimResultRef.current = onInterimResult;
    onEndRef.current = onEnd;
    onErrorRef.current = onError;
  }, [onResult, onInterimResult, onEnd, onError]);

  useEffect(() => {
    return () => {
      if (receivingTimeoutRef.current) {
        clearTimeout(receivingTimeoutRef.current);
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognitionAPI = getSpeechRecognition();
    if (!SpeechRecognitionAPI) {
      setError("Speech recognition not supported");
      setStatus("error");
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }
    if (receivingTimeoutRef.current) {
      clearTimeout(receivingTimeoutRef.current);
      receivingTimeoutRef.current = null;
    }

    setError(null);
    setInterimTranscript("");
    setStatus("starting");
    isStoppingRef.current = false;
    lastFinalTranscriptRef.current = "";

    const recognition = new SpeechRecognitionAPI();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    if (lang) {
      recognition.lang = lang;
    }

    recognition.onstart = () => {
      setIsListening(true);
      setStatus("listening");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (isStoppingRef.current) {
        return;
      }

      setStatus("receiving");
      if (receivingTimeoutRef.current) {
        clearTimeout(receivingTimeoutRef.current);
      }
      receivingTimeoutRef.current = setTimeout(() => {
        setStatus("listening");
        receivingTimeoutRef.current = null;
      }, 1500);

      let interimText = "";
      let latestFinal = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) {
          latestFinal = transcript;
        } else {
          interimText += transcript;
        }
      }

      if (interimText) {
        setInterimTranscript(interimText);
        onInterimResultRef.current?.(interimText);
      }

      if (latestFinal) {
        const delta = computeSpeechDelta(
          latestFinal,
          lastFinalTranscriptRef.current,
        );
        lastFinalTranscriptRef.current = latestFinal;
        setInterimTranscript("");
        if (delta.trim()) {
          onResultRef.current?.(delta);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "aborted") {
        return;
      }
      const message = event.message || event.error;
      setError(message);
      setStatus("error");
      onErrorRef.current?.(message);
    };

    recognition.onend = () => {
      setIsListening(false);
      setStatus("idle");
      setInterimTranscript("");
      onEndRef.current?.();
    };

    try {
      recognition.start();
    } catch (startError) {
      const message =
        startError instanceof Error ? startError.message : "语音识别启动失败";
      setError(message);
      setStatus("error");
      onErrorRef.current?.(message);
    }
  }, [lang]);

  const stopListening = useCallback(() => {
    isStoppingRef.current = true;
    if (receivingTimeoutRef.current) {
      clearTimeout(receivingTimeoutRef.current);
      receivingTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setStatus("idle");
    setInterimTranscript("");
  }, []);

  return {
    isSupported,
    isListening,
    status,
    interimTranscript,
    error,
    startListening,
    stopListening,
  };
}
