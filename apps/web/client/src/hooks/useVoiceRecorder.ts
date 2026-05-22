import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "processing"
  | "error";

export interface UseVoiceRecorderReturn {
  isSupported: boolean;
  isRecording: boolean;
  status: VoiceRecorderStatus;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  setProcessing: (processing: boolean) => void;
}

function floatTo16BitPcm(value: number): number {
  const normalized = Math.max(-1, Math.min(1, value));
  return normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff;
}

function downsampleBuffer(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return input;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < output.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accumulator = 0;
    let count = 0;

    for (
      let index = offsetBuffer;
      index < nextOffsetBuffer && index < input.length;
      index += 1
    ) {
      accumulator += input[index] ?? 0;
      count += 1;
    }

    output[offsetResult] = count > 0 ? accumulator / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    view.setInt16(offset, floatTo16BitPcm(sample), true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.AudioContext &&
      !!navigator.mediaDevices?.getUserMedia,
  );

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sampleRateRef = useRef<number>(44100);
  const chunksRef = useRef<Float32Array[]>([]);

  const cleanup = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    const tracks = streamRef.current?.getTracks() ?? [];
    for (const track of tracks) {
      track.stop();
    }
    streamRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError("当前浏览器不支持语音录制");
      setStatus("error");
      return;
    }

    cleanup();
    setError(null);
    setStatus("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextCtor = window.AudioContext;
      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);

      sampleRateRef.current = context.sampleRate;
      chunksRef.current = [];

      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(channel));
      };

      source.connect(processor);
      processor.connect(context.destination);

      streamRef.current = stream;
      audioContextRef.current = context;
      sourceRef.current = source;
      processorRef.current = processor;
      setStatus("recording");
    } catch (recordingError) {
      cleanup();
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : "麦克风权限获取失败",
      );
      setStatus("error");
    }
  }, [cleanup, isSupported]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (status !== "recording") {
      return null;
    }

    setStatus("processing");
    const merged = mergeChunks(chunksRef.current);
    cleanup();

    if (merged.length === 0) {
      setError("没有录到有效语音");
      setStatus("error");
      return null;
    }

    const downsampled = downsampleBuffer(merged, sampleRateRef.current, 16000);
    const wavBlob = encodeWav(downsampled, 16000);
    setStatus("idle");
    return wavBlob;
  }, [cleanup, status]);

  const setProcessing = useCallback((processing: boolean) => {
    setStatus(processing ? "processing" : "idle");
  }, []);

  return {
    isSupported,
    isRecording: status === "recording",
    status,
    error,
    startRecording,
    stopRecording,
    setProcessing,
  };
}
