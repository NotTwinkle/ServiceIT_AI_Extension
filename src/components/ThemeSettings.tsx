import React, { useState, useRef } from 'react';
import { Upload, RefreshCw, ChevronRight, Palette, Image as ImageIcon, Type, Sparkles, AlertCircle } from 'lucide-react';
import { Theme, DEFAULT_THEME, PREDEFINED_THEMES } from '../types/theme';

interface ThemeSettingsProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onReset: () => void;
}

const ThemeSettings: React.FC<ThemeSettingsProps> = ({ theme, onThemeChange, onReset }) => {
  const [isLogoExpanded, setIsLogoExpanded] = useState(false);
  const [isSystemNameExpanded, setIsSystemNameExpanded] = useState(false);
  const [isColorsExpanded, setIsColorsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper function to calculate contrast ratio (WCAG accessibility)
  const getContrastRatio = (color1: string, color2: string): number => {
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
          }
        : null;
    };

    const getLuminance = (rgb: { r: number; g: number; b: number }) => {
      const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((val) => {
        val = val / 255;
        return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);
    if (!rgb1 || !rgb2) return 1;

    const lum1 = getLuminance(rgb1);
    const lum2 = getLuminance(rgb2);
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    return (lighter + 0.05) / (darker + 0.05);
  };

  // Check if text color has good contrast on background
  const getContrastWarning = (textColor: string, bgColor: string): string | null => {
    const ratio = getContrastRatio(textColor, bgColor);
    if (ratio < 4.5) {
      return 'Low contrast - may affect readability';
    }
    return null;
  };

  // Handle logo upload
  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be smaller than 2MB');
      return;
    }

    // Store the image as base64 for persistence
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      onThemeChange({
        ...theme,
        logo: base64String, // Use base64 for storage and display
      });
    };
    reader.readAsDataURL(file);
  };

  // Reset logo to default
  const handleResetLogo = () => {
    onThemeChange({
      ...theme,
      logo: DEFAULT_THEME.logo,
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle system name change
  const handleSystemNameChange = (name: string) => {
    onThemeChange({
      ...theme,
      systemName: name,
    });
  };

  // Handle color change
  const handleColorChange = (colorKey: keyof typeof theme.colors, value: string) => {
    onThemeChange({
      ...theme,
      colors: {
        ...theme.colors,
        [colorKey]: value,
      },
    });
  };

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

  // Color categories for better organization (Industry best practice)
  const colorCategories = {
    brand: {
      title: 'Brand Colors',
      description: 'Primary brand identity colors',
      colors: ['primary', 'secondary'] as Array<keyof typeof theme.colors>,
    },
    ui: {
      title: 'UI Elements',
      description: 'Background and surface colors',
      colors: ['background', 'surface', 'border'] as Array<keyof typeof theme.colors>,
    },
    text: {
      title: 'Text Colors',
      description: 'Text hierarchy and readability',
      colors: ['textPrimary', 'textSecondary', 'textMuted'] as Array<keyof typeof theme.colors>,
    },
    states: {
      title: 'State Colors',
      description: 'Success, error, and feedback states',
      colors: ['success', 'error'] as Array<keyof typeof theme.colors>,
    },
  };

  const colorLabels: Record<keyof typeof theme.colors, string> = {
    primary: 'Primary',
    secondary: 'Accent',
    background: 'Background',
    surface: 'Surface',
    textPrimary: 'Text Primary',
    textSecondary: 'Text Secondary',
    textMuted: 'Text Muted',
    border: 'Border',
    success: 'Success',
    error: 'Error',
  };

  const colorDescriptions: Record<keyof typeof theme.colors, string> = {
    primary: 'Main brand color (headers, buttons)',
    secondary: 'Accent color (highlights, CTAs)',
    background: 'Main page background',
    surface: 'Card and panel backgrounds',
    textPrimary: 'Main body text',
    textSecondary: 'Secondary text',
    textMuted: 'Subtle text and placeholders',
    border: 'Borders and dividers',
    success: 'Success messages and indicators',
    error: 'Error messages and warnings',
  };

  return (
    <div className="sit-flex sit-flex-col">
      {/* Logo Customization */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsLogoExpanded(!isLogoExpanded);
        }}
        className="sit-w-full sit-flex sit-items-center sit-justify-between sit-px-5 sit-py-3.5 sit-cursor-pointer sit-border-0 sit-transition-colors"
        style={{
          backgroundColor: 'transparent',
          borderBottom: '1px solid #f3f4f6',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#f9fafb';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <div className="sit-flex sit-items-center sit-gap-2">
          <ImageIcon size={16} strokeWidth={2} color="#6b7280" />
          <span style={{ 
            color: '#1f2937',
            fontWeight: '600',
            fontSize: '14px',
          }}>
            Logo Customization
          </span>
        </div>
        <ChevronRight 
          size={16} 
          strokeWidth={2}
          color="#6b7280"
          style={{
            transform: isLogoExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      </button>

      {isLogoExpanded && (
        <div className="sit-px-5 sit-py-4 sit-border-b" style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: '#f9fafb' }}>
          {/* Logo Preview */}
          <div className="sit-mb-4 sit-flex sit-items-center sit-justify-center">
            <div 
              className="sit-w-24 sit-h-24 sit-rounded-xl sit-flex sit-items-center sit-justify-center sit-overflow-hidden"
              style={{
                backgroundColor: theme.colors.primary,
                padding: '12px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
              }}
            >
              <img 
                src={getLogoUrl()}
                alt="Logo Preview"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  filter: 'brightness(0) invert(1)', // White logo on colored background
                }}
                onError={(e) => {
                  // Fallback to default logo on error
                  e.currentTarget.src = chrome.runtime.getURL(DEFAULT_THEME.logo);
                }}
              />
            </div>
          </div>

          {/* Upload Button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            style={{ display: 'none' }}
          />
          
          <button
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="sit-w-full sit-px-4 sit-py-2.5 sit-rounded-xl sit-text-sm sit-font-semibold sit-cursor-pointer sit-transition-all sit-duration-200 sit-border-0 sit-flex sit-items-center sit-justify-center sit-gap-2 sit-mb-2"
            style={{
              backgroundColor: theme.colors.primary,
              color: '#ffffff',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.primary;
              e.currentTarget.style.opacity = '0.9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.primary;
              e.currentTarget.style.opacity = '1';
            }}
          >
            <Upload size={16} strokeWidth={2} />
            <span style={{ color: '#ffffff' }}>Upload Logo</span>
          </button>

          {/* Reset Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleResetLogo();
            }}
            className="sit-w-full sit-px-4 sit-py-2 sit-rounded-xl sit-text-sm sit-font-medium sit-cursor-pointer sit-transition-all sit-duration-200 sit-border"
            style={{
              backgroundColor: '#ffffff',
              borderColor: theme.colors.border,
              color: theme.colors.textPrimary,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f9fafb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
            }}
          >
            Reset to Default Logo
          </button>

          <span style={{ 
            color: '#6b7280',
            fontSize: '12px',
            display: 'block',
            marginTop: '8px',
          }}>
            Recommended: PNG with transparent background, max 2MB
          </span>
        </div>
      )}

      {/* System Name Editing */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsSystemNameExpanded(!isSystemNameExpanded);
        }}
        className="sit-w-full sit-flex sit-items-center sit-justify-between sit-px-5 sit-py-3.5 sit-cursor-pointer sit-border-0 sit-transition-colors"
        style={{
          backgroundColor: 'transparent',
          borderBottom: '1px solid #f3f4f6',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#f9fafb';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <div className="sit-flex sit-items-center sit-gap-2">
          <Type size={16} strokeWidth={2} color="#6b7280" />
          <span style={{ 
            color: '#1f2937',
            fontWeight: '600',
            fontSize: '14px',
          }}>
            System Name
          </span>
        </div>
        <ChevronRight 
          size={16} 
          strokeWidth={2}
          color="#6b7280"
          style={{
            transform: isSystemNameExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      </button>

      {isSystemNameExpanded && (
        <div className="sit-px-5 sit-py-4 sit-border-b" style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: '#f9fafb' }}>
          <input
            type="text"
            value={theme.systemName}
            onChange={(e) => handleSystemNameChange(e.target.value)}
            placeholder="Enter system name"
            className="sit-w-full sit-px-4 sit-py-2.5 sit-rounded-xl sit-text-sm sit-border"
            style={{
              backgroundColor: '#ffffff',
              borderColor: theme.colors.border,
              color: theme.colors.textPrimary,
              outline: 'none',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = theme.colors.primary;
              e.target.style.boxShadow = `0 0 0 3px ${theme.colors.primary}20`;
            }}
            onBlur={(e) => {
              e.target.style.borderColor = theme.colors.border;
              e.target.style.boxShadow = 'none';
            }}
          />
          <span style={{ 
            color: '#6b7280',
            fontSize: '12px',
            display: 'block',
            marginTop: '8px',
          }}>
            This name appears throughout the interface
          </span>
        </div>
      )}

      {/* Color Customization */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsColorsExpanded(!isColorsExpanded);
        }}
        className="sit-w-full sit-flex sit-items-center sit-justify-between sit-px-5 sit-py-3.5 sit-cursor-pointer sit-border-0 sit-transition-colors"
        style={{
          backgroundColor: 'transparent',
          borderBottom: '1px solid #f3f4f6',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#f9fafb';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <div className="sit-flex sit-items-center sit-gap-2">
          <Palette size={16} strokeWidth={2} color="#6b7280" />
          <span style={{ 
            color: '#1f2937',
            fontWeight: '600',
            fontSize: '14px',
          }}>
            Color Customization
          </span>
        </div>
        <ChevronRight 
          size={16} 
          strokeWidth={2}
          color="#6b7280"
          style={{
            transform: isColorsExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      </button>

      {isColorsExpanded && (
        <div className="sit-px-4 sit-py-4 sit-border-b" style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: '#f9fafb' }}>
          {/* Predefined Color Themes */}
          <div className="sit-mb-6">
            <div className="sit-flex sit-items-center sit-gap-2 sit-mb-3">
              <Sparkles size={14} strokeWidth={2} color={theme.colors.textMuted} />
              <span style={{
                color: theme.colors.textPrimary,
                fontWeight: '600',
                fontSize: '13px',
              }}>
                Quick Themes
              </span>
            </div>
            <p style={{
              color: theme.colors.textMuted,
              fontSize: '12px',
              margin: '0 0 12px 0',
            }}>
              Choose a professionally designed color scheme
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '8px',
            }}>
              {PREDEFINED_THEMES.map((preset) => {
                const isActive = JSON.stringify(preset.colors) === JSON.stringify(theme.colors);
                return (
                  <button
                    key={preset.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      onThemeChange({
                        ...theme,
                        colors: preset.colors,
                      });
                    }}
                    className="sit-p-2.5 sit-rounded-lg sit-border sit-cursor-pointer sit-transition-all sit-duration-200"
                    style={{
                      backgroundColor: isActive ? theme.colors.primary + '15' : '#ffffff',
                      borderColor: isActive ? theme.colors.primary : theme.colors.border,
                      borderWidth: isActive ? '2px' : '1px',
                      minWidth: 0,
                      width: '100%',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                        e.currentTarget.style.borderColor = theme.colors.primary;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = '#ffffff';
                        e.currentTarget.style.borderColor = theme.colors.border;
                      }
                    }}
                  >
                    <div className="sit-flex sit-items-center sit-gap-2" style={{ minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        gap: '4px',
                        flexShrink: 0,
                      }}>
                        <div style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '3px',
                          backgroundColor: preset.colors.primary,
                          border: `1px solid ${theme.colors.border}`,
                        }} />
                        <div style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '3px',
                          backgroundColor: preset.colors.secondary,
                          border: `1px solid ${theme.colors.border}`,
                        }} />
                      </div>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: isActive ? '600' : '500',
                        color: theme.colors.textPrimary,
                        textAlign: 'left',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        minWidth: 0,
                      }}>
                        {preset.name}
                      </span>
                      {isActive && (
                        <span style={{
                          color: theme.colors.primary,
                          fontSize: '12px',
                          fontWeight: '600',
                          flexShrink: 0,
                        }}>
                          ✓
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Color Editor - Organized by Categories */}
          <div className="sit-mb-6">
            {/* Section Header - Clean Design */}
            <div className="sit-flex sit-items-center sit-gap-2 sit-mb-4">
              <Palette size={16} strokeWidth={2} color={theme.colors.textPrimary} />
              <span style={{
                color: theme.colors.textPrimary,
                fontWeight: '600',
                fontSize: '14px',
                letterSpacing: '-0.2px',
                lineHeight: '1.4',
              }}>
                Custom Colors
              </span>
            </div>

            {/* Color Categories - Improved Layout */}
            <div className="sit-flex sit-flex-col sit-gap-4">
              {Object.entries(colorCategories).map(([categoryKey, category]) => {
                const contrastWarning = (colorKey: string) => 
                  colorKey.startsWith('text') 
                    ? getContrastWarning(theme.colors[colorKey as keyof typeof theme.colors], theme.colors.background)
                    : null;

                return (
                  <div 
                    key={categoryKey} 
                    style={{
                      padding: '16px',
                      backgroundColor: '#ffffff',
                      borderRadius: '12px',
                      border: `1px solid ${theme.colors.border}`,
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    {/* Category Header - Title and Description Stacked */}
                    <div style={{
                      marginBottom: '16px',
                      paddingBottom: '12px',
                      borderBottom: `1px solid ${theme.colors.border}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}>
                      <h5 style={{
                        color: theme.colors.textPrimary,
                        fontWeight: '600',
                        fontSize: '13px',
                        margin: 0,
                        letterSpacing: '-0.1px',
                        lineHeight: '1.4',
                      }}>
                        {category.title}
                      </h5>
                      <p style={{
                        color: theme.colors.textMuted,
                        fontSize: '11px',
                        margin: 0,
                        lineHeight: '1.5',
                      }}>
                        {category.description}
                      </p>
                    </div>

                    {/* Color Items - Grid Layout for Better Alignment */}
                    <div className="sit-flex sit-flex-col sit-gap-4">
                      {category.colors.map((colorKey) => {
                        const warning = contrastWarning(colorKey);

                        return (
                          <div 
                            key={colorKey}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '12px',
                              padding: '12px',
                              backgroundColor: theme.colors.surface,
                              borderRadius: '8px',
                              border: `1px solid ${theme.colors.border}`,
                            }}
                          >
                            {/* Color Swatch - Aligned Top */}
                            <div style={{
                              flexShrink: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '8px',
                            }}>
                              <input
                                type="color"
                                value={theme.colors[colorKey]}
                                onChange={(e) => handleColorChange(colorKey, e.target.value)}
                                style={{
                                  width: '52px',
                                  height: '52px',
                                  border: `2px solid ${theme.colors.border}`,
                                  borderRadius: '10px',
                                  cursor: 'pointer',
                                  padding: '0',
                                  backgroundColor: theme.colors[colorKey],
                                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                                  transition: 'all 0.2s ease',
                                }}
                                title="Click to pick color"
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.boxShadow = `0 4px 8px rgba(0, 0, 0, 0.15)`;
                                  e.currentTarget.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                                  e.currentTarget.style.transform = 'scale(1)';
                                }}
                              />
                              {warning && (
                                <div title={warning} style={{ flexShrink: 0 }}>
                                  <AlertCircle 
                                    size={14} 
                                    strokeWidth={2} 
                                    color="#f59e0b"
                                  />
                                </div>
                              )}
                            </div>

                            {/* Color Details - Proper Alignment */}
                            <div style={{
                              flex: 1,
                              minWidth: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                            }}>
                              {/* Label Row */}
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '8px',
                              }}>
                                <label 
                                  htmlFor={`color-${colorKey}`}
                                  style={{ 
                                    color: theme.colors.textPrimary,
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    lineHeight: '1.4',
                                  }}
                                >
                                  {colorLabels[colorKey]}
                                </label>
                              </div>

                              {/* Description */}
                              <p style={{
                                color: theme.colors.textMuted,
                                fontSize: '11px',
                                margin: 0,
                                lineHeight: '1.5',
                              }}>
                                {colorDescriptions[colorKey]}
                              </p>

                              {/* Hex Input - Full Width Aligned */}
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}>
                                <input
                                  id={`color-${colorKey}`}
                                  type="text"
                                  value={theme.colors[colorKey]}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (value.match(/^#[0-9A-Fa-f]{0,6}$/) || value === '') {
                                      handleColorChange(colorKey, value);
                                    }
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: `1px solid ${theme.colors.border}`,
                                    backgroundColor: '#ffffff',
                                    color: theme.colors.textPrimary,
                                    fontFamily: 'monospace',
                                    fontSize: '12px',
                                    fontWeight: '500',
                                    outline: 'none',
                                    transition: 'all 0.2s ease',
                                    minWidth: 0,
                                  }}
                                  placeholder="#000000"
                                  onFocus={(e) => {
                                    e.target.style.borderColor = theme.colors.primary;
                                    e.target.style.boxShadow = `0 0 0 3px ${theme.colors.primary}15`;
                                  }}
                                  onBlur={(e) => {
                                    e.target.style.borderColor = theme.colors.border;
                                    e.target.style.boxShadow = 'none';
                                    if (!e.target.value.match(/^#[0-9A-Fa-f]{6}$/)) {
                                      e.target.value = theme.colors[colorKey];
                                    }
                                  }}
                                />
                              </div>

                              {/* Warning Message */}
                              {warning && (
                                <div style={{
                                  padding: '8px 12px',
                                  backgroundColor: '#fef3c7',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  color: '#92400e',
                                  lineHeight: '1.4',
                                  border: '1px solid #fbbf24',
                                }}>
                                  ⚠️ {warning}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reset Colors Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onThemeChange({
                ...theme,
                colors: DEFAULT_THEME.colors,
              });
            }}
            className="sit-w-full sit-px-4 sit-py-2.5 sit-rounded-xl sit-text-sm sit-font-medium sit-cursor-pointer sit-transition-all sit-duration-200 sit-border"
            style={{
              backgroundColor: '#ffffff',
              borderColor: theme.colors.border,
              color: theme.colors.textPrimary,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f9fafb';
              e.currentTarget.style.borderColor = theme.colors.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.borderColor = theme.colors.border;
            }}
          >
            Reset All Colors to Default
          </button>
        </div>
      )}

      {/* Reset All Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm('Are you sure you want to reset all theme settings to default? This cannot be undone.')) {
        onReset();
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
          }
        }}
        className="sit-w-full sit-flex sit-items-center sit-justify-center sit-gap-2 sit-px-5 sit-py-3.5 sit-cursor-pointer sit-border-0 sit-transition-colors"
        style={{
          backgroundColor: 'transparent',
          borderBottom: '1px solid #f3f4f6',
          borderTop: '2px solid #f3f4f6',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#fef2f2';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <RefreshCw size={16} strokeWidth={2} stroke="#dc2626" style={{ color: '#dc2626' }} color="#dc2626" />
        <span style={{ 
          color: '#dc2626',
          fontWeight: '600',
          fontSize: '14px',
        }}>
          Reset All to Default Theme
        </span>
      </button>
    </div>
  );
};

export default ThemeSettings;

