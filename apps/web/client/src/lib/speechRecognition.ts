export interface SpeechResult {
  isFinal: boolean;
  transcript: string;
}

export interface ProcessedSpeechResults {
  latestFinal: string;
  interimText: string;
}

export function processSpeechResults(
  results: SpeechResult[],
): ProcessedSpeechResults {
  let latestFinal = "";
  let interimText = "";

  for (const result of results) {
    if (result.isFinal) {
      latestFinal = result.transcript;
    } else {
      interimText += result.transcript;
    }
  }

  return { latestFinal, interimText };
}

export function computeSpeechDelta(
  latestFinal: string,
  previousFinal: string,
): string {
  if (!latestFinal || latestFinal === previousFinal) {
    return "";
  }

  if (latestFinal.startsWith(previousFinal)) {
    return latestFinal.slice(previousFinal.length);
  }

  return latestFinal;
}
