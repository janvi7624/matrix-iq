import { ImageResponse } from 'next/og';

// Share preview (WhatsApp, LinkedIn, X…) for the public site.
export const alt = 'MatrixIQ — Every process, connected.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'radial-gradient(circle at 85% 30%, rgba(220,38,38,0.45), transparent 55%), #0b0f17',
          color: '#f8fafc',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, color: '#fca5a5', letterSpacing: 2, marginBottom: 24 }}>AI-POWERED BUSINESS PLATFORM</div>
        <div style={{ display: 'flex', fontSize: 110, fontWeight: 800, letterSpacing: -4 }}>
          <span>Matrix</span>
          <span style={{ color: '#dc2626', marginLeft: -12 }}>IQ</span>
        </div>
        <div style={{ display: 'flex', fontSize: 48, marginTop: 12, color: '#e2e8f0' }}>Every process, connected.</div>
        <div style={{ display: 'flex', fontSize: 24, marginTop: 48, color: '#94a3b8' }}>
          CRM · AI lead intelligence · Quotations · Projects · Partners · HR · Accounts
        </div>
        <div style={{ display: 'flex', fontSize: 22, marginTop: 'auto', color: '#64748b' }}>matrix-iq.nantatech.com · NANTA TECH LIMITED</div>
      </div>
    ),
    size
  );
}
