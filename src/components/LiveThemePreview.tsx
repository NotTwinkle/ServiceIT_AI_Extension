import React from 'react';
import { Theme } from '../types/theme';

interface LiveThemePreviewProps {
  theme: Theme;
}

const LiveThemePreview: React.FC<LiveThemePreviewProps> = ({ theme }) => {
  // Get logo URL (handle base64 or path)
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
    <div className="sit-flex sit-flex-col sit-gap-6" style={{ width: '100%' }}>
      {/* Chat Widget Preview */}
      <div>
        <h4 style={{
          color: theme.colors.textPrimary,
          fontWeight: '600',
          fontSize: '13px',
          marginBottom: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Chat Widget
        </h4>
        <div className="sit-rounded-2xl sit-overflow-hidden" style={{ 
          width: '100%',
          maxWidth: '384px',
          height: '600px',
          maxHeight: '70vh',
          backgroundColor: theme.colors.background,
          boxShadow: '0 12px 48px rgba(0, 0, 0, 0.15)',
          border: `1px solid rgba(0, 0, 0, 0.08)`,
          display: 'flex',
          flexDirection: 'column',
          margin: '0 auto',
        }}>
          {/* Widget Header Preview */}
          <div
            className="sit-px-5 sit-py-4 sit-flex sit-items-center sit-justify-between"
            style={{ 
              backgroundColor: theme.colors.primary,
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <div className="sit-flex sit-items-center sit-gap-3">
              <div 
                className="sit-w-11 sit-h-11 sit-rounded-full sit-flex sit-items-center sit-justify-center sit-border-0 sit-overflow-hidden"
                style={{ 
                  backgroundColor: '#ffffff',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                  padding: '4px',
                }}
              >
                <img 
                  src={getLogoUrl()}
                  alt={theme.systemName}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                  onError={(e) => {
                    e.currentTarget.src = chrome.runtime.getURL('icons/SERVICEITLOGO.png');
                  }}
                />
              </div>
              <div className="sit-flex sit-flex-col">
                <span style={{ 
                  color: '#ffffff',
                  fontWeight: '600',
                  fontSize: '15px',
                  lineHeight: '1.3',
                  margin: '0',
                }}>
                  {theme.systemName}
                </span>
                <span style={{ 
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '11px',
                  lineHeight: '1.3',
                  margin: '0',
                }}>
                  Always here to help
                </span>
              </div>
            </div>
          </div>

          {/* Widget Body Preview */}
          <div 
            className="sit-flex-1 sit-overflow-y-auto sit-px-4 sit-py-6"
            style={{ 
              backgroundColor: theme.colors.surface,
              position: 'relative',
            }}
          >
            <div className="sit-flex sit-flex-col sit-gap-5" style={{ position: 'relative', zIndex: 1 }}>
              {/* Assistant Message */}
              <div
                className="sit-flex sit-flex-col sit-gap-2"
                style={{
                  alignItems: 'flex-start',
                }}
              >
                <div
                  className="sit-rounded-2xl sit-border-0"
                  style={{
                    backgroundColor: theme.colors.background,
                    color: theme.colors.textPrimary,
                    border: `1px solid ${theme.colors.border}`,
                    borderBottomLeftRadius: '4px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                    padding: '20px 24px',
                    maxWidth: '85%',
                    width: 'fit-content',
                    minWidth: '250px',
                    marginBottom: '4px',
                  }}
                >
                  <div
                    className="sit-w-full"
                    style={{
                      margin: '0',
                      fontSize: '15px',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      overflowWrap: 'anywhere',
                      color: theme.colors.textSecondary,
                      fontWeight: 400,
                      textAlign: 'left',
                      fontFamily: '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                    }}
                  >
                    This is a preview message. The assistant is ready to help!
                  </div>
                </div>
                <span style={{ 
                  fontSize: '11px',
                  color: theme.colors.textMuted,
                  margin: '0',
                  paddingLeft: '8px',
                }}>
                  10:30 AM
                </span>
              </div>

              {/* User Message */}
              <div
                className="sit-flex sit-flex-col sit-gap-2"
                style={{
                  alignItems: 'flex-end',
                }}
              >
                <div
                  className="sit-rounded-2xl sit-border-0"
                  style={{ 
                    backgroundColor: theme.colors.primary,
                    color: '#ffffff !important',
                    borderBottomRightRadius: '4px',
                    boxShadow: `0 4px 12px ${theme.colors.primary}26`,
                    padding: '12px 16px',
                    maxWidth: '85%',
                  }}
                >
                  <p style={{ 
                    margin: '0',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#ffffff',
                    fontWeight: 400,
                    textAlign: 'left',
                  }}>
                    User message preview
                  </p>
                </div>
                <span style={{ 
                  fontSize: '11px',
                  color: theme.colors.textMuted,
                  margin: '0',
                  paddingRight: '8px',
                }}>
                  10:31 AM
                </span>
              </div>
            </div>
          </div>

          {/* Widget Footer Preview */}
          <div 
            className="sit-px-4 sit-py-4 sit-border-0"
            style={{ 
              backgroundColor: theme.colors.background,
              borderTop: `1px solid ${theme.colors.border}`,
            }}
          >
            <div className="sit-flex sit-gap-2 sit-items-center">
              <input
                type="text"
                placeholder="Type a message..."
                disabled
                className="sit-flex-1 sit-px-4 sit-py-3 sit-rounded-xl sit-border"
                style={{ 
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.background,
                  fontSize: '14px',
                  color: theme.colors.textPrimary,
                  outline: 'none',
                }}
              />
              <button
                className="sit-w-10 sit-h-10 sit-rounded-xl sit-flex sit-items-center sit-justify-center sit-cursor-pointer sit-transition-all sit-duration-200 sit-border-0"
                style={{ 
                  backgroundColor: theme.colors.secondary,
                  color: '#ffffff',
                }}
              >
                →
              </button>
            </div>
            <p style={{
              margin: '8px 0 0 0',
              paddingLeft: '0',
              fontSize: '11px',
              color: theme.colors.textMuted,
              textAlign: 'left',
              width: '100%',
            }}>
              Powered by Service IT+
            </p>
          </div>
        </div>
      </div>

      {/* Loading Screen Preview */}
      <div>
        <h4 style={{
          color: theme.colors.textPrimary,
          fontWeight: '600',
          fontSize: '13px',
          marginBottom: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Loading Screen
        </h4>
        <div 
          className="sit-rounded-xl sit-overflow-hidden"
          style={{ 
            border: `2px solid ${theme.colors.border}`,
            backgroundColor: 'rgba(255, 255, 255, 0.98)',
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 250, 251, 0.98) 100%)',
          }}
        >
          {/* Logo Container */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* Glow Ring Effect */}
            <div 
              style={{
                position: 'absolute',
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: `radial-gradient(circle, ${theme.colors.secondary}25 0%, transparent 70%)`,
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
            
            {/* Logo with Shadow */}
            <div 
              style={{
                position: 'relative',
                width: '80px',
                height: '80px',
                borderRadius: '16px',
                backgroundColor: theme.colors.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                boxShadow: `0 8px 24px ${theme.colors.primary}50`,
              }}
            >
              <img 
                src={getLogoUrl()}
                alt="Logo"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  filter: 'brightness(0) invert(1)',
                }}
                onError={(e) => {
                  e.currentTarget.src = chrome.runtime.getURL('icons/SERVICEITLOGO.png');
                }}
              />
            </div>
          </div>

          {/* System Name */}
          <div style={{ textAlign: 'center' }}>
            <h2 style={{
              color: theme.colors.primary,
              fontWeight: '700',
              fontSize: '24px',
              margin: '0 0 12px 0',
              letterSpacing: '-0.5px',
            }}>
              {theme.systemName}
            </h2>
          </div>

          {/* AI Badge */}
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{
              display: 'inline-block',
              padding: '6px 16px',
              borderRadius: '24px',
              background: `linear-gradient(135deg, ${theme.colors.secondary} 0%, ${theme.colors.secondary}DD 100%)`,
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: '600',
              boxShadow: `0 4px 12px ${theme.colors.secondary}40`,
            }}>
              AI Assistant
            </div>
          </div>

          {/* Loading Dots */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: theme.colors.primary,
                  animation: 'sit-loading-bounce 0.6s ease-in-out infinite',
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>

          {/* Status Message */}
          <p style={{
            color: theme.colors.textMuted,
            fontSize: '13px',
            margin: 0,
            textAlign: 'center',
          }}>
            Initializing assistant...
          </p>
        </div>
      </div>

      {/* Color Palette Preview - Compact */}
      <div>
        <h4 style={{
          color: theme.colors.textPrimary,
          fontWeight: '600',
          fontSize: '13px',
          marginBottom: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Color Palette
        </h4>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
          gap: '10px',
        }}>
          {Object.entries(theme.colors).map(([key, value]) => (
            <div key={key} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              minWidth: 0,
            }}>
              <div style={{
                width: '100%',
                height: '48px',
                backgroundColor: value,
                borderRadius: '8px',
                border: `2px solid ${theme.colors.border}`,
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
              }} />
              <span style={{
                fontSize: '10px',
                color: theme.colors.textMuted,
                textAlign: 'center',
                fontWeight: '500',
                textTransform: 'capitalize',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LiveThemePreview;
