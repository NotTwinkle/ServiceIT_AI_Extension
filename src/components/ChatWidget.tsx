import React, { useState, useEffect, useRef } from 'react';
import { X, Send } from 'lucide-react';

interface UserInfo {
  recId?: string;
  loginId: string;
  email?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  team?: string;
  department?: string;
  role?: string;
  roles?: string[];
  teams?: string[];
  location?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatWidgetProps {
  currentUser?: UserInfo | null;
}

const formatTitleCase = (value: string): string => {
  return value
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const buildThinkingStatusSteps = (input: string, ticketId: string | null): string[] => {
  const steps: string[] = ['🤔 Interpreting your request'];
  const trimmed = input.trim();

  if (!trimmed) {
    steps.push('🔍 Checking Ivanti for details');
    steps.push('🧠 Formulating a helpful response');
    return steps;
  }

  const lower = trimmed.toLowerCase();

  if (ticketId && (lower.includes('this ticket') || lower.includes('incident') || lower.includes('update') || lower.includes('status'))) {
    steps.push(`🛠️ Reviewing ticket #${ticketId} in Ivanti`);
  } else if (lower.includes('create') && lower.includes('incident')) {
    steps.push('🛠️ Drafting the new incident details');
  } else if ((lower.includes('find') && lower.includes('user')) || lower.includes('employee')) {
    const match = trimmed.match(/["']([^"']+)["']/);
    if (match && match[1]) {
      steps.push(`🔎 Searching Ivanti for ${formatTitleCase(match[1])}`);
    } else {
      const words = trimmed.split(/\s+/);
      const possibleName = words.slice(-3).join(' ');
      const looksLikeName = possibleName.split(' ').filter(Boolean).every(word => /^[a-zA-Z][a-zA-Z'.-]*$/.test(word));
      steps.push(
        looksLikeName
          ? `🔎 Searching Ivanti for ${formatTitleCase(possibleName)}`
          : '🔎 Searching Ivanti for that user'
      );
    }
  } else if (lower.includes('find') && (lower.includes('ticket') || lower.includes('incident'))) {
    steps.push('📂 Looking up matching incidents in Ivanti');
  } else if (lower.includes('summary') || lower.includes('explain')) {
    steps.push('🧠 Summarizing what I know');
  } else {
    steps.push('🔍 Checking Ivanti for relevant data');
  }

  steps.push('✨ Formulating a helpful response');
  return steps;
};

const ChatWidget: React.FC<ChatWidgetProps> = ({ currentUser }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [thinkingStepIndex, setThinkingStepIndex] = useState(0);
  const thinkingIntervalRef = useRef<number | null>(null);
  const [isHidden, setIsHidden] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [widgetWidth, setWidgetWidth] = useState(384); // Default: 384px (w-96)
 
  // Load hidden state and widget width from storage on mount
  useEffect(() => {
    chrome.storage.local.get(['aiAssistantHidden', 'chatWidgetWidth'], (result) => {
      if (result.aiAssistantHidden === true) {
        setIsHidden(true);
      }
      if (result.chatWidgetWidth) {
        setWidgetWidth(result.chatWidgetWidth);
      }
    });
  }, []);

  // Save widget width to storage when it changes
  useEffect(() => {
    if (widgetWidth !== 384) {
      chrome.storage.local.set({ chatWidgetWidth: widgetWidth });
    }
  }, [widgetWidth]);

  // Extract RecId from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const recId = params.get('RecId');
    setTicketId(recId);
    
    // Log user info for debugging (including RecId)
    if (currentUser) {
      console.log('🔐 ServiceIT: Current User Session:', {
        recId: currentUser.recId,
        loginId: currentUser.loginId,
        fullName: currentUser.fullName,
        location: currentUser.location,
        team: currentUser.team,
        department: currentUser.department,
        role: currentUser.role
      });
    }
    
    // Create personalized greeting
    const userName = currentUser?.fullName || currentUser?.loginId || 'there';
    const userContext = currentUser?.team ? ` from ${currentUser.team}` : '';
    
    // Add welcome message with user's name
    if (recId) {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: `Hello ${userName}${userContext}! 👋 I'm here to assist you with Ticket #${recId}. How can I help you today?`,
        timestamp: new Date(),
      }]);
    } else {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: `Hello ${userName}${userContext}! 👋 I'm here to assist you. Please open a ticket to get started.`,
        timestamp: new Date(),
      }]);
    }
  }, [currentUser]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!isLoading || thinkingSteps.length <= 1) {
      if (thinkingIntervalRef.current) {
        window.clearInterval(thinkingIntervalRef.current);
        thinkingIntervalRef.current = null;
      }
      setThinkingStepIndex(prev => (isLoading ? prev : 0));
      return;
    }

    if (thinkingIntervalRef.current) {
      window.clearInterval(thinkingIntervalRef.current);
    }

    thinkingIntervalRef.current = window.setInterval(() => {
      setThinkingStepIndex(prev => {
        if (prev >= thinkingSteps.length - 1) {
          if (thinkingIntervalRef.current) {
            window.clearInterval(thinkingIntervalRef.current);
            thinkingIntervalRef.current = null;
          }
          return prev;
        }
        return prev + 1;
      });
    }, 1400);

    return () => {
      if (thinkingIntervalRef.current) {
        window.clearInterval(thinkingIntervalRef.current);
        thinkingIntervalRef.current = null;
      }
    };
  }, [isLoading, thinkingSteps]);

  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    // Build thinking steps BEFORE setting loading state
    const steps = buildThinkingStatusSteps(userMessage.content, ticketId);
    
    // Add user message first
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    
    // Set loading state and thinking steps together
    setIsLoading(true);
    setThinkingSteps(steps);
    setThinkingStepIndex(0);
    
    // Scroll to bottom to show thinking indicator
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      // Send message to background script (which handles AI processing)
      const response = await chrome.runtime.sendMessage({
        type: 'SEND_MESSAGE',
        message: userMessage.content,
        ticketId: ticketId,
        currentUser: currentUser, // Pass current user context
        timestamp: userMessage.timestamp.toISOString(),
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to send message');
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message || 'I received your message.',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      // Scroll to bottom after adding assistant message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      // TODO: Handle any actions returned by AI
      if (response.actions && response.actions.length > 0) {
        console.log('AI suggested actions:', response.actions);
      }

    } catch (error: any) {
      console.error('Error sending message:', error);
      
      // Show detailed error message for debugging
      const errorText = error?.message || error?.toString() || 'Unknown error';
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `⚠️ AI service error: ${errorText}\n\nPlease check:\n1. Your Gemini API key is valid\n2. Your API key has access to the selected model\n3. Check the browser console for detailed logs`,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      if (thinkingIntervalRef.current) {
        window.clearInterval(thinkingIntervalRef.current);
        thinkingIntervalRef.current = null;
      }
      setThinkingSteps([]);
      setThinkingStepIndex(0);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleChat = () => {
    setIsOpen(!isOpen);
  };

  const handleHide = () => {
    setIsHidden(true);
    setIsOpen(false);
    // Persist hidden state
    chrome.storage.local.set({ aiAssistantHidden: true });
  };

  const handleShow = () => {
    setIsHidden(false);
    // Clear hidden state
    chrome.storage.local.remove(['aiAssistantHidden']);
  };

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt + A to toggle chat (when not hidden)
      if (e.altKey && e.key === 'a' && !isHidden) {
        e.preventDefault();
        toggleChat();
      }
      // Escape to close chat or hide assistant
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isHidden]);

  const exportChat = () => {
    try {
      if (!messages || messages.length === 0) {
        alert('There is no conversation to export yet.');
        return;
      }

      const userLabel =
        currentUser?.fullName ||
        currentUser?.loginId ||
        'Unknown User';

      const headerLines: string[] = [
        'Service IT Plus AI - Chat Transcript',
        `User: ${userLabel}`,
        ticketId ? `Ticket: ${ticketId}` : 'Ticket: None',
        `Exported: ${new Date().toISOString()}`,
        '',
      ];

      const bodyLines = messages.map((m) => {
        const time = m.timestamp instanceof Date
          ? m.timestamp.toLocaleString()
          : new Date(m.timestamp).toLocaleString();
        const role = m.role === 'user' ? 'User' : 'Assistant';
        return `[${time}] ${role}: ${m.content}`;
      });

      const content = [...headerLines, ...bodyLines].join('\n');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.download = `serviceit-ai-chat-${safeTimestamp}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting chat transcript:', error);
      alert('Sorry, there was a problem exporting the chat. Please try again.');
    }
  };

  return (
    <>
      {/* Floating Trigger Button - Always visible when chat is closed */}
      {!isOpen && (
        <>
          {/* When NOT hidden: Show main button with text and X on hover */}
          {!isHidden && (
        <div 
              className="sit-fixed sit-bottom-10 sit-right-6 sit-z-[2147483646] sit-group sit-flex sit-items-center sit-gap-3"
          style={{ zIndex: 2147483646 }}
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
            >
              {/* AI Assistant Text - Only shows on hover, with background */}
          <div 
                className="sit-transition-all sit-duration-300 sit-pointer-events-none sit-flex sit-items-center sit-gap-1"
                style={{
                  opacity: isHovering ? 1 : 0,
                  transform: isHovering ? 'translateX(0)' : 'translateX(8px)',
                  padding: '6px 12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  backdropFilter: 'blur(8px)',
                  borderRadius: '8px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                  border: '1px solid rgba(0, 43, 92, 0.1)',
                }}
              >
                <span 
                  style={{ 
                    color: '#002b5c',
                    fontSize: '18px',
                    fontWeight: '900',
                    letterSpacing: '0.3px',
                    WebkitFontSmoothing: 'antialiased',
                    MozOsxFontSmoothing: 'grayscale',
                  }}
                >
                  AI
                </span>
                <span 
            style={{
                    color: '#ff9900',
                    fontSize: '18px',
                    fontWeight: '900',
                    letterSpacing: '0.3px',
                    WebkitFontSmoothing: 'antialiased',
                    MozOsxFontSmoothing: 'grayscale',
                  }}
                >
                  Assistant
                </span>
          </div>

              {/* Hide Button - Only shows on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleHide();
                }}
                className="sit-transition-all sit-duration-300 sit-cursor-pointer sit-flex sit-items-center sit-justify-center sit-pointer-events-auto sit-border-0 sit-rounded-full"
                style={{
                  width: '32px',
                  height: '32px',
                  color: 'white',
                  backgroundColor: '#002b5c',
                  opacity: isHovering ? 1 : 0,
                  transform: isHovering ? 'scale(1)' : 'scale(0.8)',
                  visibility: isHovering ? 'visible' : 'hidden',
                  boxShadow: '0 2px 8px rgba(0, 43, 92, 0.3)',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#001a3d';
                  e.currentTarget.style.transform = 'scale(1.1)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 43, 92, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#002b5c';
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 43, 92, 0.3)';
                }}
                aria-label="Hide AI Assistant"
                title="Hide Assistant"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>

              {/* Main Chat Button */}
          <button
            onClick={toggleChat}
            className="sit-group sit-w-20 sit-h-20 sit-rounded-full sit-cursor-pointer sit-transition-all sit-duration-300 sit-flex sit-items-center sit-justify-center sit-pointer-events-auto sit-border-0 sit-overflow-hidden sit-relative"
            style={{
              backgroundColor: '#002b5c',
              boxShadow: '0 6px 24px rgba(0, 43, 92, 0.5)',
              padding: '12px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 43, 92, 0.7)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 6px 24px rgba(0, 43, 92, 0.5)';
            }}
                aria-label="Open AI Assistant"
          >
            {/* Pulse Effect */}
            <div 
              className="sit-absolute sit-inset-0 sit-rounded-full sit-animate-pulse-ring"
              style={{
                border: '2px solid rgba(255, 153, 0, 0.5)',
                zIndex: -1,
              }}
            />
            
            <img 
              src={chrome.runtime.getURL('icons/SERVICEITLOGO.png')}
              alt="Chat"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
                filter: 'brightness(0) invert(1)'
              }}
            />
          </button>
        </div>
          )}

          {/* When Hidden: Only show chevron button (like side panel) */}
          {isHidden && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleShow();
              }}
              className="sit-fixed sit-bottom-10 sit-right-6 sit-z-[2147483646] sit-transition-all sit-duration-300 sit-cursor-pointer sit-flex sit-items-center sit-justify-center sit-pointer-events-auto sit-border-0 sit-rounded-full"
              style={{
                width: '40px',
                height: '40px',
                color: 'white',
                backgroundColor: '#002b5c',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#002b5c';
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#002b5c';
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
              }}
              aria-label="Show AI Assistant"
              title="Show Assistant"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#666"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}
        </>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div
          className="sit-fixed sit-bottom-5 sit-right-5 sit-rounded-2xl sit-flex sit-flex-col sit-overflow-hidden sit-pointer-events-auto"
          style={{
            width: `${widgetWidth}px`,
            height: '600px',
            backgroundColor: '#ffffff',
            zIndex: 2147483646,
            boxShadow: '0 12px 48px rgba(0, 0, 0, 0.15)',
            border: '1px solid rgba(0, 0, 0, 0.08)',
            minWidth: '300px',
            maxWidth: `${Math.min(window.innerWidth - 40, 800)}px`,
          }}
        >
          {/* Header */}
          <div
            className="sit-px-5 sit-py-4 sit-flex sit-items-center sit-justify-between sit-border-0"
            style={{ 
              backgroundColor: '#002b5c',
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
                  src={chrome.runtime.getURL('icons/SERVICEITLOGO.png')}
                  alt="Service IT Plus"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
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
                  Service IT Plus
                </span>
                {ticketId ? (
                  <span style={{ 
                    color: '#ff9900',
                    fontSize: '12px',
                    fontWeight: '500',
                    lineHeight: '1.3',
                    margin: '0',
                  }}>
                    Ticket #{ticketId}
                  </span>
                ) : (
                  <span style={{ 
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontSize: '11px',
                    lineHeight: '1.3',
                    margin: '0',
                  }}>
                    Always here to help
                  </span>
                )}
              </div>
            </div>
            <div className="sit-flex sit-items-center sit-gap-2">
              {/* Width Control Buttons */}
              <div className="sit-flex sit-items-center sit-gap-1" style={{ marginRight: '4px' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setWidgetWidth(prev => Math.max(300, prev - 50));
                  }}
                  className="sit-cursor-pointer sit-border-0 sit-rounded-lg sit-flex sit-items-center sit-justify-center"
                  style={{
                    width: '24px',
                    height: '24px',
                    backgroundColor: 'rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: '16px',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
                  }}
                  title="Decrease width"
                  aria-label="Decrease width"
                >
                  −
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setWidgetWidth(prev => Math.min(window.innerWidth - 40, 800, prev + 50));
                  }}
                  className="sit-cursor-pointer sit-border-0 sit-rounded-lg sit-flex sit-items-center sit-justify-center"
                  style={{
                    width: '24px',
                    height: '24px',
                    backgroundColor: 'rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: '16px',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
                  }}
                  title="Increase width"
                  aria-label="Increase width"
                >
                  +
                </button>
              </div>
              <button
                onClick={exportChat}
                className="sit-h-8 sit-px-2 sit-rounded-lg sit-text-xs sit-font-medium sit-cursor-pointer sit-transition-all sit-duration-200 sit-border-0"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
                }}
              >
                Export
              </button>
              <button
                onClick={toggleChat}
                className="sit-w-8 sit-h-8 sit-rounded-lg sit-flex sit-items-center sit-justify-center sit-cursor-pointer sit-transition-all sit-duration-200 sit-border-0"
                style={{ 
                  backgroundColor: 'transparent',
                  color: '#ffffff',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div 
            className="sit-flex-1 sit-overflow-y-auto sit-px-4 sit-py-6"
            style={{ 
              backgroundColor: '#f7f8fa',
              position: 'relative', // For absolute positioning of background
            }}
          >
            {/* Background Logo */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '180px',
                height: '180px',
                opacity: '0.05', // Very subtle watermark
                pointerEvents: 'none', // Allow clicking through
                zIndex: 0,
                backgroundImage: `url(${chrome.runtime.getURL('icons/SERVICEITLOGO.png')})`,
                backgroundSize: 'contain',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                filter: 'grayscale(100%)', // Optional: make it grayscale for a watermark feel
              }}
            />

            <div className="sit-flex sit-flex-col sit-gap-4" style={{ position: 'relative', zIndex: 1 }}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className="sit-flex sit-flex-col sit-gap-1 sit-fade-in-up"
                  style={{
                    alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    className="sit-px-4 sit-py-3 sit-rounded-2xl sit-max-w-xs sit-border-0"
                    style={message.role === 'user' ? { 
                      backgroundColor: '#002b5c',
                      color: '#ffffff !important',
                      borderBottomRightRadius: '4px',
                      boxShadow: '0 4px 12px rgba(0, 43, 92, 0.15)',
                    } : {
                      backgroundColor: '#ffffff',
                      color: '#1f2937',
                      border: '1px solid #e5e7eb',
                      borderBottomLeftRadius: '4px',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <p style={{ 
                      margin: '0',
                      fontSize: '14px',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: message.role === 'user' ? '#ffffff' : '#1f2937',
                      fontWeight: message.role === 'user' ? 400 : 400,
                    }}>
                      {message.content}
                    </p>
                  </div>
                  <span style={{ 
                    fontSize: '11px',
                    color: '#9ca3af',
                    margin: '0',
                    paddingLeft: message.role === 'user' ? '0' : '8px',
                    paddingRight: message.role === 'user' ? '8px' : '0',
                  }}>
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}

              {/* Thinking Indicator - Shows after user message when loading */}
              {isLoading && thinkingSteps.length > 0 && (
                <div className="sit-flex sit-flex-col sit-gap-1 sit-fade-in-up" style={{ alignItems: 'flex-start' }}>
                  <div
                    className="sit-flex sit-items-center sit-gap-3 sit-py-3 sit-px-4 sit-rounded-2xl sit-text-sm sit-shadow-md"
                    style={{
                      backgroundColor: '#ffffff',
                      color: '#1f2937 !important',
                      border: '1px solid #e5e7eb',
                      borderBottomLeftRadius: '4px',
                      maxWidth: '85%',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                    }}
                  >
                    <div
                      className="sit-flex sit-items-center sit-justify-center sit-rounded-full sit-flex-shrink-0"
                      style={{
                        width: '28px',
                        height: '28px',
                        background: 'rgba(0, 43, 92, 0.1)',
                        border: '1px solid rgba(0, 43, 92, 0.2)',
                      }}
                    >
                      <div
                        className="sit-rounded-full"
                        style={{
                          width: '14px',
                          height: '14px',
                          border: '2.5px solid rgba(0, 43, 92, 0.2)',
                          borderTopColor: '#002b5c',
                          animation: 'sit-spin 0.9s linear infinite',
                          borderRadius: '9999px'
                        }}
                      />
                    </div>
                    <div className="sit-flex sit-flex-col sit-gap-1.5" style={{ flex: 1 }}>
                      <span style={{ 
                        fontWeight: 500, 
                        fontSize: '14px',
                        color: '#1f2937 !important',
                        lineHeight: '1.5',
                      }}>
                        {thinkingSteps[Math.min(thinkingStepIndex, thinkingSteps.length - 1)]}
                      </span>
                      {thinkingSteps[thinkingStepIndex + 1] && thinkingStepIndex < thinkingSteps.length - 1 && (
                        <span style={{ 
                          fontSize: '12px', 
                          color: '#6b7280 !important', 
                          fontWeight: 400,
                          lineHeight: '1.4',
                        }}>
                          Next: {thinkingSteps[thinkingStepIndex + 1]}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ 
                    fontSize: '11px',
                    color: '#9ca3af',
                    margin: '0',
                    paddingLeft: '8px',
                  }}>
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}

              {/* Fallback Typing Indicator - Only if no thinking steps */}
              {isLoading && thinkingSteps.length === 0 && (
                <div className="sit-flex sit-flex-col sit-gap-1 sit-fade-in-up" style={{ alignItems: 'flex-start' }}>
                  <div 
                    className="sit-px-4 sit-py-3 sit-rounded-2xl sit-flex sit-items-center sit-gap-2 sit-border-0"
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderBottomLeftRadius: '4px',
                      width: 'fit-content',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <div className="sit-flex sit-gap-1">
                      <span className="sit-animate-bounce" style={{
                        width: '6px',
                        height: '6px',
                        backgroundColor: '#ff9900',
                        borderRadius: '50%',
                        display: 'inline-block',
                        animationDelay: '0ms',
                      }}></span>
                      <span className="sit-animate-bounce" style={{
                        width: '6px',
                        height: '6px',
                        backgroundColor: '#ff9900',
                        borderRadius: '50%',
                        display: 'inline-block',
                        animationDelay: '150ms',
                      }}></span>
                      <span className="sit-animate-bounce" style={{
                        width: '6px',
                        height: '6px',
                        backgroundColor: '#ff9900',
                        borderRadius: '50%',
                        display: 'inline-block',
                        animationDelay: '300ms',
                      }}></span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Area */}
          <div 
            className="sit-px-4 sit-py-4 sit-border-0"
            style={{ 
              backgroundColor: '#ffffff',
              borderTop: '1px solid #e5e7eb',
            }}
          >
            <div className="sit-flex sit-gap-2 sit-items-center">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type a message..."
                disabled={isLoading}
                className="sit-flex-1 sit-px-4 sit-py-3 sit-rounded-xl sit-border sit-transition-all sit-duration-200"
                style={{ 
                  borderColor: '#e5e7eb',
                  backgroundColor: '#ffffff',
                  fontSize: '14px',
                  color: '#1f2937',
                  outline: 'none',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#002b5c';
                  e.target.style.boxShadow = '0 0 0 3px rgba(0, 43, 92, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#e5e7eb';
                  e.target.style.boxShadow = 'none';
                }}
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !inputValue.trim()}
                className="sit-w-10 sit-h-10 sit-rounded-xl sit-flex sit-items-center sit-justify-center sit-cursor-pointer sit-transition-all sit-duration-200 sit-border-0"
                style={{ 
                  backgroundColor: inputValue.trim() && !isLoading ? '#ff9900' : '#e5e7eb',
                  color: inputValue.trim() && !isLoading ? '#ffffff' : '#9ca3af',
                  opacity: isLoading ? '0.6' : '1',
                  cursor: (!inputValue.trim() || isLoading) ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (inputValue.trim() && !isLoading) {
                    e.currentTarget.style.backgroundColor = '#e68a00';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (inputValue.trim() && !isLoading) {
                    e.currentTarget.style.backgroundColor = '#ff9900';
                    e.currentTarget.style.transform = 'scale(1)';
                  }
                }}
              >
                <Send size={18} strokeWidth={2} />
              </button>
            </div>
            <p style={{
              margin: '8px 0 0 0',
              fontSize: '11px',
              color: '#9ca3af',
              textAlign: 'left',
            }}>
              Powered by Service IT+ AI
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatWidget;
