'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CompositionEvent as ReactCompositionEvent,
  FocusEvent as ReactFocusEvent,
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
 * A controlled textarea with `value={prop}` can reset the composition
 * buffer whenever the parent re-renders during composition (which happens
 * on every keystroke when onChange triggers debounced saves). This wrapper
 * keeps a local copy of the text and only syncs to the parent after
 * `compositionend`, normal `onChange` (when not composing), or `blur`.
 */
export function ImeTextarea({
  value,
  onValueChange,
  onKeyDown,
  onBlur,
  onFocus,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: ImeTextareaProps) {
  const [localValue, setLocalValue] = useState(value);
  const composingRef = useRef(false);
  const focusedRef = useRef(false);
  const dirtyRef = useRef(false);

  // Sync generated/external updates while focused unless the user has edited this textarea.
  useEffect(() => {
    if (!composingRef.current && (!focusedRef.current || !dirtyRef.current)) {
      setLocalValue(value);
      dirtyRef.current = false;
    }
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setLocalValue(next);
    dirtyRef.current = true;
    if (!composingRef.current) {
      onValueChange(next);
    }
  };

  const handleCompositionStart = (event: ReactCompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = true;
    onCompositionStart?.(event);
  };

  const handleCompositionEnd = (event: ReactCompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    const next = event.currentTarget.value;
    setLocalValue(next);
    dirtyRef.current = true;
    onValueChange(next);
    onCompositionEnd?.(event);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Block canvas shortcuts while typing.
    event.stopPropagation();
    onKeyDown?.(event);
  };

  const handleBlur = (event: ReactFocusEvent<HTMLTextAreaElement>) => {
    focusedRef.current = false;
    if (dirtyRef.current && localValue !== value) {
      onValueChange(localValue);
    }
    dirtyRef.current = false;
    onBlur?.(event);
  };

  const handleFocus = (event: ReactFocusEvent<HTMLTextAreaElement>) => {
    focusedRef.current = true;
    dirtyRef.current = false;
    onFocus?.(event);
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
