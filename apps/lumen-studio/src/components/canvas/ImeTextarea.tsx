'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CompositionEvent as ReactCompositionEvent,
  KeyboardEvent as ReactKeyboardEvent,
  TextareaHTMLAttributes,
} from 'react';

type ImeTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (next: string) => void;
};

/**
 * Textarea wrapper that won't lose IME composition on parent re-renders.
 *
 * Plain controlled textarea with `value={prop}` resets the IME compose
 * buffer whenever the parent re-renders during composition (which happens
 * on every keystroke when onChange triggers debounced saves). This wrapper
 * keeps a local copy of the text and only syncs to the parent after
 * `compositionend`, normal `onChange` (when not composing), or `blur`.
 */
export function ImeTextarea({ value, onValueChange, onKeyDown, ...rest }: ImeTextareaProps) {
  const [localValue, setLocalValue] = useState(value);
  const composingRef = useRef(false);
  const focusedRef = useRef(false);

  // Sync from parent only when the user isn't typing/composing here.
  useEffect(() => {
    if (!focusedRef.current && !composingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setLocalValue(next);
    if (!composingRef.current) {
      onValueChange(next);
    }
  };

  const handleCompositionStart = (_event: ReactCompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (event: ReactCompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    const next = event.currentTarget.value;
    setLocalValue(next);
    onValueChange(next);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Block React Flow from intercepting Space etc. while typing
    event.stopPropagation();
    onKeyDown?.(event);
  };

  const handleBlur = () => {
    focusedRef.current = false;
    if (localValue !== value) {
      onValueChange(localValue);
    }
  };

  const handleFocus = () => {
    focusedRef.current = true;
  };

  return (
    <textarea
      {...rest}
      value={localValue}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onFocus={handleFocus}
    />
  );
}
