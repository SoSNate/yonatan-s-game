import { useRef, useState, useCallback, useEffect } from 'react';

type Lang = 'he-IL' | 'en-US';

interface SpeechHook {
  isListening: boolean;
  isSupported: boolean;
  interim: string;
  start: (onResult: (transcript: string) => void) => void;
  stop: () => void;
  switchLang: (lang: Lang) => void;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
}

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
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export function useSpeechRecognition(initialLang: Lang = 'he-IL'): SpeechHook {
  const SpeechRecognitionClass =
    window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const isSupported = !!SpeechRecognitionClass;

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const langRef = useRef<Lang>(initialLang);
  const onResultRef = useRef<((t: string) => void) | null>(null);
  const shouldListenRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState('');

  const createAndStart = useCallback(() => {
    if (!SpeechRecognitionClass) return;
    const rec = new SpeechRecognitionClass();
    rec.lang = langRef.current;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          const transcript = result[0].transcript.trim();
          setInterim('');
          onResultRef.current?.(transcript);
        } else {
          interimText += result[0].transcript;
        }
      }
      setInterim(interimText);
    };

    rec.onstart = () => setIsListening(true);
    rec.onend = () => {
      setIsListening(false);
      setInterim('');
      if (shouldListenRef.current) {
        setTimeout(createAndStart, 150);
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        console.warn('Speech error:', e.error);
      }
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch (_) {}
  }, [SpeechRecognitionClass]);

  const start = useCallback((onResult: (t: string) => void) => {
    if (!isSupported) return;
    onResultRef.current = onResult;
    shouldListenRef.current = true;
    createAndStart();
  }, [isSupported, createAndStart]);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch (_) {}
  }, []);

  const switchLang = useCallback((lang: Lang) => {
    if (langRef.current === lang) return;
    langRef.current = lang;
    // Don't stop — the current recognition session will still match
    // whichever language the user speaks (Hebrew/English are distinguishable).
    // Language preference applies to the NEXT natural restart via onend.
  }, []);

  useEffect(() => () => {
    shouldListenRef.current = false;
    try { recognitionRef.current?.abort(); } catch (_) {}
  }, []);

  return { isListening, isSupported, interim, start, stop, switchLang };
}

export function speak(text: string, lang: string = 'en-US') {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  utter.rate = 0.9;
  utter.pitch = 1.0;
  window.speechSynthesis.speak(utter);
}
