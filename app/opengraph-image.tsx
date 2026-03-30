import { ImageResponse } from 'next/og';

export const alt = 'LORE - Linea Mining Game';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const runtime = 'nodejs';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(165deg, #0f0a1e 0%, #1e1b4b 50%, #0f0a1e 100%)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Crystal accent */}
        <div
          style={{
            position: 'absolute',
            top: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 120,
            height: 160,
            background: 'linear-gradient(180deg, #c4b5fd 0%, #8b5cf6 50%, #5b21b6 100%)',
            clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
            opacity: 0.9,
            boxShadow: '0 0 80px rgba(139, 92, 246, 0.4)',
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: 96,
              fontWeight: 900,
              color: 'white',
              letterSpacing: '-2px',
              textShadow: '0 0 40px rgba(139, 92, 246, 0.5)',
            }}
          >
            LORE
          </div>
          <div
            style={{
              fontSize: 32,
              color: '#a78bfa',
              fontWeight: 600,
              letterSpacing: '4px',
            }}
          >
            LINEA MINING GAME
          </div>
          <div
            style={{
              fontSize: 24,
              color: 'rgba(255,255,255,0.6)',
              marginTop: 8,
            }}
          >
            Mine · Bet · Earn
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
