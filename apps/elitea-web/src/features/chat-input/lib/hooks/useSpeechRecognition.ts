/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useSpeechRecognition.hooks.js` — the native browser
 * `window.SpeechRecognition`/`webkitSpeechRecognition` wrapper, the fallback
 * path when no backend ASR model is configured (see
 * `useSpeakingModeLoop.ts`'s `serverHook.isSupported ? serverHook :
 * clientHook` selection). Faithful port: isRecording/isSupported state, the
 * latest-callback-ref pattern for onTranscript/onError, startRecording/
 * stopRecording, the 'aborted' error swallow (stopRecording() calling
 * .abort() legitimately fires an 'aborted' error event browser-side; the old
 * app treats that as expected, not a real failure).
 *
 * The Web Speech API (`SpeechRecognition`) is not yet part of TypeScript's
 * bundled `lib.dom.d.ts` (still a draft spec) — the minimal shapes below are
 * hand-typed from the parts of the API this file actually touches, not a
 * full reproduction of the spec.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface TranscriptEvent {
  readonly final: string;
  readonly interim: string;
}

export interface UseSpeechRecognitionParams {
  readonly onTranscript?: (event: TranscriptEvent) => void;
  readonly onError?: (error: string) => void;
}

export interface UseSpeechRecognitionResult {
  readonly isRecording: boolean;
  readonly isSupported: boolean;
  readonly startRecording: () => void;
  readonly stopRecording: () => void;
}

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionInstance;
}

interface SpeechRecognitionWindow {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | undefined {
  const w = window as unknown as SpeechRecognitionWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function useSpeechRecognition(params: UseSpeechRecognitionParams = {}): UseSpeechRecognitionResult {
  const { onTranscript, onError } = params;
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    setIsSupported(getSpeechRecognitionConstructor() !== undefined);
  }, []);

  const handleResult = useCallback((event: SpeechRecognitionEventLike) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      const transcript = result[0]?.transcript ?? '';
      if (result.isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    onTranscriptRef.current?.({ final: finalTranscript, interim: interimTranscript });
  }, []);

  const handleError = useCallback((event: SpeechRecognitionErrorEventLike) => {
    setIsRecording(false);
    recognitionRef.current = null;
    // Ignore aborted sessions (triggered by stopRecording).
    if (event.error === 'aborted') return;
    onErrorRef.current?.(event.error);
  }, []);

  const handleEnd = useCallback(() => {
    setIsRecording(false);
    recognitionRef.current = null;
  }, []);

  const startRecording = useCallback(() => {
    const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionCtor) return;

    // Abort any existing session before starting a new one.
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = handleResult;
    recognition.onerror = handleError;
    recognition.onend = handleEnd;

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, [handleResult, handleError, handleEnd]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Abort on unmount to avoid dangling event listeners.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  return { isRecording, isSupported, startRecording, stopRecording };
}
