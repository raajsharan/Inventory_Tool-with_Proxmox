import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';

const ThemeContext = createContext(null);

const FONT_STEPS = [12, 13, 14, 15, 16, 17];     // ant default ~14
const DEFAULT_FONT_PX = 14;

// Matches the design tokens in styles.css (--ink-900/--ink-700/--signal) so
// the login page's ops navy / signal blue identity carries through the rest
// of the app instead of stopping at the login screen. "Plus Jakarta Sans"
// replaces "Inter", which was never actually loaded (no @font-face/import
// for it) and was silently falling back to the system font stack.
const BASE_TOKEN = {
  colorPrimary: '#2F6FED',
  colorInfo: '#2F6FED',
  borderRadius: 6,
  fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const LIGHT_COMPONENTS = {
  Layout: { headerBg: '#ffffff', siderBg: '#0B1530', triggerBg: '#0A122A' },
  Menu:   { darkItemBg: '#0B1530', darkSubMenuItemBg: '#0A122A', darkItemSelectedBg: '#2F6FED' },
};

const DARK_COMPONENTS = {
  Layout: { headerBg: '#141414', siderBg: '#000000', triggerBg: '#0a0a0a', bodyBg: '#1f1f1f' },
  Menu:   { darkItemBg: '#000000', darkSubMenuItemBg: '#0a0a0a', darkItemSelectedBg: '#2F6FED' },
};

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem('themeMode') || 'light');
  const [fontPx, setFontPx] = useState(() => {
    const v = parseInt(localStorage.getItem('themeFontPx') || '', 10);
    return Number.isFinite(v) && FONT_STEPS.includes(v) ? v : DEFAULT_FONT_PX;
  });

  useEffect(() => {
    localStorage.setItem('themeMode', mode);
    document.body.dataset.theme = mode;
  }, [mode]);

  useEffect(() => {
    localStorage.setItem('themeFontPx', String(fontPx));
    // Also expose as a CSS variable for any non-AntD bits.
    document.documentElement.style.setProperty('--app-font-px', `${fontPx}px`);
  }, [fontPx]);

  const config = useMemo(() => ({
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: { ...BASE_TOKEN, fontSize: fontPx },
    components: mode === 'dark' ? DARK_COMPONENTS : LIGHT_COMPONENTS,
  }), [mode, fontPx]);

  function toggleMode() { setMode(m => m === 'dark' ? 'light' : 'dark'); }
  function increaseFont() {
    setFontPx(p => {
      const i = FONT_STEPS.indexOf(p);
      return FONT_STEPS[Math.min(FONT_STEPS.length - 1, i + 1)];
    });
  }
  function decreaseFont() {
    setFontPx(p => {
      const i = FONT_STEPS.indexOf(p);
      return FONT_STEPS[Math.max(0, i - 1)];
    });
  }
  function resetFont() { setFontPx(DEFAULT_FONT_PX); }

  const canIncrease = fontPx < FONT_STEPS[FONT_STEPS.length - 1];
  const canDecrease = fontPx > FONT_STEPS[0];

  return (
    <ThemeContext.Provider value={{
      mode, toggleMode,
      fontPx, increaseFont, decreaseFont, resetFont,
      canIncrease, canDecrease,
    }}>
      <ConfigProvider theme={config}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export const useAppTheme = () => useContext(ThemeContext);
