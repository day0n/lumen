'use client';

import { useEffect, useRef, useState } from 'react';

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
  resultIndex: number;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

export interface UseSpeechToTextOptions {
  language: string;
  errors: {
    micPermission: string;
    noSpeech: string;
    speechFailed: string;
  };
  onTranscript: (chunk: string) => void;
}

export function useSpeechToText(options: UseSpeechToTextOptions) {
  const { errors, language, onTranscript } = options;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(onTranscript);
  const errorsRef = useRef(errors);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  callbackRef.current = onTranscript;
  errorsRef.current = errors;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const Ctor =
      (
        window as unknown as {
          SpeechRecognition?: SpeechRecognitionConstructor;
          webkitSpeechRecognition?: SpeechRecognitionConstructor;
        }
      ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor })
        .webkitSpeechRecognition;

    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = language;

    recognition.onresult = (event) => {
      const results = Array.from(event.results as ArrayLike<{ 0: { transcript: string } }>);
      const transcript = results
        .map((result) => result[0]?.transcript ?? '')
        .join('')
        .trim();
      if (transcript) callbackRef.current(transcript);
    };
    recognition.onerror = (event) => {
      const code = event.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError(errorsRef.current.micPermission);
      } else if (code === 'no-speech') {
        setError(errorsRef.current.noSpeech);
      } else if (code === 'aborted') {
        setError(null);
      } else {
        setError(errorsRef.current.speechFailed);
      }
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, [language]);

  const start = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    setError(null);
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if already running
    }
  };

  const stop = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // already stopped
    }
  };

  const cancel = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.abort();
    } catch {
      // ignore
    }
    setListening(false);
    setError(null);
  };

  const toggle = () => {
    if (listening) {
      stop();
      return;
    }
    start();
  };

  return { listening, supported, error, toggle, start, stop, cancel };
}

export function appendSpeechTranscript(current: string, chunk: string) {
  const trimmed = current.trimEnd();
  const separator = trimmed.length > 0 && !/[，。！？,.!?]$/.test(trimmed) ? ' ' : '';
  return `${trimmed}${separator}${chunk}`.trimStart();
}
