import React, { useId } from 'react';

interface SparkEmblemProps {
  size?: number;
  streaming?: boolean;
  className?: string;
}

/**
 * Hazel 2D feminine character portrait emblem (long blue wavy hair, expressive
 * winged-lash blue eyes, fitted sweetheart top with bust contour) used across
 * headers, assistant message turns, and Live overlay.
 */
export const SparkEmblem: React.FC<SparkEmblemProps> = ({
  size = 24,
  streaming = false,
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const clipId = `hazelIconClip-${uid}`;
  const hairGradId = `hazelIconHair-${uid}`;
  const bgGradId = `hazelIconBg-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={`${streaming ? 'animate-spark-stream' : ''} ${className}`.trim()}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="24" cy="24" r="22" />
        </clipPath>
        <linearGradient id={bgGradId} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#DBEAFE" />
          <stop offset="100%" stopColor="#EFF6FF" />
        </linearGradient>
        <linearGradient id={hairGradId} x1="24" y1="5" x2="24" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B74E4" />
          <stop offset="100%" stopColor="#1A3A8A" />
        </linearGradient>
      </defs>

      <circle cx="24" cy="24" r="22" fill={`url(#${bgGradId})`} />

      <g clipPath={`url(#${clipId})`}>
        {/* Flowing back hair */}
        <path
          d="M10.5 19 C8 26.5, 8 36, 11.5 44 L36.5 44 C40 36, 40 26.5, 37.5 19 C35.5 9.5, 30 5.5, 24 5.5 C18 5.5, 12.5 9.5, 10.5 19 Z"
          fill="#193682"
          stroke="#152447"
          strokeWidth="1.25"
        />

        {/* Slender arms */}
        <path
          d="M14 33.5 C11 36.5, 10 41, 11 46.5 L15 46.5 C14.5 42, 15 38.5, 16 36 Z"
          fill="#FCE0CD"
          stroke="#3B2A24"
          strokeWidth="1.15"
        />
        <path
          d="M34 33.5 C37 36.5, 38 41, 37 46.5 L33 46.5 C33.5 42, 33 38.5, 32 36 Z"
          fill="#FCE0CD"
          stroke="#3B2A24"
          strokeWidth="1.15"
        />

        {/* Slender neck & upper chest skin */}
        <path
          d="M21.4 27.5 L21.4 32 C19.5 32.8, 16 33.2, 14 34 L14 40 L34 40 L34 34 C32 33.2, 28.5 32.8, 26.6 32 L26.6 27.5 Z"
          fill="#FCE2D0"
          stroke="#3B2A24"
          strokeWidth="1.15"
          strokeLinejoin="round"
        />
        {/* Subtle upper chest cleavage shadow */}
        <path d="M24 35.5 L24 37.8" stroke="#C88B72" strokeWidth="0.9" strokeLinecap="round" opacity="0.7" />

        {/* Fitted sweetheart top with pronounced bust & slim waist silhouette */}
        <path
          d="M14 33.8 C17 32.4, 19.2 33, 21 35 C22.3 36.5, 23.3 37.4, 24 37.4 C24.7 37.4, 25.7 36.5, 27 35 C28.8 33, 31 32.4, 34 33.8 L35.2 37.5 C35.8 40.5, 34.8 43.2, 32.2 46.5 L15.8 46.5 C13.2 43.2, 12.2 40.5, 12.8 37.5 Z"
          fill="#FFFFFF"
          stroke="#24304A"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        {/* Blue neckline trim */}
        <path
          d="M14.6 33.8 C17.2 32.6, 19.3 33.2, 21 35.1 C22.3 36.6, 23.3 37.5, 24 37.5 C24.7 37.5, 25.7 36.6, 27 35.1 C28.7 33.2, 30.8 32.6, 33.4 33.8"
          fill="none"
          stroke="#3B6FD8"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        {/* Bust cel-shading & curved underbust contour lines */}
        <path
          d="M13.8 40.5 C15 44.2, 20.6 44.8, 23.5 41.6 C21.2 43.3, 16.8 43.4, 14.4 41.2 Z"
          fill="#CBD9EE"
        />
        <path
          d="M34.2 40.5 C33 44.2, 27.4 44.8, 24.5 41.6 C26.8 43.3, 31.2 43.4, 33.6 41.2 Z"
          fill="#CBD9EE"
        />
        <path
          d="M14 40.6 C15.2 44.2, 20.8 44.5, 23.5 41.4"
          fill="none"
          stroke="#24304A"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M34 40.6 C32.8 44.2, 27.2 44.5, 24.5 41.4"
          fill="none"
          stroke="#24304A"
          strokeWidth="1.2"
          strokeLinecap="round"
        />

        {/* Delicate oval/heart feminine face */}
        <path
          d="M15 18 C15 11.5, 18.6 8.5, 24 8.5 C29.4 8.5, 33 11.5, 33 18 C33 23.8, 29.8 28.4, 24 29.5 C18.2 28.4, 15 23.8, 15 18 Z"
          fill="#FCE5D5"
          stroke="#3B2A24"
          strokeWidth="1.3"
        />

        {/* Warm rose cheek blush */}
        <ellipse cx="18" cy="23.4" rx="1.9" ry="0.95" fill="#F88FA1" opacity="0.52" />
        <ellipse cx="30" cy="23.4" rx="1.9" ry="0.95" fill="#F88FA1" opacity="0.52" />

        {/* Blue Anime Eyes with winged feminine lashes */}
        <ellipse cx="19.5" cy="20.4" rx="2.15" ry="2.45" fill="#1E40AF" />
        <circle cx="18.9" cy="19.5" r="0.85" fill="#FFFFFF" />
        <path d="M16.5 18.8 Q19.5 16.9 21.8 18.8" stroke="#1E2538" strokeWidth="1.45" strokeLinecap="round" />
        <path d="M16.5 18.7 L15.3 17.6" stroke="#1E2538" strokeWidth="1.15" strokeLinecap="round" />

        <ellipse cx="28.5" cy="20.4" rx="2.15" ry="2.45" fill="#1E40AF" />
        <circle cx="27.9" cy="19.5" r="0.85" fill="#FFFFFF" />
        <path d="M26.2 18.8 Q28.5 16.9 31.5 18.8" stroke="#1E2538" strokeWidth="1.45" strokeLinecap="round" />
        <path d="M31.5 18.7 L32.7 17.6" stroke="#1E2538" strokeWidth="1.15" strokeLinecap="round" />

        {/* Rosy feminine smile */}
        <path d="M22 25.6 Q24 27 26 25.6" stroke="#8E3F4B" strokeWidth="1.25" strokeLinecap="round" />

        {/* Front Hair, Parted Bangs & Cascading Side Locks */}
        <path
          d="M13 20.5 C12 13.5, 16 6.2, 24 6.2 C32 6.2, 36 13.5, 35 20.5 C35.8 25.5, 35 30.5, 32.5 34 C33.4 29.2, 33.4 22.8, 32.2 17.5 C30.8 14, 28.5 12, 26.5 11.4 C27 13.8, 26 15.8, 24.5 16.8 C25 14.4, 24 12.4, 22.5 11.4 C21.5 13.8, 19.5 15.8, 17.5 16.8 C18 14.4, 17.5 12.4, 16.5 11.6 C14.8 13.4, 14 16.5, 14 20.5 C14 24.5, 14.5 29.2, 15.5 34 C13 30.5, 12.2 25.5, 13 20.5 Z"
          fill={`url(#${hairGradId})`}
          stroke="#152447"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
        {/* Hair shine */}
        <path d="M17.5 9.8 Q20 8.6 22.5 9.6" stroke="#93C5FD" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M26 9.6 Q28.3 8.8 30.2 10.1" stroke="#93C5FD" strokeWidth="1.15" strokeLinecap="round" />
      </g>

      <circle cx="24" cy="24" r="22" stroke="#93C5FD" strokeOpacity="0.65" strokeWidth="1.5" />
    </svg>
  );
};
