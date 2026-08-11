import { useEffect, useState } from 'react';

/**
 * The latest `value` once it has stopped changing for `delayMs`. Debounces a
 * *value* — feed the result to a query hook whose `queryKey` it belongs to, so
 * keystrokes collapse into one request. `routes/search.tsx` deliberately does
 * not use this: its timer debounces a router navigation, not a value.
 */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
