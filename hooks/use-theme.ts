'use client';

import { useTheme as useNextTheme } from 'next-themes';
import { useCallback } from 'react';

export function useTheme() {
  const { theme, setTheme, resolvedTheme } = useNextTheme();

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  return { theme: resolvedTheme, setTheme, toggle, isDark: resolvedTheme === 'dark' };
}
