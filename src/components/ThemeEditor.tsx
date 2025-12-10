import React from 'react';
import { X, Save, RotateCcw } from 'lucide-react';
import { Theme } from '../types/theme';
import ThemeSettings from './ThemeSettings';
import LiveThemePreview from './LiveThemePreview';

interface ThemeEditorProps {
  currentTheme: Theme;
  tempTheme: Theme;
  onTempThemeChange: (theme: Theme) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
}

const ThemeEditor: React.FC<ThemeEditorProps> = ({
  currentTheme,
  tempTheme,
  onTempThemeChange,
  onSave,
  onCancel,
  onReset,
}) => {
  const hasChanges = JSON.stringify(currentTheme) !== JSON.stringify(tempTheme);

  return (
    <>
      {/* Dark Overlay */}
      <div
        className="sit-fixed sit-inset-0"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 2147483647,
          backdropFilter: 'blur(4px)',
        }}
        onClick={onCancel}
      />

      {/* Theme Editor Modal */}
      <div
        className="sit-fixed sit-inset-0 sit-flex sit-items-center sit-justify-center"
        style={{
          zIndex: 2147483648,
          pointerEvents: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sit-rounded-2xl sit-flex sit-flex-col sit-overflow-hidden"
          style={{
            width: '90vw',
            maxWidth: '1200px',
            minWidth: '320px',
            height: '85vh',
            maxHeight: '800px',
            minHeight: '500px',
            backgroundColor: '#ffffff',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="sit-px-6 sit-py-4 sit-flex sit-items-center sit-justify-between"
            style={{
              backgroundColor: tempTheme.colors.primary,
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <div className="sit-flex sit-items-center sit-gap-3">
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px',
                }}
              >
                <img
                  src={
                    tempTheme.logo.startsWith('data:image')
                      ? tempTheme.logo
                      : tempTheme.logo.startsWith('blob:')
                      ? tempTheme.logo
                      : chrome.runtime.getURL(tempTheme.logo)
                  }
                  alt="Logo"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                  onError={(e) => {
                    e.currentTarget.src = chrome.runtime.getURL('icons/SERVICEITLOGO.png');
                  }}
                />
              </div>
              <div className="sit-flex sit-flex-col">
                <h2
                  style={{
                    color: '#ffffff',
                    fontWeight: '700',
                    fontSize: '18px',
                    margin: 0,
                    lineHeight: '1.3',
                  }}
                >
                  Theme Editor
                </h2>
                <p
                  style={{
                    color: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '12px',
                    margin: '4px 0 0 0',
                    lineHeight: '1.3',
                  }}
                >
                  Customize your chat widget appearance
                </p>
              </div>
            </div>
            <div className="sit-flex sit-items-center sit-gap-2">
              <button
                onClick={onCancel}
                className="sit-w-9 sit-h-9 sit-rounded-lg sit-flex sit-items-center sit-justify-center sit-cursor-pointer sit-transition-all sit-duration-200 sit-border-0"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  color: '#ffffff',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
                }}
                title="Close"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Content Area - Responsive Split View */}
          <div 
            className="sit-flex-1 sit-overflow-hidden"
            style={{ 
              backgroundColor: '#f9fafb',
              display: 'flex',
              flexDirection: 'row',
              minHeight: 0,
            }}
          >
            {/* Left Side - Theme Settings */}
            <div
              className="sit-overflow-y-auto"
              style={{
                width: '400px',
                minWidth: '280px',
                maxWidth: '50%',
                backgroundColor: '#ffffff',
                borderRight: '1px solid #e5e7eb',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
              }}
            >
                <div className="sit-px-4 sit-py-3" style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <h3
                    style={{
                      color: tempTheme.colors.textPrimary,
                      fontWeight: '600',
                      fontSize: '15px',
                      margin: '0 0 4px 0',
                    }}
                  >
                    Customization Options
                  </h3>
                  <br />
                  <p
                    style={{
                      color: tempTheme.colors.textMuted,
                      fontSize: '11px',
                      margin: 0,
                    }}
                  >
                    All changes are previewed in real-time
                  </p>
                </div>
                <div className="sit-flex-1 sit-overflow-y-auto" style={{ minHeight: 0 }}>
                  <ThemeSettings
                    theme={tempTheme}
                    onThemeChange={onTempThemeChange}
                    onReset={onReset}
                  />
                </div>
              </div>

            {/* Right Side - Live Preview */}
            <div
              className="sit-flex-1 sit-overflow-y-auto"
              style={{
                backgroundColor: '#f9fafb',
                padding: '16px',
                minHeight: 0,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                minWidth: 0,
              }}
            >
              <div style={{ maxWidth: '700px', width: '100%', minWidth: 0 }}>
                <LiveThemePreview theme={tempTheme} />
              </div>
            </div>
          </div>

          {/* Footer - Action Buttons (Responsive) */}
          <div
            className="sit-px-4 sit-py-3"
            style={{
              backgroundColor: '#ffffff',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <button
              onClick={onReset}
              className="sit-px-3 sit-py-2 sit-rounded-lg sit-flex sit-items-center sit-gap-2 sit-cursor-pointer sit-transition-all sit-duration-200 sit-border"
              style={{
                backgroundColor: '#ffffff',
                borderColor: tempTheme.colors.border,
                color: tempTheme.colors.textPrimary,
                fontSize: '13px',
                fontWeight: '500',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f9fafb';
                e.currentTarget.style.borderColor = tempTheme.colors.primary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#ffffff';
                e.currentTarget.style.borderColor = tempTheme.colors.border;
              }}
            >
              <RotateCcw size={14} strokeWidth={2} />
              <span>Reset</span>
            </button>

            <div className="sit-flex sit-items-center sit-gap-2" style={{ flexShrink: 0 }}>
              <button
                onClick={onCancel}
                className="sit-px-4 sit-py-2 sit-rounded-lg sit-cursor-pointer sit-transition-all sit-duration-200 sit-border"
                style={{
                  backgroundColor: '#ffffff',
                  borderColor: tempTheme.colors.border,
                  color: tempTheme.colors.textPrimary,
                  fontSize: '13px',
                  fontWeight: '600',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f9fafb';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#ffffff';
                }}
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={!hasChanges}
                className="sit-px-4 sit-py-2 sit-rounded-lg sit-flex sit-items-center sit-gap-2 sit-cursor-pointer sit-transition-all sit-duration-200 sit-border-0"
                style={{
                  backgroundColor: hasChanges ? tempTheme.colors.primary : tempTheme.colors.border,
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: '600',
                  opacity: hasChanges ? 1 : 0.6,
                  cursor: hasChanges ? 'pointer' : 'not-allowed',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (hasChanges) {
                    e.currentTarget.style.opacity = '0.9';
                  }
                }}
                onMouseLeave={(e) => {
                  if (hasChanges) {
                    e.currentTarget.style.opacity = '1';
                  }
                }}
              >
                <Save style={{ color: '#ffffff' }} size={14} strokeWidth={2} />
                <span style={{ color: '#ffffff' }}>Save</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ThemeEditor;

