// Theme system types and default theme configuration

export interface ThemeColors {
  primary: string;          // Main brand color (navy blue)
  secondary: string;        // Accent color (orange)
  background: string;       // Main background
  surface: string;          // Card/panel background
  textPrimary: string;      // Main text color
  textSecondary: string;    // Secondary text color
  textMuted: string;        // Muted text color
  border: string;           // Border color
  success: string;          // Success state color
  error: string;            // Error state color
}

export interface Theme {
  logo: string;             // Logo URL or path
  systemName: string;       // System/app name
  colors: ThemeColors;
}

export const DEFAULT_THEME: Theme = {
  logo: 'icons/SERVICEITLOGO.png',
  systemName: 'Service IT Plus',
  colors: {
    primary: '#002b5c',
    secondary: '#ff9900',
    background: '#ffffff',
    surface: '#f7f8fa',
    textPrimary: '#1f2937',
    textSecondary: '#111827',
    textMuted: '#9ca3af',
    border: '#e5e7eb',
    success: '#10b981',
    error: '#dc2626',
  },
};

// Storage key for theme
export const THEME_STORAGE_KEY = 'chatWidgetTheme';

// Predefined color themes (Industry best practice: Offer professionally designed presets)
export const PREDEFINED_THEMES: { name: string; colors: ThemeColors }[] = [
  {
    name: 'Service IT Plus (Default)',
    colors: DEFAULT_THEME.colors,
  },
  {
    name: 'Ocean Blue',
    colors: {
      primary: '#0ea5e9',
      secondary: '#06b6d4',
      background: '#ffffff',
      surface: '#f0f9ff',
      textPrimary: '#0c4a6e',
      textSecondary: '#075985',
      textMuted: '#64748b',
      border: '#cbd5e1',
      success: '#10b981',
      error: '#ef4444',
    },
  },
  {
    name: 'Forest Green',
    colors: {
      primary: '#059669',
      secondary: '#10b981',
      background: '#ffffff',
      surface: '#f0fdf4',
      textPrimary: '#064e3b',
      textSecondary: '#065f46',
      textMuted: '#6b7280',
      border: '#d1d5db',
      success: '#10b981',
      error: '#dc2626',
    },
  },
  {
    name: 'Royal Purple',
    colors: {
      primary: '#7c3aed',
      secondary: '#a855f7',
      background: '#ffffff',
      surface: '#faf5ff',
      textPrimary: '#581c87',
      textSecondary: '#6b21a8',
      textMuted: '#9ca3af',
      border: '#e5e7eb',
      success: '#10b981',
      error: '#dc2626',
    },
  },
  {
    name: 'Sunset Orange',
    colors: {
      primary: '#ea580c',
      secondary: '#f97316',
      background: '#ffffff',
      surface: '#fff7ed',
      textPrimary: '#9a3412',
      textSecondary: '#c2410c',
      textMuted: '#78716c',
      border: '#e7e5e4',
      success: '#10b981',
      error: '#dc2626',
    },
  },
  {
    name: 'Midnight Dark',
    colors: {
      primary: '#1e293b',
      secondary: '#334155',
      background: '#0f172a',
      surface: '#1e293b',
      textPrimary: '#f1f5f9',
      textSecondary: '#e2e8f0',
      textMuted: '#94a3b8',
      border: '#334155',
      success: '#22c55e',
      error: '#f87171',
    },
  },
];

