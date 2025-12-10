import React, { useState, useEffect } from 'react';
import { Theme, DEFAULT_THEME, THEME_STORAGE_KEY } from '../types/theme';

interface LoadingScreenProps {
  message?: string;
  progress?: {
    stage: string;
    progress: number;
    message: string;
  };
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ progress }) => {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  // Load theme from storage
  useEffect(() => {
    chrome.storage.local.get([THEME_STORAGE_KEY], (result) => {
      if (result[THEME_STORAGE_KEY]) {
        try {
          const storedTheme = result[THEME_STORAGE_KEY] as Theme;
          if (storedTheme && storedTheme.colors && storedTheme.systemName && storedTheme.logo) {
            setTheme(storedTheme);
          }
        } catch (error) {
          console.error('Error loading theme:', error);
        }
      }
    });
  }, []);

  // Get logo URL (handle base64, blob, or extension path)
  const getLogoUrl = (): string => {
    if (theme.logo.startsWith('data:image')) {
      return theme.logo; // Base64 image
    }
    if (theme.logo.startsWith('blob:')) {
      return theme.logo; // Object URL
    }
    return chrome.runtime.getURL(theme.logo); // Extension path
  };

  return (
    <div 
      className="sit-fixed sit-inset-0 sit-z-[2147483647] sit-flex sit-items-center sit-justify-center"
      style={{
        // Semi-transparent white overlay so the Ivanti page is still visible behind
        backgroundColor: 'rgba(255, 255, 255, 0.82)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {/* Main Loading Card */}
      <div 
        className="sit-relative sit-flex sit-flex-col sit-items-center sit-px-12 sit-py-10 sit-rounded-3xl sit-space-y-8 sit-animate-fade-in"
        style={{
          background: 'rgba(255, 255, 255, 0.98)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)',
          minWidth: '420px',
        }}
      >
        {/* Logo Container with Breathing Effect */}
        <div className="sit-relative sit-flex sit-items-center sit-justify-center">
          {/* Glow Ring Effect */}
          <div 
            className="sit-absolute sit-inset-0 sit-rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(255, 153, 0, 0.15) 0%, transparent 70%)',
              animation: 'sit-pulse-glow 2s ease-in-out infinite',
              transform: 'scale(1.8)',
            }}
          ></div>
          
          {/* Logo with Breathing Animation */}
          <div 
            className="sit-relative sit-p-6 sit-rounded-2xl"
            style={{
              background: `linear-gradient(135deg, ${theme.colors.primary} 0%, ${theme.colors.primary}CC 100%)`,
              boxShadow: `0 10px 30px ${theme.colors.primary}4D`,
              animation: 'sit-breathe 2s ease-in-out infinite',
            }}
          >
            <img 
              src={getLogoUrl()}
              alt={`${theme.systemName} Logo`}
              className="sit-w-20 sit-h-20"
              style={{
                filter: 'brightness(0) invert(1)',
              }}
              onError={(e) => {
                e.currentTarget.src = chrome.runtime.getURL("icons/SERVICEITLOGO.png");
              }}
            />
          </div>
        </div>
        
        {/* Title and Status */}
        <div className="sit-text-center sit-space-y-4">
          <h2 
            className="sit-text-3xl sit-font-bold sit-tracking-tight"
            style={{
              color: theme.colors.primary,
            }}
          >
            {theme.systemName}
          </h2>
          
          {/* AI Badge */}
          <div className="sit-flex sit-items-center sit-justify-center sit-gap-2">
            <div 
              className="sit-px-4 sit-py-1.5 sit-rounded-full sit-text-sm sit-font-semibold"
              style={{
                background: `linear-gradient(135deg, ${theme.colors.secondary} 0%, ${theme.colors.secondary}CC 100%)`,
                color: '#ffffff',
                boxShadow: `0 4px 12px ${theme.colors.secondary}4D`,
              }}
            >
              AI Assistant
            </div>
          </div>
          
          {/* Animated Loading Dots */}
          <div className="sit-flex sit-items-center sit-justify-center sit-space-x-2.5 sit-pt-2">
            <div 
              className="sit-w-2.5 sit-h-2.5 sit-rounded-full"
              style={{ 
                background: `linear-gradient(135deg, ${theme.colors.primary} 0%, ${theme.colors.primary}CC 100%)`,
                animation: 'sit-loading-bounce 0.6s ease-in-out infinite',
                animationDelay: '0s',
              }}
            ></div>
            <div 
              className="sit-w-2.5 sit-h-2.5 sit-rounded-full"
              style={{ 
                background: `linear-gradient(135deg, ${theme.colors.primary} 0%, ${theme.colors.primary}CC 100%)`,
                animation: 'sit-loading-bounce 0.6s ease-in-out infinite',
                animationDelay: '0.2s',
              }}
            ></div>
            <div 
              className="sit-w-2.5 sit-h-2.5 sit-rounded-full"
              style={{ 
                background: `linear-gradient(135deg, ${theme.colors.primary} 0%, ${theme.colors.primary}CC 100%)`,
                animation: 'sit-loading-bounce 0.6s ease-in-out infinite',
                animationDelay: '0.4s',
              }}
            ></div>
          </div>
        </div>
        
        {/* Status Message */}
        <p 
          className="sit-text-sm sit-font-medium sit-text-center sit-max-w-xs"
          style={{ color: theme.colors.textMuted }}
        >
          {progress?.message || 'Identifying user and initializing assistant...'}
        </p>

      </div>
    </div>
  );
};

export default LoadingScreen;

