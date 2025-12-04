import React from 'react';

interface LoadingScreenProps {
  message?: string;
  progress?: {
    stage: string;
    progress: number;
    message: string;
  };
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ progress }) => {
  // Normalize progress value to always be between 0 and 100
  const safeProgress = Math.max(0, Math.min(100, progress?.progress ?? 0));

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
              background: 'linear-gradient(135deg, #002b5c 0%, #003d7a 100%)',
              boxShadow: '0 10px 30px rgba(0, 43, 92, 0.3)',
              animation: 'sit-breathe 2s ease-in-out infinite',
            }}
          >
            <img 
              src={chrome.runtime.getURL("icons/SERVICEITLOGO.png")} 
              alt="ServiceIT Logo" 
              className="sit-w-20 sit-h-20"
              style={{
                filter: 'brightness(0) invert(1)',
              }}
            />
          </div>
        </div>
        
        {/* Title and Status */}
        <div className="sit-text-center sit-space-y-4">
          <h2 
            className="sit-text-3xl sit-font-bold sit-tracking-tight"
            style={{
              color: '#002b5c',
            }}
          >
            Service IT Plus
          </h2>
          
          {/* AI Badge */}
          <div className="sit-flex sit-items-center sit-justify-center sit-gap-2">
            <div 
              className="sit-px-4 sit-py-1.5 sit-rounded-full sit-text-sm sit-font-semibold"
              style={{
                background: 'linear-gradient(135deg, #ff9900 0%, #ffb347 100%)',
                color: '#ffffff',
                boxShadow: '0 4px 12px rgba(255, 153, 0, 0.3)',
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
                background: 'linear-gradient(135deg, #002b5c 0%, #004d99 100%)',
                animation: 'sit-loading-bounce 0.6s ease-in-out infinite',
                animationDelay: '0s',
              }}
            ></div>
            <div 
              className="sit-w-2.5 sit-h-2.5 sit-rounded-full"
              style={{ 
                background: 'linear-gradient(135deg, #002b5c 0%, #004d99 100%)',
                animation: 'sit-loading-bounce 0.6s ease-in-out infinite',
                animationDelay: '0.2s',
              }}
            ></div>
            <div 
              className="sit-w-2.5 sit-h-2.5 sit-rounded-full"
              style={{ 
                background: 'linear-gradient(135deg, #002b5c 0%, #004d99 100%)',
                animation: 'sit-loading-bounce 0.6s ease-in-out infinite',
                animationDelay: '0.4s',
              }}
            ></div>
          </div>
        </div>
        
        {/* Status Message */}
        <p 
          className="sit-text-sm sit-font-medium sit-text-center sit-max-w-xs"
          style={{ color: '#6b7280' }}
        >
          {progress?.message || 'Identifying user and initializing assistant...'}
        </p>

        {/* Progress Bar */}
        <div className="sit-w-full sit-h-1.5 sit-bg-gray-200 sit-rounded-full sit-overflow-hidden">
          <div 
            className="sit-h-full sit-rounded-full sit-transition-all sit-duration-300"
            style={{
              background: safeProgress === 100 
                ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                : 'linear-gradient(90deg, #002b5c 0%, #ff9900 50%, #002b5c 100%)',
              backgroundSize: safeProgress === 100 ? '100% 100%' : '200% 100%',
              animation: safeProgress === 100 ? 'none' : 'sit-progress-slide 1.5s ease-in-out infinite',
              width: `${safeProgress}%`,
            }}
          ></div>
        </div>
        
        {/* Progress Percentage */}
        {progress && (
          <p 
            className="sit-text-xs sit-font-medium sit-text-center"
            style={{ color: '#9ca3af', marginTop: '8px' }}
          >
            {safeProgress}%
          </p>
        )}
      </div>
    </div>
  );
};

export default LoadingScreen;

