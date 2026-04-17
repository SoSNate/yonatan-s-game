import { useState } from 'react';

export function useLocalStorage<T>(
  key: string,
  initial: T
): [T, (updater: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = (updater: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next =
        typeof updater === 'function'
          ? (updater as (p: T) => T)(prev)
          : updater;
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };

  return [value, set];
}
