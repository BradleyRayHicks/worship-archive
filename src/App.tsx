// src/App.tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import jsPDF from "jspdf";
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { createClient } from "@supabase/supabase-js";
// ============================
// Accidental glyph helpers
// Values: Flat H=0.94 va=+0.06 ml=0.03 mr=0.11 W=0.47 | Sharp H=0.97 va=-0.07 ml=0.02 mr=0.04 W=0.495
// ============================


// SVG paths from user-drawn Canva artwork — used for React preview (inline SVG works in WKWebView)
const FLAT_PATH = "M 64.596 108.318 C 42.131 108.318 21.705 123.892 9.959 144.572 L 9.959 21.448 L 0 21.448 L 0 244.084 L 2.299 244.084 C 36.002 203.745 100.342 193.022 100.342 140.936 C 100.342 123.065 87.065 108.318 64.596 108.318 Z M 9.959 234.128 L 9.959 167.487 C 23.748 142.468 41.619 131.745 54.639 131.745 C 66.131 131.745 75.065 138.382 75.065 153.956 C 75.065 189.448 38.045 203.745 9.959 234.128 Z";
const SHARP_STEMS: [number,number,number,number][] = [
  [34.727,28.850,34.727,244.084],[99.320,20.936,99.320,236.170]
];
const SHARP_BARS: [number,number,number,number][] = [
  [0,109.787,133.789,95.233],[0,162.127,133.789,147.577]
];

function buildPdfGlyphs(): { flat: string; sharp: string; flatHeader: string; sharpHeader: string } {
  const ITALIC_SHEAR = -0.213; // lean right, matching helvetica italic
  const GRAY = 'rgb(150,150,150)';

  const buildFlat = (italic: boolean, color: string): string => {
    const PAD = 70;
    // When italic, bottom tip shears ~3px past left edge; translate right by 15px to compensate
    const SHEAR_COMP = italic ? 15 : 0;
    const canvas = document.createElement('canvas');
    canvas.width = 200 + PAD * 2; canvas.height = 400 + PAD * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(PAD + SHEAR_COMP, PAD);
    if (italic) ctx.transform(1, 0, ITALIC_SHEAR, 1, 0, 0);
    ctx.scale(200 / 100.34, 400 / 180);
    ctx.translate(0, -48.5);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    const p = new Path2D(FLAT_PATH);
    ctx.fill(p);
    ctx.stroke(p);
    return canvas.toDataURL('image/png');
  };

  const buildSharp = (italic: boolean, color: string): string => {
    const PAD = 70;
    const W = 200, H = 360;
    const canvas = document.createElement('canvas');
    canvas.width = W + PAD * 2; canvas.height = H + PAD * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(PAD, PAD);
    if (italic) ctx.transform(1, 0, ITALIC_SHEAR, 1, 0, 0);
    const sx = W / 133.789;
    const sy = H / 180;
    ctx.strokeStyle = color;
    ctx.lineWidth = 20 * sx;
    ctx.lineCap = 'round';
    [...SHARP_STEMS, ...SHARP_BARS].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath();
      ctx.moveTo(x1 * sx, (y1 - 51) * sy);
      ctx.lineTo(x2 * sx, (y2 - 51) * sy);
      ctx.stroke();
    });
    return canvas.toDataURL('image/png');
  };

  return {
    flat:        buildFlat(false, '#000000'),
    sharp:       buildSharp(false, '#000000'),
    flatHeader:  buildFlat(true,  GRAY),
    sharpHeader: buildSharp(true, GRAY),
  };
}

const FlatGlyph = (): React.ReactElement => (
  <svg
    viewBox="0 48.5 100.34 180"
    style={{ display: 'inline-block', verticalAlign: '0.04em', marginLeft: '0.035em', marginRight: '0.105em', width: '0.47em', height: '0.64em', overflow: 'visible' }}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d={FLAT_PATH} fill="currentColor" fillRule="evenodd" stroke="currentColor" strokeWidth="8" strokeLinejoin="round" />
  </svg>
);

const SharpGlyph = (): React.ReactElement => (
  <svg
    viewBox="0 51 133.789 180"
    style={{ display: 'inline-block', verticalAlign: '0.07em', marginLeft: '0.03em', marginRight: '0.03em', width: '0.495em', height: '0.56em', overflow: 'visible' }}
    xmlns="http://www.w3.org/2000/svg"
  >
    {SHARP_STEMS.map(([x1,y1,x2,y2],i) => (
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="20" strokeLinecap="round" />
    ))}
    {SHARP_BARS.map(([x1,y1,x2,y2],i) => (
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="20" strokeLinecap="round" />
    ))}
  </svg>
);


// ============================
// Accidental glyph helpers — PNG images embedded as base64
// Same data used in both React preview (<img>) and jsPDF export (addImage)
// ============================

const renderChordLine = (text: string): React.ReactNode => {
  // Normalize unicode accidentals → ASCII so stored ♭/♯ characters get glyphs too
  const normalized = text.replace(/([A-G])\u266D/g, '$1b').replace(/([A-G])\u266F/g, '$1#');
  if (!normalized.match(/[A-G][#b]/)) return <>{normalized}</>;
  const parts = normalized.split(/([A-G][#b])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^[A-G]b$/.test(part)) return <React.Fragment key={i}>{part[0]}<FlatGlyph /></React.Fragment>;
        if (/^[A-G]#$/.test(part)) return <React.Fragment key={i}>{part[0]}<SharpGlyph /></React.Fragment>;
        return part;
      })}
    </>
  );
};

// Render a chord line with triplet bracket SVG overlays
// ChordLineWithTriplets: measures real span positions via refs to draw accurate brackets
const ChordLineWithTriplets = ({ text, fontSize = 13, color }: { text: string; fontSize?: number; color?: string }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [brackets, setBrackets] = React.useState<{x1: number; x2: number; x3: number}[]>([]);

  // Parse [3] groups: build list of (tok1, tok2, tok3) span indices per bracket
  const parts: { token: string; groupIdx: number | null; posInGroup: number | null }[] = [];
  // Normalize unicode accidentals → ASCII so stored ♭/♯ get glyphs too
  const normText = text.replace(/([A-G])\u266D/g, '$1b').replace(/([A-G])\u266F/g, '$1#');
  const segments = normText.split(/(\[3\])/);
  // collect non-[3] tokens in order, then assign groups retroactively
  const allTokenSpans: string[] = [];
  const groupAssignments: { spanIdx: number; groupIdx: number; posInGroup: number }[] = [];
  let groupCounter = 0;
  let spanIdx = 0;
  const rawParts: ('marker' | string)[] = [];
  segments.forEach(seg => {
    if (seg === '[3]') { rawParts.push('marker'); }
    else {
      // split into tokens and spaces
      const pieces = seg.split(/(\s+)/);
      pieces.forEach(p => rawParts.push(p));
    }
  });
  // build spans: each non-space non-marker piece gets a span
  const spanTokens: string[] = [];
  const markerAfterSpan: boolean[] = []; // markerAfterSpan[i] = true if [3] immediately follows span i
  rawParts.forEach(p => {
    if (p === 'marker') {
      if (markerAfterSpan.length > 0) markerAfterSpan[markerAfterSpan.length - 1] = true;
    } else if (/^\s+$/.test(p) || p === '') {
      // space — attach to previous span or just push empty
      spanTokens.push(p);
      markerAfterSpan.push(false);
    } else {
      spanTokens.push(p);
      markerAfterSpan.push(false);
    }
  });
  // find triplet groups: each marker ending at span i means spans i-2, i-1, i form a group
  const tripletGroups: [number, number, number][] = [];
  markerAfterSpan.forEach((isMarker, i) => {
    if (isMarker) {
      // find the 3 chord-token spans ending at or before i
      const chordIdxs = spanTokens
        .map((t, idx) => ({ t, idx }))
        .filter(({ t, idx }) => idx <= i && t.trim() !== '')
        .map(({ idx }) => idx);
      if (chordIdxs.length >= 3) {
        const last = chordIdxs[chordIdxs.length - 1];
        const mid2 = chordIdxs[chordIdxs.length - 2];
        const first2 = chordIdxs[chordIdxs.length - 3];
        tripletGroups.push([first2, mid2, last]);
      }
    }
  });

  React.useEffect(() => {
    if (!containerRef.current) return;
    const spans = containerRef.current.querySelectorAll('span[data-ti]');
    const containerRect = containerRef.current.getBoundingClientRect();
    const newBrackets = tripletGroups.map(([i1, i2, i3]) => {
      const s1 = containerRef.current!.querySelector(`span[data-ti="${i1}"]`);
      const s2 = containerRef.current!.querySelector(`span[data-ti="${i2}"]`);
      const s3 = containerRef.current!.querySelector(`span[data-ti="${i3}"]`);
      if (!s1 || !s2 || !s3) return null;
      const r1 = s1.getBoundingClientRect();
      const r2 = s2.getBoundingClientRect();
      const r3 = s3.getBoundingClientRect();
      return {
        x1: r1.left - containerRect.left,
        x2: r2.left - containerRect.left + r2.width / 2,
        x3: r3.left - containerRect.left + r3.width,
      };
    }).filter(Boolean) as {x1: number; x2: number; x3: number}[];
    setBrackets(newBrackets);
  }, [normText]);

  const BRACKET_H = 12;
  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block', paddingTop: BRACKET_H + 2 }}>
      {brackets.map((br, i) => (
        <svg key={i} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: BRACKET_H + 2, overflow: 'visible', pointerEvents: 'none' }}>
          <line x1={br.x1} y1={BRACKET_H} x2={br.x1} y2={4} stroke="#7F77DD" strokeWidth="1.2"/>
          <line x1={br.x1} y1={4} x2={br.x2 - 4} y2={4} stroke="#7F77DD" strokeWidth="1.2"/>
          <text x={br.x2} y={3} textAnchor="middle" dominantBaseline="auto" fontSize="8" fontWeight="700" fill="#7F77DD" fontFamily="Helvetica, sans-serif">3</text>
          <line x1={br.x2 + 4} y1={4} x2={br.x3} y2={4} stroke="#7F77DD" strokeWidth="1.2"/>
          <line x1={br.x3} y1={4} x2={br.x3} y2={BRACKET_H} stroke="#7F77DD" strokeWidth="1.2"/>
        </svg>
      ))}
      <pre style={{ margin: 0, padding: 0, lineHeight: 1.3, fontFamily: 'Helvetica, sans-serif', fontSize: fontSize + 'pt', fontWeight: 700, backgroundColor: 'transparent', display: 'inline-block', color: color }}>
        {spanTokens.map((tok, i) =>
          tok.trim() === '' ? tok : <span key={i} data-ti={i}>{renderChordLine(tok)}</span>
        )}
      </pre>
    </div>
  );
};

// React version for UI labels (key selector, archive, header) — uses same SVG glyphs
const FlatLabel = ({ text, invert, light }: { text: string; invert?: boolean; light?: boolean }) => {
  const normalized = text.replace(/([A-G])\u266D/g, '$1b').replace(/([A-G])\u266F/g, '$1#');
  if (!normalized.match(/[A-G][#b]/)) return <>{normalized}</>;
  const parts = normalized.split(/([A-G][#b])/g);
  // invert=true: white glyphs on dark background (selected key)
  // light=true: reduced opacity for non-bold contexts (bpm header)
  const imgStyle = (base: React.CSSProperties): React.CSSProperties => ({
    ...base,
    opacity: light ? 0.6 : undefined,
    transform: light ? 'skewX(-12deg)' : undefined,
  });
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {parts.map((part, i) => {
        if (/^[A-G]b$/.test(part)) return (
          <React.Fragment key={i}>{part[0]}
            <svg viewBox="0 48.5 100.34 180" style={imgStyle({ display: 'inline-block', verticalAlign: '0.04em', marginLeft: '0.035em', marginRight: '0.105em', width: '0.47em', height: '0.64em', overflow: 'visible' })} xmlns="http://www.w3.org/2000/svg">
              <path d={FLAT_PATH} fill={invert ? 'white' : 'currentColor'} fillRule="evenodd" stroke={invert ? 'white' : 'currentColor'} strokeWidth="8" strokeLinejoin="round" />
            </svg>
          </React.Fragment>
        );
        if (/^[A-G]#$/.test(part)) return (
          <React.Fragment key={i}>{part[0]}
            <svg viewBox="0 51 133.789 180" style={imgStyle({ display: 'inline-block', verticalAlign: '0.07em', marginLeft: '0.03em', marginRight: '0.03em', width: '0.495em', height: '0.56em', overflow: 'visible' })} xmlns="http://www.w3.org/2000/svg">
              {SHARP_STEMS.map(([x1,y1,x2,y2],si) => <line key={si} x1={x1} y1={y1} x2={x2} y2={y2} stroke={invert ? 'white' : 'currentColor'} strokeWidth="20" strokeLinecap="round" />)}
              {SHARP_BARS.map(([x1,y1,x2,y2],bi) => <line key={bi} x1={x1} y1={y1} x2={x2} y2={y2} stroke={invert ? 'white' : 'currentColor'} strokeWidth="20" strokeLinecap="round" />)}
            </svg>
          </React.Fragment>
        );
        return part;
      })}
    </span>
  );
};

// ============================
// Global swipe navigation hook
// ============================
function useGlobalSwipe(onSwipeBack: () => void, onSwipeForward: () => void, sensitivity: 'normal' | 'low' = 'normal', disabled = false) {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartTime = useRef<number | null>(null);
  const wheelAccum = useRef(0);
  const wheelLocked = useRef(false);
  const onSwipeBackRef = useRef(onSwipeBack);
  const onSwipeForwardRef = useRef(onSwipeForward);
  const sensitivityRef = useRef(sensitivity);
  const disabledRef = useRef(disabled);

  useEffect(() => { onSwipeBackRef.current = onSwipeBack; }, [onSwipeBack]);
  useEffect(() => { onSwipeForwardRef.current = onSwipeForward; }, [onSwipeForward]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  useEffect(() => {
    // Command/Ctrl + Arrow key navigation: Cmd+Left = back, Cmd+Right = forward
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return;
      
      // Only trigger with Command (Mac) or Ctrl (Windows/Linux)
      if (!e.metaKey && !e.ctrlKey) return;
      
      // Cmd+Left arrow = back
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onSwipeBackRef.current();
      }
      // Cmd+Right arrow = forward
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onSwipeForwardRef.current();
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      touchStartTime.current = Date.now();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) return;
      if (disabledRef.current) { touchStartX.current = null; touchStartY.current = null; return; }
      
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      const dy = e.changedTouches[0].clientY - touchStartY.current;
      const elapsed = Date.now() - (touchStartTime.current ?? 0);

      const threshold = sensitivityRef.current === 'low' ? 180 : 120;
      const ratio = sensitivityRef.current === 'low' ? 3 : 2.5;
      const maxTime = 600;

      if (
        elapsed < maxTime &&
        Math.abs(dx) > Math.abs(dy) * ratio &&
        Math.abs(dx) > threshold
      ) {
        if (dx > 0) onSwipeBackRef.current();
        else onSwipeForwardRef.current();
      }
      touchStartX.current = null;
      touchStartY.current = null;
      touchStartTime.current = null;
    };


    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []); // runs once, callbacks always current via refs
}

// ============================
// Song archive types
// ============================
interface SavedSong {
  id: string;
  title: string;
  bpm: string;
  writers: string;
  key: string;
  input: string;
  savedAt: number;
  userId?: string | null;
  openKey?: string;
  notes?: string;
  tags?: string[];
  spotify_track_id?: string;
  parentSongId?: string | null;   // set on versions; the canonical song's id
  artistName?: string;            // pulled from Spotify, stored on version
  preferredVersionId?: string | null; // set on the parent: which version is default
  // Editor state
  sectionLabels?: string[];
  sectionRepeats?: number[];
  blankSections?: { id: string; afterIdx: number; label: string; repeat: number }[];
  manualSplits?: { sectionIdx: number; lineIdx: number }[];
  manualMerges?: number[];
  lineOverrides?: { [key: string]: string };
  ghostSourceByLabel?: { [label: string]: number }; // legacy — migrated to ghostSourceByBlank
  ghostSourceByBlank?: { [blankId: string]: number };
}

interface AuthUser {
  id: string;
  email: string;
}

interface UserSettings {
  showCapoSuggestions: boolean;
}


// ============================
// Section colors (shared across all views)
// ============================
// ============================
// Supabase client
// ============================
interface SetlistEntry {
  // songId is "__element__" for custom plan items (headings, breaks, etc.)
  // displayKey doubles as the element label when songId === "__element__"
  songId: string;
  displayKey: string;
  leader?: string;
  entryNote?: string;
}

interface PlanGroup {
  id: string;
  name: string;
  sortOrder: number;
}

interface Setlist {
  id: string;
  name: string;
  entries: SetlistEntry[];
  createdAt: number;
  date?: string;
  groupId?: string | null;
}

// Team Management Interfaces
interface TeamMember {
  id: string;
  user_id: string;
  name: string;
  email?: string;
  phone?: string;
  positions: string[]; // e.g., ['Vocals', 'Acoustic Guitar']
  notes?: string;
  notification_preference?: 'email' | 'none';
  created_at: string;
}

interface SetlistAssignment {
  id: string;
  setlist_id: string;
  team_member_id: string;
  position: string; // The specific role for this assignment
  status: 'pending' | 'accepted' | 'declined';
  notes?: string;
  team_member?: TeamMember; // Joined data
}

// Common positions/roles
// Default positions - can be customized by user
const DEFAULT_POSITIONS = [
  'Lead Vocals',
  'Background Vocals',
  'Acoustic Guitar',
  'Electric Guitar',
  'Bass',
  'Drums',
  'Keys/Piano',
  'Synth',
  'Worship Leader',
  'Tech/Sound',
  'Lyrics/Projection'
];

// ============================
// Capacitor Preferences helpers (replaces localStorage)
// ============================
const store = {
  async get(key: string): Promise<string | null> {
    try { const { value } = await Preferences.get({ key }); return value; }
    catch { return null; }
  },
  async set(key: string, value: string): Promise<void> {
    try { await Preferences.set({ key, value }); } catch {}
  },
  async remove(key: string): Promise<void> {
    try { await Preferences.remove({ key }); } catch {}
  },
};

// Get positions from storage or use defaults
const getCommonPositions = async (): Promise<string[]> => {
  const stored = await store.get('common_positions');
  return stored ? JSON.parse(stored) : DEFAULT_POSITIONS;
};

// Save positions to storage
const saveCommonPositions = async (positions: string[]) => {
  await store.set('common_positions', JSON.stringify(positions));
};

// COMMON_POSITIONS starts as defaults; loaded async in components that need it
const COMMON_POSITIONS = DEFAULT_POSITIONS;

const SUPABASE_URL = 'https://bmilrzahvfvaojzovszf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JIsdCuXs4Gbqy_DtPuwD2A_7OQdDN0X';
const ADMIN_USER_ID = '79505a60-39b8-4cae-a086-4e886e369c69';

// ============================
// Spotify
// ============================
const SPOTIFY_CLIENT_ID = '98c75710abb54e87a8e72146e7007966';
const SPOTIFY_REDIRECT_URI = Capacitor.isNativePlatform()
  ? 'worshiparchive://callback'
  : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:3000'
    : 'https://worshiparchives.netlify.app');
const SPOTIFY_SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';

async function generateCodeChallenge(verifier: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...Array.from(new Uint8Array(digest))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...Array.from(array)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// On native iOS, uses SFSafariViewController (in-app, not blocked by Screen Time)
// On web, falls back to standard redirect
async function connectSpotifyNative(): Promise<void> {
  const url = await getSpotifyAuthUrl();
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url, windowName: '_self' });
  } else {
    window.location.href = url;
  }
}

// Web fallback — redirects via window.location (used on desktop/web)
async function getSpotifyAuthUrl() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  await store.set('spotify_code_verifier', verifier);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeSpotifyCode(code: string): Promise<string | null> {
  const verifier = await store.get('spotify_code_verifier');
  if (!verifier) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  await store.remove('spotify_code_verifier');
  if (data.refresh_token) await store.set('spotify_refresh_token', data.refresh_token);
  return data.access_token || null;
}

async function refreshSpotifyToken(): Promise<string | null> {
  const refreshToken = await store.get('spotify_refresh_token');
  if (!refreshToken) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.refresh_token) await store.set('spotify_refresh_token', data.refresh_token);
  return data.access_token || null;
}

async function spotifySearch(query: string, token: string): Promise<any[]> {
  const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.tracks?.items || [];
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Keep the Capacitor Preferences token store in sync with whatever the
// Supabase client does internally. The client runs its own silent
// background auto-refresh (rotating the refresh token behind the scenes),
// and without this listener that rotated token never makes it into
// Preferences — so a later manual refresh (on app relaunch, or after a
// "JWT expired" fetch) uses a stale, already-used refresh token and gets
// rejected, wiping the session and forcing a full re-login. Mirroring
// every auth event back into `store` closes that gap.
supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    store.set('auth_token', session.access_token);
    store.set('auth_refresh', session.refresh_token);
  } else if (event === 'SIGNED_OUT') {
    store.remove('auth_token');
    store.remove('auth_refresh');
  }
});

const supaFetch = async (path: string, options: RequestInit = {}, token?: string) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token || SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...((options as any).headers || {}),
    },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const supaAuth = async (endpoint: string, body: object) => {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.message || data.msg || data.error || 'Auth error');
  return data;
};

const supaRefreshToken = async (): Promise<string | null> => {
  const refresh = await store.get('auth_refresh');
  if (!refresh) return null;
  try {
    const data = await supaAuth('token?grant_type=refresh_token', { refresh_token: refresh });
    await store.set('auth_token', data.access_token);
    await store.set('auth_refresh', data.refresh_token);
    return data.access_token;
  } catch {
    await store.remove('auth_token');
    await store.remove('auth_refresh');
    return null;
  }
};

const supaFetchWithRefresh = async (path: string, options: RequestInit = {}, token: string): Promise<any> => {
  try {
    return await supaFetch(path, options, token);
  } catch (e: any) {
    if (e.message?.includes('JWT expired') || e.message?.includes('PGRST303')) {
      const newToken = await supaRefreshToken();
      if (newToken) return await supaFetch(path, options, newToken);
    }
    throw e;
  }
};

const supaGetUser = async (token: string): Promise<AuthUser | null> => {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { id: data.id, email: data.email };
  } catch { return null; }
};

// Convert camelCase SavedSong ↔ snake_case DB row
const toRow = (s: SavedSong, userId?: string) => ({
  id: s.id, title: s.title, bpm: s.bpm, writers: s.writers,
  key: s.key, input: s.input, saved_at: s.savedAt,
  user_id: s.userId !== undefined ? s.userId : (userId || null),
  tags: s.tags ?? null,
  spotify_track_id: s.spotify_track_id ?? null,
  section_labels: s.sectionLabels ?? null,
  section_repeats: s.sectionRepeats ?? null,
  blank_sections: s.blankSections ?? null,
  manual_splits: s.manualSplits ?? null,
  manual_merges: s.manualMerges ?? null,
  line_overrides: s.lineOverrides ?? null,
  ghost_source_by_label: s.ghostSourceByLabel ?? null,
  ghost_source_by_blank: s.ghostSourceByBlank ?? null,
  parent_song_id: s.parentSongId ?? null,
  artist_name: s.artistName ?? null,
  preferred_version_id: s.preferredVersionId ?? null,
});

const fromRow = (r: any): SavedSong => ({
  id: r.id, title: r.title, bpm: r.bpm || '', writers: r.writers || '',
  key: r.key, input: r.input, savedAt: r.saved_at,
  userId: r.user_id === null ? null : (r.user_id || undefined),
  tags: Array.isArray(r.tags) ? r.tags : (r.tags ? [r.tags] : undefined),
  spotify_track_id: r.spotify_track_id ?? undefined,
  sectionLabels: r.section_labels ?? undefined,
  sectionRepeats: r.section_repeats ?? undefined,
  blankSections: r.blank_sections ?? undefined,
  manualSplits: r.manual_splits ?? undefined,
  manualMerges: r.manual_merges ?? undefined,
  lineOverrides: r.line_overrides ?? undefined,
  ghostSourceByLabel: r.ghost_source_by_label ?? undefined,
  ghostSourceByBlank: r.ghost_source_by_blank ?? undefined,
  parentSongId: r.parent_song_id ?? null,
  artistName: r.artist_name ?? undefined,
  preferredVersionId: r.preferred_version_id ?? null,
});

const SECTION_COLORS_HEX: Record<string, string> = {
  Intro:        "#6b7280",
  Verse:        "#3b82f6",
  "Pre-Chorus": "#a855f7",
  Chorus:       "#dc2626",
  Bridge:       "#16a34a",
  Instrumental: "#6b7280",
  Outro:        "#6b7280",
  Tag:          "#f97316",
};

// ============================
// Keys for transposition
// ============================
// Normalize a raw song.key value to a canonical display key (no 'm' suffix, no A#/G#/etc)
const normalizeDisplayKey = (raw: string): string => {
  const base = raw.replace(/m$/, '');
  const ENHARMONIC_NORM: Record<string,string> = { 'G#':'Ab','A#':'Bb','C#':'Db','D#':'Eb' };
  return (typeof KEYS[base] === 'undefined' && ENHARMONIC_NORM[base]) ? ENHARMONIC_NORM[base] : base;
};
// ============================
const KEYS: Record<string, string[]> = {
  Ab: ["Ab", "Bb", "C", "Db", "Eb", "F", "G"],
  A: ["A", "B", "C#", "D", "E", "F#", "G#"],
  Bb: ["Bb", "C", "D", "Eb", "F", "G", "A"],
  B: ["B", "C#", "D#", "E", "F#", "G#", "A#"],
  C: ["C", "D", "E", "F", "G", "A", "B"],
  Db: ["Db", "Eb", "F", "Gb", "Ab", "Bb", "C"],
  D: ["D", "E", "F#", "G", "A", "B", "C#"],
  Eb: ["Eb", "F", "G", "Ab", "Bb", "C", "D"],
  E: ["E", "F#", "G#", "A", "B", "C#", "D#"],
  F: ["F", "G", "A", "Bb", "C", "D", "E"],
  "F#": ["F#", "G#", "A#", "B", "C#", "D#", "F"],
  G: ["G", "A", "B", "C", "D", "E", "F#"],
};

// ============================
// Enharmonics
// ============================
const ENHARMONICS: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Fb: "E",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
  Cb: "B",
  "C#": "Db",
  "D#": "Eb",
  "E#": "F",
  "F#": "Gb",
  "G#": "Ab",
  "A#": "Bb",
  "B#": "C",
};

// ============================
// Key Detection
// ============================
const detectKey = (input: string): string => {
  const lines = input.split("\n");
  const chordData: { root: string; quality: string; count: number }[] = [];
  const chordMap: { [key: string]: number } = {};
  
  // Collect all chords with their qualities
  lines.forEach(line => {
    const normalized = line.replace(/\u00A0/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    const tokens = normalized.split(" ").filter(Boolean);
    
    tokens.forEach(token => {
      const match = token.match(/^([A-G][#b]?)(m(?:aj)?|maj|dim|aug|sus)?/);
      if (match) {
        const root = match[1];
        let quality = match[2] || 'maj';
        
        if (quality === 'm') {
          quality = 'min';
        } else if (quality === 'maj' || quality === 'sus' || !quality) {
          quality = 'maj';
        }
        
        const key = root + quality;
        
        if (!chordMap[key]) {
          chordMap[key] = 0;
        }
        chordMap[key]++;
      }
    });
  });
  
  Object.entries(chordMap).forEach(([chord, count]) => {
    const match = chord.match(/^([A-G][#b]?)(min|maj|dim|aug)/);
    if (match) {
      chordData.push({
        root: match[1],
        quality: match[2],
        count: count
      });
    }
  });
  
  if (chordData.length === 0) return "G";
  
  const majorKeyQualities = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
  const keyScores: { [key: string]: number } = {};
  
  Object.keys(KEYS).forEach(possibleKey => {
    let score = 0;
    const scale = KEYS[possibleKey];
    
    chordData.forEach(({ root, quality, count }) => {
      const scaleIndex = scale.indexOf(root);
      
      if (scaleIndex !== -1) {
        const expectedQuality = majorKeyQualities[scaleIndex];
        
        const qualityMatches = 
          (quality === 'maj' && expectedQuality === 'maj') ||
          (quality === 'min' && expectedQuality === 'min') ||
          (quality === 'dim' && expectedQuality === 'dim');
        
        if (qualityMatches) {
          if (scaleIndex === 0) {
            score += count * 5;
          } else if (scaleIndex === 4) {
            score += count * 3;
          } else if (scaleIndex === 3) {
            score += count * 3;
          } else if (scaleIndex === 5) {
            score += count * 2;
          } else {
            score += count * 1;
          }
        } else {
          score -= count * 0.5;
        }
      } else {
        score -= count * 1;
      }
    });
    
    keyScores[possibleKey] = score;
  });
  
  const bestKey = Object.entries(keyScores).reduce((best, current) => 
    current[1] > best[1] ? current : best
  );
  
  return bestKey[0];
};

// ============================
// Capo calculation
// ============================
const getCapoSuggestion = (fromKey: string, toKey: string): { capo: number; playIn: string } | null => {
  if (fromKey === toKey) return null;
  
  const chromatic = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const ENHARMONICS: Record<string, string> = {
    'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'
  };
  
  const normalizeKey = (k: string) => ENHARMONICS[k] || k;
  const from = normalizeKey(fromKey); // Original song key
  const to = normalizeKey(toKey);     // Display key (what user clicked)
  
  const fromIdx = chromatic.indexOf(from);
  const toIdx = chromatic.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return null;
  
  // If song is in B and display is G:
  // Capo at fret 4, play G shapes → hear B
  // So: capo = (fromKey - toKey) mod 12
  const diff = (fromIdx - toIdx + 12) % 12;
  if (diff === 0) return null;
  
  const capo = diff;
  const playIn = toKey; // Play in the display key
  
  // Only suggest capo 1-7 (beyond that is impractical)
  if (capo > 0 && capo <= 7) {
    return { capo, playIn };
  }
  
  return null;
};



// ============================
// Chord conversion functions
// ============================
const nashvilleToChord = (token: string, key: string) => {
  const scale = KEYS[key];
  if (!scale) return token;
  const degree = parseInt(token[0]) - 1;
  if (isNaN(degree) || degree < 0 || degree >= scale.length) return token;
  const result = scale[degree] + token.slice(1);
  return result;
};

const convertChord = (
  token: string,
  originalKey: string,
  outputKey: string,
  isLetter: boolean
): string => {
  const startsWithParen = token.startsWith('(');
  const endsWithParen = token.endsWith(')');
  
  let core = token.replace(/^[()]+|[()]+$/g, '');
  
  if (core.includes("/")) {
    const [l, r] = core.split("/");
    const converted = `${convertChord(l, originalKey, outputKey, isLetter)}/${convertChord(
      r,
      originalKey,
      outputKey,
      isLetter
    )}`;
    return (startsWithParen ? '(' : '') + converted + (endsWithParen ? ')' : '');
  }

  const endsDot = core.endsWith(".");
  let chordCore = endsDot ? core.slice(0, -1) : core;

  if (isLetter) {
    const scale = KEYS[originalKey];
    const targetScale = KEYS[outputKey];
    if (!scale || !targetScale) return token;
    
    let baseMatch = chordCore.match(/[A-G][#b]?/);
    if (!baseMatch) return token;

    let baseNote = baseMatch[0];
    const matchStart = baseMatch.index!; // Position where the match starts
    let degree = scale.indexOf(baseNote);
    
    // Check enharmonic equivalent
    if (degree === -1 && ENHARMONICS[baseNote]) {
      baseNote = ENHARMONICS[baseNote];
      degree = scale.indexOf(baseNote);
    }
    
    // If note is in the key, use scale degree method
    if (degree !== -1) {
      const modifier = chordCore.slice(matchStart + baseMatch[0].length);
      chordCore = nashvilleToChord((degree + 1).toString() + modifier, outputKey);
    } else {
      // Note is outside the key - transpose by chromatic interval
      const chromatic = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      
      // Normalize to chromatic scale
      let origIndex = chromatic.indexOf(baseNote);
      if (origIndex === -1 && ENHARMONICS[baseNote]) {
        origIndex = chromatic.indexOf(ENHARMONICS[baseNote]);
      }
      if (origIndex === -1) return token;
      
      // Calculate interval between keys
      const origKeyIndex = chromatic.indexOf(originalKey) !== -1 ? chromatic.indexOf(originalKey) : chromatic.indexOf(ENHARMONICS[originalKey] || '');
      const targetKeyIndex = chromatic.indexOf(outputKey) !== -1 ? chromatic.indexOf(outputKey) : chromatic.indexOf(ENHARMONICS[outputKey] || '');
      if (origKeyIndex === -1 || targetKeyIndex === -1) return token;
      
      const interval = (targetKeyIndex - origKeyIndex + 12) % 12;
      const newIndex = (origIndex + interval) % 12;
      const newBase = chromatic[newIndex];
      
      const modifier = chordCore.slice(matchStart + baseMatch[0].length);
      chordCore = newBase + modifier;
    }
  } else chordCore = nashvilleToChord(chordCore, outputKey);

  const result = endsDot ? chordCore + "." : chordCore;
  return (startsWithParen ? '(' : '') + result + (endsWithParen ? ')' : '');
};

// ============================
// Helpers
// ============================
const normalizeLine = (line: string) =>
  line.replace(/\u00A0/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();

const isChordLine = (line: string) => {
  line = line.replace(/\[3\]/g, '').trim();
  // Normalize unicode accidentals so chord detection works regardless of input method
  line = line.replace(/\u266D/g, 'b').replace(/\u266F/g, '#').replace(/\uF8FF/g, '#');
  const tokens = normalizeLine(line).replace(/\uFFFC/g, '').replace(/\u200B/g, '').split(" ").filter(Boolean);
  if (!tokens.length) return false;

  const isSymbol = (t: string) => /^[\/|.\-x%]+$/.test(t);

  const isChord = (t: string) => {
    const cleaned = t.replace(/[()]/g, '');
    // Handle slash chords like /F, /Bb, /C# (bass note only)
    if (/^\/[A-G][#b]?$/.test(cleaned)) return true;
    return new RegExp('^[A-G][#b]?((m|maj|7|9|11|13|dim|aug|sus|sus2|sus4|add|º|°)?[0-9]*)?(/[A-G][#b]?)?\\.?$').test(cleaned);
  };

  // A token is "clearly a word" if it has 3+ lowercase letters after the first char
  // BUT exclude known chord suffixes that look like words
  const CHORD_SUFFIXES = /^(maj|dim|aug|sus|add)/i;
  const isClearWord = (t: string) => {
    if (isChord(t)) return false;
    if (CHORD_SUFFIXES.test(t.slice(1))) return false;
    return /^[A-Za-z][a-z]{2,}/.test(t);
  };

  const symbolCount = tokens.filter(t => isSymbol(t)).length;
  const chordCount = tokens.filter(t => !isSymbol(t) && isChord(t)).length;
  const wordCount = tokens.filter(t => !isSymbol(t) && isClearWord(t)).length;
  const meaningfulCount = tokens.length - symbolCount;

  if (meaningfulCount === 0) return true; // all symbols = chord line (e.g. "/ / / /")
  // Any clearly-readable word means it's a lyric line
  if (wordCount > 0) return false;
  // If there are ANY chords and no words, it's a chord line
  if (chordCount > 0 && wordCount === 0) return true;
  // Fallback: majority of meaningful tokens must be chords
  return chordCount / meaningfulCount >= 0.5;
};

// ============================
// Main App
// ============================
// ============================
// Standalone PDF export (used by editor and archive)
// ============================
interface ExportParams {
  title: string; bpm: string; writers: string;
  originalKey: string; displayKey: string;
  inputType: "letters" | "numbers";
  useFlats: boolean;
  displaySections: { lines: string[]; baseSectionIdx: number; lineOffset: number }[];
  blankSections: { id: string; afterIdx: number; label: string; repeat: number }[];
  ghostSourceByBlank?: { [blankId: string]: number };
  sectionLabels: string[]; sectionRepeats: number[];
  lineOverrides: { [key: string]: string };
}

const DEJAVU_BOLD_B64 = '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KysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKwArKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysdAAFmATMBZgC8AOkAAAE9AKIA+gMfAAIAAgBmAWYAAgACAKwBVADsALwAYgFmAYEEhQFUAWYBbQSkAAIBZgB/BM0AAAACATMAYgBxAAAAJQSkAbwAugDlAGYBgQGNBUgFWgFmAW0AAAAAAAIAAgD2BcMB8AU5AjkAWARtBD0EsgSBBLIBZgF1BGYEgQCwBGYEOQLRBJwEewTPBHsAWAEzAWYBTAFmAUwAAgCsAJoBSgEjAJoCmgFEARkBRALNAMEAAAFmAT8BmgE7BcsFywDVANUBUACsAKwAdwIKAccB8gEvAVgBsgEjAPYA9gEfAS8BNQI1Ae4B5wEzAJgA0QNYBQoAmgCPARIAmAC8AM0A5QDlAPIAcwQAAWYAjwXVAisF1QDDAOEA1wDlAAAAagECAAAAHQMtBdUF1QXwAKgAagDsAOEBAgXVBhQHIQRmAvgA7AGDAqYC+AEjAQIBAgESAR8DHwBeA80EYATHBIkA7AG8ALoBAgMzAx8DQgMzA1wBEgEfBdUBmgCaAOEGZgF5BGAEYARgBHsAAADsAsMCuALNAL4A3QDVAAAAagJcAnsCmgDdAa4BugESAAAAhQGuBGAHYgQbAJoGmgRYAO4AmgKaANECzQGaAVAFywXLAIsAiwYxAPYEBgDwA0wBYASoAMEAAAAlBcEBAAEhB0oGEgCW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';

async function exportSongPDF(params: ExportParams) {
  const TO_FLAT_PDF: Record<string,string> = { 'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb' };
  const TO_SHARP_PDF: Record<string,string> = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };
  const applyAccidentalPrefPDF = (token: string): string =>
    params.useFlats
      ? token.replace(/([A-G])(#)/g, (_, n, a) => TO_FLAT_PDF[n+a] || (n+a))
      : token.replace(/([A-G])(b)/g, (_, n, a) => TO_SHARP_PDF[n+a] || (n+a));
  const applyAccidentalPrefToLinePDF = (line: string): string =>
    line.split(/(\s+)/).map(t => /^\s+$/.test(t) ? t : applyAccidentalPrefPDF(t)).join('');

  const doc = new jsPDF();
  const pdfGlyphs = buildPdfGlyphs();
  // Override to US Letter (215.9 x 279.4 mm)
  (doc.internal.pageSize as any).width = 215.9;
  (doc.internal.pageSize as any).height = 279.4;

  // Draw chord line in Helvetica, replacing b and # with vector-drawn accidentals
  // that match the user's custom SVG glyphs exactly.
  const drawChordLine = (text: string, x: number, y: number, fontSize: number) => {
    const safeText = text.replace(/\u00A0/g, " ");
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);

    // If no accidentals, draw normally
    if (!safeText.match(/[A-G][#b]/)) {
      doc.text(safeText, x, y, { baseline: 'top' } as any);
      return;
    }

    // Split into segments, drawing plain text and glyphs token by token
    // We measure each piece to advance x correctly.
    const parts = safeText.split(/([A-G][#b])/g);
    let curX = x;

    // jsPDF: getStringUnitWidth returns width in "text units" — multiply by fontSize/scaleFactor to get mm
    const scaleFactor: number = (doc.internal as any).scaleFactor;
    const fontSizeMm = fontSize / scaleFactor;

    // Helper: width of a string in mm at current font/size
    const strWidthMm = (s: string): number =>
      doc.getStringUnitWidth(s) * fontSizeMm;

    // ── Flat glyph — PNG image (FLAT_PNG), matches React preview exactly ───────
    // Layout values from FLAT_PNG comment: H=0.94em  va=-0.17em  ml=0.03em  mr=0.11em  W=0.47em
    const drawFlatGlyph = (gx: number, gy: number) => {
      const glyphW = fontSizeMm * 0.6392;
      const glyphH = fontSizeMm * 0.868;
      const ox = gx + fontSizeMm * 0.03;
      const oy = gy + fontSizeMm * (0.032);
      doc.addImage(pdfGlyphs.flat, 'PNG', ox, oy, glyphW, glyphH);
    };

    // ── Sharp glyph — PNG image (SHARP_PNG), matches React preview exactly ─────
    // Layout values from SHARP_PNG comment: H=0.97em  va=-0.18em  ml=0.02em  mr=0.04em  W=0.495em
    const drawSharpGlyph = (gx: number, gy: number) => {
      const glyphW = fontSizeMm * 0.5289;
      const glyphH = fontSizeMm * 0.7778;
      const ox = gx + fontSizeMm * 0.02;
      const oy = gy + fontSizeMm * (-0.0709);
      doc.addImage(pdfGlyphs.sharp, 'PNG', ox, oy, glyphW, glyphH);
    };

    // Walk through parts, drawing text or glyphs
    for (const part of parts) {
      if (/^[A-G]b$/.test(part)) {
        // Draw the note letter
        const letter = part[0];
        doc.text(letter, curX, y, { baseline: 'top' } as any);
        curX += strWidthMm(letter);
        // Draw flat glyph
        drawFlatGlyph(curX, y);
        curX += fontSizeMm * (0.47 + 0.03 + 0.11); // width + marginLeft + marginRight (PNG layout)
      } else if (/^[A-G]#$/.test(part)) {
        // Draw the note letter
        const letter = part[0];
        doc.text(letter, curX, y, { baseline: 'top' } as any);
        curX += strWidthMm(letter);
        // Draw sharp glyph
        drawSharpGlyph(curX, y);
        curX += fontSizeMm * (0.495 + 0.02 + 0.04); // width + marginLeft + marginRight (PNG layout)
      } else if (part.length > 0) {
        doc.text(part, curX, y, { baseline: 'top' } as any);
        curX += strWidthMm(part);
      }
    }
  };

  const margin = 8;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const sectionColors: { [key: string]: number[] } = {
    'Intro':      [110, 110, 110],
    'Verse':      [59,  130, 246],
    'Pre-Chorus': [168, 85,  247],
    'Chorus':     [220, 50,  50],
    'Bridge':     [22,  140, 60],
    'Instrumental':  [110, 110, 110],
    'Tag':        [249, 115, 22],
    'Outro':      [110, 110, 110],
  };

  const PILL_W = 8;
  const PILL_H = 6;
  const PILL_R = 0.5;
  const labelColWidth = 14;
  const contentStart = margin + labelColWidth + 2;

  // Short labels (v1, c1, b1, pc1) get a pill; long labels get plain colored text
  const SHORT_LABELS = ['v', 'c', 'b'];

  const drawLabel = (cx: number, rowTop: number, labelText: string, colR: number, colG: number, colB: number) => {
    const base = labelText.replace(/[0-9]/g, '');
    const usePill = SHORT_LABELS.includes(base);

    if (usePill) {
      const x = cx - PILL_W / 2;
      const y = rowTop;
      doc.setDrawColor(colR, colG, colB);
      doc.setLineWidth(0.5);
      (doc as any).roundedRect(x, y, PILL_W, PILL_H, PILL_R, PILL_R, 'S');
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(colR, colG, colB);
      doc.text(labelText, cx, y + PILL_H / 2, { align: "center", baseline: "middle" } as any);
    } else {
      // Plain colored bold text - always gray like intro, 11pt
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(110, 110, 110);
      doc.text(labelText, cx, rowTop, { align: "center", baseline: "top" } as any);
    }
    doc.setTextColor(0, 0, 0);
  };

  // ---- HEADER ----
  const headerY = margin;
  const grayColor = 150;

  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(grayColor, grayColor, grayColor);
  {
    // Draw header left: bpm + [Key] — replacing b/# with PNG glyphs
    const hFontSizeMm = 9 / ((doc.internal as any).scaleFactor);
    const hStrW = (s: string) => doc.getStringUnitWidth(s) * hFontSizeMm;

    // Helper: draw flat glyph at header scale using FLAT_PNG_ITALIC (italic, thin, pre-sheared)
    // Layout values: H=0.94em  va=-0.17em  ml=0.03em  mr=0.11em  W=0.47em
    const drawHeaderFlatGlyph = (gx: number, gy: number) => {
      const glyphW = hFontSizeMm * 0.6392;
      const glyphH = hFontSizeMm * 0.868;
      const ox = gx + hFontSizeMm * 0.002;
      const oy = gy + hFontSizeMm * (0.032);
      doc.addImage(pdfGlyphs.flatHeader, 'PNG', ox, oy, glyphW, glyphH);
    };
    const drawHeaderSharpGlyph = (gx: number, gy: number) => {
      const glyphW = hFontSizeMm * 0.5289;
      const glyphH = hFontSizeMm * 0.7778;
      const ox = gx + hFontSizeMm * 0.02;
      const oy = gy + hFontSizeMm * (-0.0709);
      doc.addImage(pdfGlyphs.sharpHeader, 'PNG', ox, oy, glyphW, glyphH);
    };

    // Build left header string, splitting on accidentals
    const bpmPart = params.bpm ? `${params.bpm} bpm  [` : '[';
    const keyStr = applyAccidentalPrefPDF(params.displayKey); // e.g. "Db" or "F#"
    const suffix = ']';

    let hx = margin;
    // Draw bpm + opening bracket
    doc.text(bpmPart, hx, headerY, { baseline: 'top' } as any);
    hx += hStrW(bpmPart);
    // Draw key — split on accidental
    const keyParts = keyStr.split(/([A-G][#b])/g);
    for (const kp of keyParts) {
      if (/^[A-G]b$/.test(kp)) {
        doc.text(kp[0], hx, headerY, { baseline: 'top' } as any);
        hx += hStrW(kp[0]);
        drawHeaderFlatGlyph(hx, headerY);
        hx += hFontSizeMm * (0.376 + 0.03 + 0.11); // visual width + marginLeft + marginRight
      } else if (/^[A-G]#$/.test(kp)) {
        doc.text(kp[0], hx, headerY, { baseline: 'top' } as any);
        hx += hStrW(kp[0]);
        drawHeaderSharpGlyph(hx, headerY);
        hx += hFontSizeMm * (0.311 + 0.02 + 0.04); // visual width + marginLeft + marginRight
      } else if (kp.length > 0) {
        doc.text(kp, hx, headerY, { baseline: 'top' } as any);
        hx += hStrW(kp);
      }
    }
    // Draw closing bracket
    doc.text(suffix, hx, headerY, { baseline: 'top' } as any);
  }

  doc.setFontSize(17);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  doc.text((params.title || "Untitled").replace(/[`\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"'), pageWidth / 2, headerY, { align: "center", baseline: "top" } as any);

  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(grayColor, grayColor, grayColor);
  if (params.writers) {
    // Split into individual names (comma-separated), wrap whole names onto new lines
    const names = params.writers.split(',').map(n => n.trim()).filter(Boolean);
    const maxWritersWidth = pageWidth / 3 - margin;
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    const writerLines: string[] = [];
    let currentLine = '';
    names.forEach((name, i) => {
      const candidate = currentLine ? currentLine + ', ' + name : name;
      doc.setFontSize(9);
      doc.setFont("helvetica", "italic");
      if (doc.getTextWidth(candidate) <= maxWritersWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) writerLines.push(currentLine);
        currentLine = name;
      }
    });
    if (currentLine) writerLines.push(currentLine);
    writerLines.forEach((wLine, wi) => {
      doc.text(wLine, pageWidth - margin, headerY + wi * 4, { align: "right", baseline: "top" } as any);
    });
  }
  doc.setTextColor(0, 0, 0);

  // Offset yPos enough for wrapped writers (title is always tallest at ~7pt tall)
  let yPos = headerY + 10;
  const sectionCounts: { [key: string]: number } = {};

  // ---- PROCESS SECTIONS ----
  // Build same combined row order as UI
  const pdfRows: Array<{type: 'section', sectionIdx: number, baseSectionIdx: number, lineOffset: number, lines: string[]} | {type: 'blank', id?: string, label: string, repeat: number}> = [];

  // Group consecutive same-label blanks into one row so they render as a horizontal pill strip
  const pushBlanks = (blanks: { id: string; afterIdx: number; label: string; repeat: number }[]) => {
    let i = 0;
    while (i < blanks.length) {
      const cur = blanks[i];
      let totalRepeat = cur.repeat ?? 1;
      let j = i + 1;
      while (j < blanks.length && blanks[j].label === cur.label) {
        totalRepeat += blanks[j].repeat ?? 1;
        j++;
      }
      pdfRows.push({ type: 'blank', label: cur.label, repeat: totalRepeat });
      i = j;
    }
  };

  params.displaySections.forEach(({ lines, baseSectionIdx, lineOffset }, sectionIdx) => {
    pdfRows.push({ type: 'section', sectionIdx, baseSectionIdx, lineOffset, lines });
    pushBlanks(params.blankSections.filter(b => b.afterIdx === sectionIdx));
  });
  pushBlanks(params.blankSections.filter(b => b.afterIdx >= params.displaySections.length));

  console.log('PDF DEBUG blankSections input:', JSON.stringify(params.blankSections));
  console.log('PDF DEBUG pdfRows (blank only):', JSON.stringify(pdfRows.filter(r => r.type === 'blank')));
  console.log('PDF DEBUG all pdfRows:', JSON.stringify(pdfRows.map(r => r.type === 'section' ? { type: 'section', label: params.sectionLabels[r.sectionIdx], repeat: params.sectionRepeats[r.sectionIdx], lineCount: r.lines.length, hasContent: r.lines.some(l => l.replace(/[\u00A0\uFFFC\u200B]/g,'').trim()) } : r)));

  // Calculate total content height to decide if we need compressed line spacing
  const calcTotalHeight = (spacing: number) => {
    let h = 0;
    pdfRows.forEach(row => {
      if (row.type === 'blank') {
        const blankBase = row.label === 'Verse' ? 'v' : row.label === 'Chorus' ? 'c' : row.label === 'Bridge' ? 'b' :
          row.label === 'Pre-Chorus' ? 'prech' : row.label === 'Instrumental' ? 'inst' :
          row.label.toLowerCase().replace(/[^a-z]/g,'').slice(0,4);
        h += SHORT_LABELS.includes(blankBase) ? (PILL_H + 2) : (row.repeat > 1 ? 9 : 5);
        return;
      }
      let rh = 0;
      row.lines.forEach(line => {
        const fl = line.trimEnd().replace(/ /g, '\u00A0');
        if (!fl) rh += emptyLineH * spacing;
        else if (isChordLine(fl)) rh += (chordLineH + (fl.includes('[3]') ? 2.5 : 0)) * spacing;
        else rh += lyricLineH * spacing;
      });
      rh += 2;
      const rep = params.sectionRepeats[row.sectionIdx] ?? 1;
      const st = params.sectionLabels[row.sectionIdx] || 'Verse';
      const hasContent = row.lines.some((l: string) => l.replace(/[\u00A0\uFFFC\u200B]/g,'').trim());
      const pill = (hasContent && ['Verse','Chorus','Bridge'].includes(st)) ? rep * (PILL_H + 2) : PILL_H + 2;
      h += Math.max(rh, pill);
    });
    return h;
  };
  // Calculate font sizes first — must happen before spacing simulation
  // Available width for text: from contentStart to right margin
  const contentWidth = pageWidth - margin - contentStart;
  let chordFontSize = 13;
  let lyricFontSize = 16;
  const calcMaxLineWidth = (chordSz: number, lyricSz: number) => {
    let maxW = 0;
    pdfRows.forEach(row => {
      if (row.type === 'blank') return;
      row.lines.forEach(line => {
        let fl = line.trimEnd();
        if (fl.startsWith('"')) fl = fl.slice(1);
        if (fl.endsWith('"')) fl = fl.slice(0, -1);
        if (!fl.trim()) return;
        const isChord = isChordLine(fl);
        let measured: string;
        if (isChord) {
          // Chord lines: keep leading spaces (they position chords over lyrics), use regular spaces
          const leading = fl.match(/^\s+/)?.[0] ?? '';
          const body = fl.trimStart().replace(/\u00A0/g, ' ');
          const converted = params.displayKey !== params.originalKey
            ? transposeChordLine(body, params.originalKey, params.displayKey, params.inputType)
            : body.split(/(\s+)/).map(t => /^\s*$/.test(t) ? t : convertChord(t, params.originalKey, params.displayKey, params.inputType === 'letters')).join('');
          measured = leading + converted;
        } else {
          // Lyric lines: strip leading spaces — they're just editor indentation, not rendered width
          measured = fl.trimStart().replace(/\u00A0/g, ' ');
        }
        doc.setFontSize(isChord ? chordSz : lyricSz);
        doc.setFont('helvetica', isChord ? 'bold' : 'normal');
        const w = doc.getTextWidth(measured);
        if (w > maxW) maxW = w;
      });
    });
    return maxW;
  };
  const maxLineW = calcMaxLineWidth(chordFontSize, lyricFontSize);
  let fontScale = 1;
  if (maxLineW > contentWidth) {
    fontScale = contentWidth / maxLineW;
    chordFontSize = chordFontSize * fontScale;
    lyricFontSize = lyricFontSize * fontScale;
  }
  // Scale line height values proportionally with font size
  const chordLineH = 5.5 * fontScale;
  const lyricLineH = 6.5 * fontScale;
  const emptyLineH = 2.5 * fontScale;
  const countPages = (spacing: number) => {
    let simY = yPos;
    let pages = 1;
    const pageBottom = pageHeight - margin;
    pdfRows.forEach(row => {
      let rh = 0;
      if (row.type === 'blank') {
        const blankBase = row.label === 'Verse' ? 'v' : row.label === 'Chorus' ? 'c' : row.label === 'Bridge' ? 'b' :
          row.label === 'Pre-Chorus' ? 'prech' : row.label === 'Instrumental' ? 'inst' :
          row.label.toLowerCase().replace(/[^a-z]/g,'').slice(0,4);
        rh = SHORT_LABELS.includes(blankBase) ? (PILL_H + 2) : (row.repeat > 1 ? 9 : 5);
      } else {
        row.lines.forEach(line => {
          const fl = line.trimEnd().replace(/ /g, '\u00A0');
          if (!fl) rh += emptyLineH * spacing;
          else if (isChordLine(fl)) rh += (chordLineH + (fl.includes('[3]') ? 2.5 : 0)) * spacing;
          else rh += lyricLineH * spacing;
        });
        rh += 2;
        const rep = params.sectionRepeats[row.sectionIdx] ?? 1;
        const st = params.sectionLabels[row.sectionIdx] || 'Verse';
        const hasContent = row.lines.some((l: string) => l.replace(/[\u00A0\uFFFC\u200B]/g,'').trim());
        const pill = (hasContent && ['Verse','Chorus','Bridge'].includes(st)) ? rep * (PILL_H + 2) : PILL_H + 2;
        rh = Math.max(rh, pill);
      }
      if (simY + rh > pageBottom) { pages++; simY = margin; }
      simY += rh;
    });
    return pages;
  };
  // Start at 1.0, reduce by 0.01 steps until content fits on 1 page (min 0.6)
  let lineSpacing = 1.0;
  while (countPages(lineSpacing) > 1 && lineSpacing > 0.6) {
    lineSpacing = Math.round((lineSpacing - 0.01) * 1000) / 1000;
  }


  pdfRows.forEach((pdfRow, pdfRowIdx) => {
    if (pdfRow.type === 'blank') {
      const { label: blankLabel, repeat: blankRepeat = 1 } = pdfRow;
      const blankColor = sectionColors[blankLabel] || [110, 110, 110];
      const [br, bg2, bb] = blankColor;
      const blankBase = blankLabel === 'Verse' ? 'v' : blankLabel === 'Chorus' ? 'c' : blankLabel === 'Bridge' ? 'b' : blankLabel === 'Pre-Chorus' ? 'prech' : blankLabel === 'Instrumental' ? 'inst' : blankLabel.toLowerCase().replace(/[^a-z]/g,'').slice(0,4);
      const usePill = SHORT_LABELS.includes(blankBase);
      if (!sectionCounts[blankBase]) sectionCounts[blankBase] = 0;
      sectionCounts[blankBase] += usePill ? blankRepeat : 1;
      const bpX = margin + labelColWidth / 2;
      const blankRowHeight = usePill ? (PILL_H + 2) : (blankRepeat > 1 ? 9 : 5);
      if (yPos + blankRowHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
      const blankBgVal = pdfRowIdx % 2 === 0 ? 255 : 243;
      doc.setFillColor(blankBgVal, blankBgVal, blankBgVal);
      doc.rect(margin - 1, yPos - 1, pageWidth - (margin * 2) + 2, blankRowHeight + 1, 'F');
      if (usePill) {
        const pillGap = 2;
        for (let rep = 0; rep < blankRepeat; rep++) {
          const repLabel = blankBase + (sectionCounts[blankBase] - blankRepeat + 1 + rep);
          const pillX = margin + labelColWidth / 2 - PILL_W / 2 + rep * (PILL_W + pillGap);
          doc.setDrawColor(br, bg2, bb); doc.setLineWidth(0.5);
          (doc as any).roundedRect(pillX, yPos, PILL_W, PILL_H, PILL_R, PILL_R, 'S');
          doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(br, bg2, bb);
          doc.text(repLabel, pillX + PILL_W / 2, yPos + PILL_H / 2, { align: "center", baseline: "middle" } as any);
        }
      } else {
        const baseText = blankLabel === 'Pre-Chorus' ? 'pre ch' : blankLabel === 'Instrumental' ? 'inst' : blankLabel === 'Verse' ? 'verse' : blankLabel.toLowerCase();
        doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(110, 110, 110);
        doc.text(baseText, bpX, yPos, { align: "center", baseline: "top" } as any);
        if (blankRepeat > 1) doc.text('x' + blankRepeat, bpX, yPos + 4, { align: "center", baseline: "top" } as any);
      }
      doc.setTextColor(0, 0, 0);
      yPos += blankRowHeight;
      return;
    }

    const { sectionIdx, baseSectionIdx, lineOffset, lines: section } = pdfRow;
    let rowHeight = 0;
    section.forEach(line => {
      const fl = line.trimEnd().replace(/ /g, '\u00A0');
      if (fl.length === 0) rowHeight += emptyLineH * lineSpacing;
      else if (isChordLine(fl)) rowHeight += (chordLineH + (fl.includes('[3]') ? 2.5 : 0)) * lineSpacing;
      else rowHeight += lyricLineH * lineSpacing;
    });
    rowHeight += 2; // minimal buffer for descenders (g, y, p etc)
    // Only expand row if pill stack is taller than content
    const repeatsForHeight = params.sectionRepeats[sectionIdx] ?? 1;
    const sectionTypeForHeight = params.sectionLabels[sectionIdx] || 'Verse';
    const usesPillStack = ['Verse','Chorus','Bridge'].includes(sectionTypeForHeight);
    const hasContentLines = section.some(l => l.replace(/[\u00A0\uFFFC\u200B\u200C\u200D\uFEFF]/g,'').trim());
    const pillStackHeight = (usesPillStack && hasContentLines) ? repeatsForHeight * (PILL_H + 2) - 2 + 2 : PILL_H + 2;
    rowHeight = Math.max(rowHeight, pillStackHeight);

    if (yPos + rowHeight > pageHeight - margin) {
      doc.addPage();
      yPos = margin;
    }

    // Alternating row background
    const bgVal = pdfRowIdx % 2 === 0 ? 255 : 243;
    doc.setFillColor(bgVal, bgVal, bgVal);
    doc.rect(margin - 1, yPos - 1, pageWidth - (margin * 2) + 2, rowHeight + 1, 'F');

    // ---- PILL LABEL ----
    const sectionType = params.sectionLabels[sectionIdx] || 'Verse';
    const color = sectionColors[sectionType] || [110, 110, 110];
    const [r, g, b] = color;

    let labelText = '';
    const repeatsCount = params.sectionRepeats[sectionIdx] ?? 1;
    if (sectionType === 'Intro') {
      labelText = 'intro';
    } else if (sectionType === 'Outro') {
      labelText = 'outro';
    } else if (sectionType === 'Verse') {
      if (!sectionCounts['v']) sectionCounts['v'] = 0;
      sectionCounts['v'] += repeatsCount;
      labelText = 'v' + sectionCounts['v'];
    } else if (sectionType === 'Chorus') {
      if (!sectionCounts['c']) sectionCounts['c'] = 0;
      sectionCounts['c'] += repeatsCount;
      labelText = 'c' + sectionCounts['c'];
    } else if (sectionType === 'Bridge') {
      if (!sectionCounts['b']) sectionCounts['b'] = 0;
      sectionCounts['b'] += repeatsCount;
      labelText = 'b' + sectionCounts['b'];
    } else if (sectionType === 'Pre-Chorus') {
      if (!sectionCounts['prech']) sectionCounts['prech'] = 1; else sectionCounts['prech']++;
      labelText = 'pre ch' + sectionCounts['prech'];
    } else if (sectionType === 'Tag') {
      if (!sectionCounts['tag']) sectionCounts['tag'] = 1; else sectionCounts['tag']++;
      labelText = 'tag' + sectionCounts['tag'];
    } else if (sectionType === 'Instrumental') {
      if (!sectionCounts['inst']) sectionCounts['inst'] = 1; else sectionCounts['inst']++;
      labelText = 'inst' + sectionCounts['inst'];
    } else {
      const k2 = sectionType.toLowerCase();
      if (!sectionCounts[k2]) sectionCounts[k2] = 1; else sectionCounts[k2]++;
      labelText = k2 + sectionCounts[k2];
    }

    const sectionStartY = yPos;

    const pillX = margin + labelColWidth / 2;
    const repeats = params.sectionRepeats[sectionIdx] ?? 1;

    // ---- SECTION CONTENT ----
    // Find yPos of first non-empty line to align label with it
    let pillDrawn = false;
    section.forEach((line, lineIdx) => {
      let processedLine = line;
      if (processedLine.endsWith('"')) processedLine = processedLine.slice(0, -1);
      if (processedLine.startsWith('"')) processedLine = processedLine.slice(1);
      // Skip the section label line — it's just the header, not content to render
      // In new format the " is alone (processedLine becomes empty); in old format it had inline content
      if (line.startsWith('"') && processedLine.trim() === '') return;
      // Apply chord nudge overrides (only when in original key)
      const pdfLineKey = `${baseSectionIdx}-${lineOffset + lineIdx}`;
      if (params.lineOverrides[pdfLineKey]) processedLine = params.lineOverrides[pdfLineKey].replace(/^"/, '');
      // When transposing, strip nudge spacing — extract tokens and rejoin with single spaces
      const isChordForSpacing = isChordLine(processedLine.replace(/\u00A0/g, ' '));
      // Normalize Unicode ♭/♯ → ASCII so transposeChordLine and applyAccidentalPrefToLinePDF both work correctly
      if (isChordForSpacing) {
        processedLine = processedLine
          .replace(/\u00A0/g, ' ')
          .replace(/([A-G])\u266D/g, '$1b')
          .replace(/([A-G])\u266F/g, '$1#');
      }
      if (params.displayKey !== params.originalKey && isChordForSpacing) {
        processedLine = transposeChordLine(processedLine, params.originalKey, params.displayKey, params.inputType);
      }
      // Apply flat/sharp preference to chord lines (honours the ♭/♯ toggle from the preview)
      if (isChordForSpacing) {
        processedLine = applyAccidentalPrefToLinePDF(processedLine);
      }
      // Replace Unicode ligatures that jsPDF/Helvetica can't render correctly
      processedLine = processedLine
        .replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl')
        .replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/ﬅ/g, 'st')
        .replace(/ﬆ/g, 'st');
      const finalLine = processedLine.trimEnd().replace(/ /g, '\u00A0');

      if (finalLine.length > 0) {
        if (!pillDrawn) {
          const base = labelText.replace(/[0-9]/g, '');
          const usePill = SHORT_LABELS.includes(base);

          if (usePill) {
            // Stacked pills: one per repeat
            for (let rep = 0; rep < repeats; rep++) {
              const repLabel = base + (sectionCounts[base] - repeats + 1 + rep);
              const pillY = yPos + rep * (PILL_H + 2);
              const x = pillX - PILL_W / 2;
              doc.setDrawColor(r, g, b);
              doc.setLineWidth(0.5);
              (doc as any).roundedRect(x, pillY, PILL_W, PILL_H, PILL_R, PILL_R, 'S');
              doc.setFontSize(10);
              doc.setFont("helvetica", "bold");
              doc.setTextColor(r, g, b);
              doc.text(repLabel, pillX, pillY + PILL_H / 2, { align: "center", baseline: "middle" } as any);
              doc.setTextColor(0, 0, 0);
            }
          } else {
            // Plain text with xN suffix if repeats > 1
            doc.setFontSize(10);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(110, 110, 110);
            doc.text(labelText, pillX, yPos, { align: "center", baseline: "top" } as any);
            if (repeats > 1) doc.text(`x${repeats}`, pillX, yPos + 4, { align: "center", baseline: "top" } as any);
            doc.setTextColor(0, 0, 0);
          }
          pillDrawn = true;
        }
        if (isChordLine(finalLine)) {
          const hasTriplet = finalLine.includes('[3]');
          if (hasTriplet) yPos += 2.5 * lineSpacing;
          doc.setFontSize(chordFontSize);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(0, 0, 0);
          // If transposing, line was already converted by transposeChordLine — don't double-convert
          const convertedRaw = params.displayKey !== params.originalKey
            ? finalLine.replace(/\u00A0/g, ' ')
            : finalLine.split(/(\s+)/).map(t => /^\s*$/.test(t) ? t : t === '[3]' ? t : convertChord(t, params.originalKey, params.displayKey, params.inputType === "letters")).join('');
          // Apply flat/sharp preference after conversion (convertChord uses a sharps-only chromatic
          // scale internally, so Bb → A# unless we re-apply the user's accidental preference here)
          const converted = applyAccidentalPrefToLinePDF(convertedRaw.replace(/([A-G])\u266D/g, '$1b').replace(/([A-G])\u266F/g, '$1#'));
          // Draw triplet brackets if [3] markers present
          if (converted.includes('[3]')) {
            const bracketColor = [127, 119, 221] as [number, number, number];
            // Split on [3] to get segments; build display string and track which
            // chord tokens fall in each triplet group
            const segments = converted.split(/\[3\]/);
            let displayStr = '';
            // For each [3], record the char-end index of the preceding segment
            const markerAfterCharIdx: number[] = [];
            segments.forEach((seg, si) => {
              displayStr += seg;
              if (si < segments.length - 1) markerAfterCharIdx.push(displayStr.length);
            });
            // Measure PDF x-positions of every non-space token in displayStr
            doc.setFontSize(chordFontSize);
            doc.setFont("helvetica", "bold");
            const pdfToks: {charStart: number; charEnd: number; xStart: number; xMid: number; xEnd: number}[] = [];
            const tokRe = /\S+/g;
            let tokM: RegExpExecArray | null;
            while ((tokM = tokRe.exec(displayStr)) !== null) {
              const before = displayStr.slice(0, tokM.index).replace(/\u00A0/g, ' ');
              const tokStr = tokM[0].replace(/\u00A0/g, ' ');
              const xStart = contentStart + doc.getTextWidth(before);
              const xEnd = xStart + doc.getTextWidth(tokStr);
              pdfToks.push({ charStart: tokM.index, charEnd: tokM.index + tokM[0].length, xStart, xMid: (xStart + xEnd) / 2, xEnd });
            }
            // For each [3] marker find the 3 chord tokens ending before it
            const bracketY = yPos - 0.5;
            const lineY = bracketY - 2;
            const tickH = 2;
            markerAfterCharIdx.forEach(endIdx => {
              const group = pdfToks.filter(t => t.charEnd <= endIdx);
              if (group.length >= 3) {
                const t1 = group[group.length - 3];
                const t2 = group[group.length - 2];
                const t3 = group[group.length - 1];
                doc.setDrawColor(...bracketColor);
                doc.setLineWidth(0.4);
                // left tick over chord 1
                doc.line(t1.xStart, bracketY, t1.xStart, lineY);
                // line from chord 1 to just before 3
                doc.line(t1.xStart, lineY, t2.xMid - 1.5, lineY);
                // 3 label centered over chord 2
                doc.setFontSize(7);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(...bracketColor);
                doc.text('3', t2.xMid, lineY, { align: 'center', baseline: 'top' } as any);
                doc.setFontSize(chordFontSize);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(0, 0, 0);
                // line from after 3 to chord 3
                doc.line(t2.xMid + 1.5, lineY, t3.xEnd, lineY);
                // right tick over chord 3
                doc.line(t3.xEnd, lineY, t3.xEnd, bracketY);
              }
            });
            drawChordLine(displayStr, contentStart, yPos, chordFontSize);
          } else {
            drawChordLine(converted, contentStart, yPos, chordFontSize);
          }
          yPos += chordLineH * lineSpacing;
        } else {
          doc.setFontSize(lyricFontSize);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(0, 0, 0);
          doc.text(finalLine, contentStart, yPos, { baseline: "top" } as any);
          yPos += lyricLineH * lineSpacing;
        }
      } else {
        yPos += emptyLineH * lineSpacing;
      }
    });

    // Advance by full rowHeight so pill stacks never overlap next section
    // If section was entirely empty, still draw the label
    if (!pillDrawn) {
      const base = labelText.replace(/[0-9]/g, '');
      const usePill = SHORT_LABELS.includes(base);
      if (usePill) {
        const pillGap = 2;
        for (let rep = 0; rep < repeats; rep++) {
          const repLabel = base + (sectionCounts[base] - repeats + 1 + rep);
          const px = margin + labelColWidth / 2 - PILL_W / 2 + rep * (PILL_W + pillGap);
          doc.setDrawColor(r, g, b);
          doc.setLineWidth(0.5);
          (doc as any).roundedRect(px, sectionStartY, PILL_W, PILL_H, PILL_R, PILL_R, 'S');
          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(r, g, b);
          doc.text(repLabel, px + PILL_W / 2, sectionStartY + PILL_H / 2, { align: "center", baseline: "middle" } as any);
          doc.setTextColor(0, 0, 0);
        }
      } else {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(110, 110, 110);
        doc.text(labelText, pillX, sectionStartY, { align: "center", baseline: "top" } as any);
        if (repeats > 1) doc.text(`x${repeats}`, pillX, sectionStartY + 4, { align: "center", baseline: "top" } as any);
        doc.setTextColor(0, 0, 0);
      }
    }

    yPos = sectionStartY + rowHeight;
  });

  // PDF save — platform-aware
  const safeName = (params.title || 'chart')
    .replace(/[`''""]/g, '')           // strip smart quotes and backticks
    .replace(/[^a-zA-Z0-9 _\-]/g, ' ') // replace other special chars with space
    .replace(/\s+/g, ' ').trim() || 'chart';
  const fileName = `${safeName}_${params.displayKey}.pdf`;
  // jsPDF's doc.save() builds an anchor href internally — # in the name breaks URL parsing,
  // so encode it. The anchor .download attribute doesn't have this issue.
  const saveFileName = fileName.replace(/#/g, '%23');

  if (Capacitor.isNativePlatform()) {
    // iOS WKWebView: Generate the blob FIRST while the jsPDF document is fully intact,
    // then decide delivery. Never fire multiple strategies in parallel — that races and
    // produces 0-byte downloads. Never use data: URIs for Browser.open — WKWebView has
    // strict size limits that silently truncate large PDFs to 0 bytes.
    //
    // Strategy: anchor-click with a blob URL is the most reliable single path on iOS.
    // Keep the blob URL alive for 120 s so Safari's async download pipeline never hits
    // a revoked URL mid-transfer.
    const blob = doc.output('blob');  // serialize NOW, before anything else
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    // Remove the element quickly, but keep the blob URL alive much longer
    setTimeout(() => document.body.removeChild(a), 500);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000); // 120 s — Safari needs this
  } else {
    doc.save(saveFileName);
  }
}

function bakeOverridesIntoInput(input: string, lineOverrides: { [key: string]: string }): string {
  if (!lineOverrides || Object.keys(lineOverrides).length === 0) return input;

  // Parse input into raw lines preserving structure
  const rawLines = input.split('\n');

  // Build baseSections tracking which rawLine index each section/line came from
  const sectionLineMap: Array<Array<number>> = []; // sectionLineMap[sectionIdx][lineIdx] = rawLineIndex
  let cur: number[] = [];

  rawLines.forEach((line, rIdx) => {
    if (line.startsWith('"')) {
      if (cur.length > 0) sectionLineMap.push(cur);
      // Only include this line in the map if it has inline content (old format)
      // In the new format the " is alone — don't add it so lineIdx 0 = first content line
      const inlineContent = line.slice(1).trim();
      cur = inlineContent ? [rIdx] : [];
    } else if (line.replace(/[\u00A0\uFFFC\u200B\u200C\u200D\uFEFF]/g, '').trim() === '') {
      if (cur.length > 0) sectionLineMap.push(cur);
      cur = [];
      sectionLineMap.push([]); // blank section
    } else {
      cur.push(rIdx);
    }
  });
  if (cur.length > 0) sectionLineMap.push(cur);

  // Apply overrides
  const result = [...rawLines];
  Object.entries(lineOverrides).forEach(([key, overrideLine]) => {
    const [sIdxStr, lIdxStr] = key.split('-');
    const sIdx = parseInt(sIdxStr);
    const lIdx = parseInt(lIdxStr);
    if (sectionLineMap[sIdx] && sectionLineMap[sIdx][lIdx] !== undefined) {
      const rawIdx = sectionLineMap[sIdx][lIdx];
      const orig = rawLines[rawIdx];
      // Preserve the leading " or ( prefix if present
      const prefix = (orig.startsWith('"') || orig.startsWith('(')) && lIdx === 0
        ? orig[0]
        : '';
      result[rawIdx] = prefix + overrideLine.replace(/\u00A0/g, ' ');
    }
  });

  return result.join('\n');
}

function ChartEditor({ onSave, onDelete, initialSong, authUser, spotifyToken }: { onSave: (song: SavedSong) => void, onDelete?: (id: string) => void, initialSong?: SavedSong | null, authUser?: AuthUser | null, spotifyToken?: string | null }) {
  const [songInput, setSongInput] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [songBPM, setSongBPM] = useState("");
  const [songWriterList, setSongWriterList] = useState<string[]>([]);
  const [writerDraft, setWriterDraft] = useState("");
  const songWriters = songWriterList.join(', ');
  const [originalKey, setOriginalKey] = useState(() => (initialSong?.key || 'G').replace(/m$/, ''));
  const [isMinorKey, setIsMinorKey] = useState(() => (initialSong?.key || '').endsWith('m'));
  const [key, setKey] = useState("G");
  const [sectionLabels, setSectionLabels] = useState<string[]>([]);
  const [sectionRepeats, setSectionRepeats] = useState<number[]>([]);
  const loadedLabelsRef = React.useRef(initialSong?.sectionLabels && initialSong.sectionLabels.length > 0);
  const lastBlurTime = React.useRef<number>(0);
  const pasteJustFired = React.useRef<boolean>(false);
  const [saveToPublic, setSaveToPublic] = useState(false);
  const [showSourceEditor, setShowSourceEditor] = useState(!initialSong);

  // Spotify track linking
  const [spotifyTrackId, setSpotifyTrackId] = useState<string>(initialSong?.spotify_track_id || '');
  const [artistName, setArtistName] = useState<string>(initialSong?.artistName || '');
  const [spotifySearchQuery, setSpotifySearchQuery] = useState('');
  const [spotifyResults, setSpotifyResults] = useState<any[]>([]);
  const [spotifySearching, setSpotifySearching] = useState(false);
  const [showSpotifySearch, setShowSpotifySearch] = useState(false);

  // Auto-fill artist name from Spotify when a track is already linked
  React.useEffect(() => {
    if (!spotifyToken || !spotifyTrackId || artistName) return;
    fetch(`https://api.spotify.com/v1/tracks/${spotifyTrackId}`, {
      headers: { Authorization: `Bearer ${spotifyToken}` }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.artists?.length) {
          setArtistName(data.artists.map((a: any) => a.name).join(', '));
        }
      })
      .catch(() => {});
  }, [spotifyToken, spotifyTrackId]);

  // PDF import
  const [pdfImporting, setPdfImporting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfInputRef = React.useRef<HTMLInputElement>(null);

  const searchSpotify = async () => {
    if (!spotifyToken || !spotifySearchQuery.trim()) return;
    setSpotifySearching(true);
    const results = await spotifySearch(spotifySearchQuery, spotifyToken);
    setSpotifyResults(results);
    setSpotifySearching(false);
  };
  
  // SongSelect PDF Parser
  const handleSongSelectPdf = async (pdf: any) => {
    try {
      // Extract text from PDF preserving line structure
      type PdfItem = { x: number; str: string; fontSize?: number };
      type PdfLine = { y: number; items: PdfItem[]; text: string; avgFontSize: number };
      const allLines: PdfLine[] = [];
      
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        
        // Group items by Y position to preserve lines
        // Use a tolerance to group items that are close vertically (for superscripts)
        const byY: Map<number, any[]> = new Map();
        const yTolerance = 8; // pixels - increased to better capture superscripts like F5, Bb2
        
        for (const item of content.items as any[]) {
          const y = Math.round(item.transform[5]);
          const x = item.transform[4];
          const fontSize = Math.abs(item.transform[0]);
          
          // Find if there's already a Y coordinate within tolerance
          let foundY: number | null = null;
          const existingYs = Array.from(byY.keys());
          for (const existingY of existingYs) {
            if (Math.abs(existingY - y) <= yTolerance) {
              foundY = existingY;
              break;
            }
          }
          
          const targetY = foundY !== null ? foundY : y;
          if (!byY.has(targetY)) byY.set(targetY, []);
          byY.get(targetY)!.push({ x, str: item.str, fontSize });
        }
        
        // Sort by Y (top to bottom) and build lines
        const sorted = Array.from(byY.entries()).sort((a, b) => b[0] - a[0]);
        for (const [y, items] of sorted) {
          items.sort((a, b) => a.x - b.x); // Sort by X
          const realItems = items.filter((i: any) => i.str.trim().length > 0);
          if (realItems.length === 0) continue;
          
          // Build text by position - insert items at their X positions
          // This helps preserve spacing for chords
          let lineText = '';
          let lastX = realItems[0].x;
          
          for (const item of realItems) {
            const gap = item.x - lastX;
            // If there's a significant gap, add a space
            if (gap > 5 && lineText.length > 0) {
              lineText += ' ';
            }
            lineText += item.str;
            lastX = item.x + (item.str.length * 5); // Approximate width
          }
          
          const text = lineText.trim();
          const avgFontSize = realItems.reduce((sum: number, i: any) => sum + (i.fontSize || 0), 0) / realItems.length;
          
          if (text) {
            allLines.push({ y, items: realItems, text, avgFontSize });
          }
        }
      }
      
      // Post-process: split any line where a section keyword is merged with lyrics
      // (happens when label and first lyric land on the same Y position in the PDF)
      const splitKeywords = ['VERSE', 'CHORUS', 'BRIDGE', 'INSTRUMENTAL', 'TURNAROUND', 'PRE-CHORUS', 'INTRO', 'ENDING', 'TAG'];
      const expandedLines: typeof allLines = [];
      for (const line of allLines) {
        const clean = line.text.replace(/[\u00A0\u200B\uFEFF]/g, ' ').trim();
        const upper = clean.toUpperCase();
        const kw = splitKeywords.find(k => upper.startsWith(k));
        if (kw) {
          // Extract label: keyword + optional number (e.g. "Verse 1", "Chorus 1a")
          const afterKw = clean.slice(kw.length);
          const numMatch = afterKw.match(/^\s*[\d\w]*/);
          const labelPart = (kw.charAt(0) + kw.slice(1).toLowerCase() + (numMatch ? numMatch[0] : '')).trim();
          const restPart = clean.slice(labelPart.length).trim();
          expandedLines.push({ ...line, text: labelPart });
          if (restPart) expandedLines.push({ ...line, text: restPart });
        } else {
          expandedLines.push(line);
        }
      }
      allLines.length = 0;
      expandedLines.forEach(l => allLines.push(l));

      // Parse metadata
      let title = '';
      let writers = '';
      let key = '';
      let bpm = '';
      let metadataEndIdx = 0;
      
      // First line is typically the title
      if (allLines.length > 0) {
        title = allLines[0].text;
        metadataEndIdx = 1;
      }
      
      // Look for metadata in early lines
      for (let i = 1; i < Math.min(10, allLines.length); i++) {
        const line = allLines[i].text;
        
        // Writers line (contains |)
        if (line.includes('|') && !line.startsWith('Key') && !writers) {
          writers = line;
          metadataEndIdx = i + 1;
        }
        
        // Key, Tempo, Time line
        if (line.startsWith('Key')) {
          const parts = line.split('|');
          parts.forEach(part => {
            part = part.trim();
            if (part.startsWith('Key')) {
              key = part.split('-')[1]?.trim() || '';
            } else if (part.startsWith('Tempo')) {
              bpm = part.split('-')[1]?.trim() || '';
            }
          });
          metadataEndIdx = i + 1;
        }
        
        // Stop when we hit a section keyword
        if (/^(VERSE|CHORUS|BRIDGE|INSTRUMENTAL|TURNAROUND|PRE-CHORUS|INTRO|ENDING|TAG)/i.test(line)) {
          break;
        }
      }
      
      // Parse sections
      const sections: Array<{ label: string; lines: string[] }> = [];
      let currentSection: { label: string; lines: string[] } | null = null;
      
      const sectionKeywords = ['VERSE', 'CHORUS', 'BRIDGE', 'INSTRUMENTAL', 'TURNAROUND', 'PRE-CHORUS', 'INTRO', 'ENDING', 'TAG'];
      
      for (let i = metadataEndIdx; i < allLines.length; i++) {
        const line = allLines[i];
        const text = line.text;
        
        // Stop at CCLI info
        if (text.includes('CCLI Song') || text.includes('CCLI License')) break;
        
        // Skip copyright lines
        if (text.includes('©') || text.includes('For use solely') || text.includes('www.ccli.com')) continue;
        
        // Check for section header
        // Strip invisible/non-breaking chars before matching
        const cleanText = text.replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ').trim();
        const sectionMatch = sectionKeywords.find(kw => cleanText.toUpperCase().startsWith(kw));
        
        if (sectionMatch) {
          // Save previous section
          if (currentSection && currentSection.lines.length > 0) {
            sections.push(currentSection);
          }
          
          // Start new section
          const sectionType = sectionMatch.charAt(0) + sectionMatch.slice(1).toLowerCase();
          const normalizedType = sectionType === 'Prechorus' ? 'Pre-Chorus' : sectionType;
          const numberMatch = cleanText.match(/\d+/);
          const sectionLabel = normalizedType + (numberMatch ? ' ' + numberMatch[0] : '');
          
          currentSection = { label: sectionLabel, lines: [] };
          console.log(`Created section: ${sectionLabel} from line: "${text}"`);
          // DON'T add the section header text itself to the lines
        } else if (currentSection && /^\d+$/.test(cleanText) && !currentSection.label.match(/\d/)) {
          // Standalone number line right after a section header — append to label (e.g. "Verse" + "1" → "Verse 1")
          currentSection.label = currentSection.label + ' ' + cleanText;
          console.log(`  Appended number to label: "${currentSection.label}"`);
        } else if (currentSection && cleanText) {
          // Skip if the line is itself a section keyword/label
          const cleanUpper = cleanText.toUpperCase();
          const isLabelLine = sectionKeywords.some(kw => cleanUpper.startsWith(kw));
          if (!isLabelLine) {
            currentSection.lines.push(text);
            console.log(`  Added content to ${currentSection.label}: "${text}"`);
          } else {
            console.log(`  Skipped label line: "${text}"`);
          }
        }
      }
      
      // Add last section
      if (currentSection && currentSection.lines.length > 0) {
        sections.push(currentSection);
      }
      
      // Debug: log sections
      console.log('Final sections:', sections.map(s => ({
        label: s.label,
        lineCount: s.lines.length,
        firstLine: s.lines[0]
      })));
      
      // Build formatted input for the app
      const inputLines: string[] = [];
      const extractedLabels: string[] = [];
      const extractedRepeats: number[] = [];
      
      // Pattern that matches any section label line — strip these from content entirely
      const labelPattern = /^(verse|chorus|bridge|pre-chorus|instrumental|turnaround|intro|ending|outro|tag)[\s\d\w]*/i;
      sections.forEach(section => {
        // Add section marker
        inputLines.push('"' + section.label);
        extractedLabels.push(section.label);
        extractedRepeats.push(1);
        
        // Add section content — filter out any lines that are just label names
        section.lines
          .filter(line => !labelPattern.test(line.trim()))
          .forEach(line => inputLines.push(line));
      });
      
      // Debug: log what we're setting as songInput
      console.log('Setting songInput with', inputLines.length, 'lines');
      console.log('First 10 lines:', inputLines.slice(0, 10));
      
      console.log('SongSelect sections found:', sections.length);
      console.log('Title:', title);
      console.log('Writers:', writers);
      console.log('Key:', key, 'BPM:', bpm);
      
      // Populate editor fields
      if (title) setSongTitle(title);
      if (writers) setSongWriterList(writers.split('|').map(w => w.trim()).filter(Boolean));
      if (bpm) setSongBPM(bpm);
      if (key) { setOriginalKey(key); setKey(key); }
      
      if (sections.length) {
        setSongInput(inputLines.join('\n'));
        setSectionLabels(extractedLabels.map(label => {
          // Convert to dropdown values
          if (label.startsWith('Verse')) return 'Verse';
          if (label.startsWith('Chorus')) return 'Chorus';
          if (label.startsWith('Bridge')) return 'Bridge';
          if (label.startsWith('Pre-Chorus')) return 'Pre-Chorus';
          if (label.startsWith('Instrumental')) return 'Instrumental';
          if (label.startsWith('Intro')) return 'Intro';
          if (label.startsWith('Ending')) return 'Outro';
          if (label.startsWith('Tag')) return 'Tag';
          return 'Verse';
        }));
        setSectionRepeats(extractedRepeats);
        loadedLabelsRef.current = true;
      }
      
      console.log('SongSelect PDF imported successfully');
    } catch (e: any) {
      console.error('SongSelect PDF import error:', e);
      throw e;
    }
  };

  const handlePdfImport = async (file: File) => {
    setPdfImporting(true);
    setPdfError(null);
    try {
      // Load PDF.js from CDN
      if (!(window as any).pdfjsLib) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script.onload = () => resolve();
          script.onerror = reject;
          document.body.appendChild(script);
        });
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      // Read PDF bytes
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await (window as any).pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // Extract text from first page to detect format
      const firstPage = await pdf.getPage(1);
      const firstPageContent = await firstPage.getTextContent();
      const firstPageText = firstPageContent.items.map((item: any) => item.str).join(' ');
      
      // Detect if this is a SongSelect PDF
      // SongSelect PDFs have characteristic patterns:
      // - "SongSelect" text or logo
      // - "Key - X | Tempo - Y | Time - Z/Z" format
      // - Section headers like "VERSE 1", "CHORUS", "BRIDGE"
      // - CCLI Song # at the bottom
      const isSongSelect = 
        firstPageText.includes('SongSelect') ||
        /Key\s*-\s*[A-G][b#]?\s*\|\s*Tempo\s*-\s*\d+/.test(firstPageText) ||
        (/VERSE\s+\d/.test(firstPageText) && /CHORUS/.test(firstPageText) && /CCLI/.test(firstPageText));
      
      if (isSongSelect) {
        console.log('Detected SongSelect PDF format');
        await handleSongSelectPdf(pdf);
        return;
      }
      
      console.log('Detected standard PDF format');
      // Continue with existing PDF parser...

      // Extract all text items grouped by Y position, preserving x coordinates
      type PdfItem = { x: number; str: string; fontSize?: number };
      type PdfLine = { y: number; items: PdfItem[]; text: string };
      let allLines: PdfLine[] = [];

      // Track font sizes from PDF to calculate spacing ratio
      type FontInfo = { size: number; count: number };
      const chordFontSizes: FontInfo[] = [];
      const lyricFontSizes: FontInfo[] = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();

        // Group by Y (rounded to nearest pt to merge items on same line)
        // Use tolerance to capture superscripts (like F5, Bb2)
        const byY: Map<number, PdfItem[]> = new Map();
        const yTolerance = 8; // pixels - group items within 8px vertically
        
        for (const item of content.items as any[]) {
          const y = Math.round(item.transform[5]);
          const x = item.transform[4];
          // Extract font size from transform matrix (item.transform[0] is the font size scale)
          const fontSize = Math.abs(item.transform[0]);
          
          // Find if there's already a Y coordinate within tolerance
          let foundY: number | null = null;
          const existingYs = Array.from(byY.keys());
          for (const existingY of existingYs) {
            if (Math.abs(existingY - y) <= yTolerance) {
              foundY = existingY;
              break;
            }
          }
          
          const targetY = foundY !== null ? foundY : y;
          if (!byY.has(targetY)) byY.set(targetY, []);
          byY.get(targetY)!.push({ x, str: item.str, fontSize } as any);
        }

        const sorted = Array.from(byY.entries()).sort((a, b) => b[0] - a[0]);
        for (const [y, items] of sorted) {
          items.sort((a, b) => a.x - b.x);
          const realItems = items.filter(i => i.str.trim().length > 0);
          if (!realItems.length) continue;
          // Simple joined text for classification purposes
          const text = realItems.map(i => i.str).join(' ').trim();
          if (text && !(text.length <= 2 && /^[-–—|]+$/.test(text))) {
            allLines.push({ y, items: realItems, text });
          }
        }
      }


      // Header structure (confirmed from PDF.js):
      // Line 0: "75 bpm [C-D]   Chris Tomlin, Ed Cash, George Job Elvey"
      // Line 1: "Crown Him (Majesty)"
      // Line 2: "Godfrey Thring, Matt Maher, Matthew Bridges"
      // Line 3+: chord/lyric content
      let bpm = '';
      let title = '';
      let writers: string[] = [];
      let key = '';

      const isNameList = (s: string) =>
        s.includes(',') && /^[A-Z][a-z]/.test(s.trim()) && !/^[A-G][b#]?(\s|$)/.test(s.trim());

      // Check if a string looks like a single person's name (no comma)
      const isSingleName = (s: string) => {
        const t = s.trim();
        // Must start with capital letter, have 2-4 words, each capitalized
        // Not too long (typical name is 10-40 chars)
        if (t.length < 5 || t.length > 50) return false;
        const words = t.split(/\s+/);
        if (words.length < 2 || words.length > 4) return false;
        // Each word should start with capital letter
        if (!words.every(w => /^[A-Z][a-z]+/.test(w))) return false;
        // Should not be a title (titles often have common words like "The", "Of", etc.)
        // Single names typically don't have these
        return true;
      };

      // Title: no commas, not a chord line, not bpm, contains letters, reasonable length
      // Must have mixed case words (not all-caps chords) and no chord-like tokens
      // Titles typically have articles, prepositions, or multiple words
      const isTitle = (s: string) => {
        const t = s.trim();
        if (!t || t.includes(',')) return false;
        if (/\d+\s*bpm/i.test(t)) return false;
        if (/^[A-G][b#]?(\s|\/|$|\d)/.test(t)) return false; // starts with a chord
        if (/[\/|]/.test(t)) return false; // has rhythm markers
        if (!/[a-z]/.test(t)) return false; // must have lowercase letters (not all-caps chords)
        // Should have reasonable length (typically 3-80 characters for a song title)
        if (t.length < 3 || t.length > 80) return false;
        
        const words = t.split(/\s+/);
        
        // If only 2 words and both are simply capitalized (e.g., "Stuart Townend"), likely a name not a title
        if (words.length === 2 && words.every(w => /^[A-Z][a-z]+$/.test(w))) {
          return false; // Reject simple "FirstName LastName" patterns
        }
        
        // Titles typically have 3+ words OR contain common title words
        if (words.length >= 3) return true;
        
        // For 2-word titles, check for common title patterns
        if (words.length === 2 && /\b(the|of|for|in|on|to|from|with|my|your|his|her|our|is|are)\b/i.test(t)) {
          return true;
        }
        
        return false;
      };

      let headerEnd = 0;
      for (let i = 0; i < Math.min(6, allLines.length); i++) {
        const l = allLines[i].text.trim();
        if (!l) { headerEnd = i + 1; continue; }

        const bpmM = l.match(/(\d+)\s*bpm/i);
        if (bpmM && !bpm) bpm = bpmM[1];
        const keyM = l.match(/\[([A-Gb#]+)(?:-[A-Gb#]+)?\]/);
        if (keyM && !key) key = keyM[1];

        const clean = l.replace(/\d+\s*bpm/i, '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();

        if (isNameList(clean)) {
          writers = writers.concat(clean.split(',').map((w: string) => w.trim()).filter(Boolean));
          headerEnd = i + 1;
        } else if (title && isSingleName(clean)) {
          // If we already have a title, this is likely a writer
          writers.push(clean);
          headerEnd = i + 1;
        } else if (isTitle(clean)) {
          if (!title) title = clean; // Only set title once (first occurrence)
          headerEnd = i + 1;
        } else if (!clean) {
          headerEnd = i + 1;
        } else if (isSingleName(clean)) {
          // Name without a title yet - likely first line with BPM/key + writer
          writers.push(clean);
          headerEnd = i + 1;
        } else {
          break;
        }
      }

      console.log(`PDF Header - Title: "${title}", BPM: ${bpm}, Key: ${key}, Writers: [${writers.join(', ')}]`);

      const bodyLines = allLines.slice(headerEnd);

      // ── Chord & section detection ──────────────────────────────────
      // A chord line: starts with a chord token, contains only chords/slashes/bars
      const CHORD_TOKEN = /^[A-G][b#]?(maj7?|min7?|m7?|M7?|sus[24]?|add\d|dim7?|aug|[679]|\/[A-G][b#]?)*/;
      const RHYTHM_RE = /^[\s\/|0-9]+$/;

      const isChordLine = (l: string) => {
        const clean = l.replace(/\u266D/g, 'b').replace(/\u266F/g, '#').trim();
        if (!clean) return false;
        // Reject section codes
        if (/^(v|c|b|intro|outro|coda|bridge|verse|chorus|pre|refrain|tag|turn)[\d]?$/i.test(clean)) return false;
        const words = clean.split(/\s+/);
        // Every token must be a chord or a rhythm marker (/ | numbers)
        return words.every(w => {
          // Strip parentheses for chord checking
          const cleaned = w.replace(/[()]/g, '');
          return (CHORD_TOKEN.test(cleaned) && /^[A-G]/.test(cleaned)) ||
                 /^[\/|]+$/.test(w) ||
                 RHYTHM_RE.test(w);
        }) && words.some(w => {
          const cleaned = w.replace(/[()]/g, '');
          return /^[A-G]/.test(cleaned);
        }); // at least one real chord
      };

      const isSectionCode = (l: string) =>
        /^(v|c|b|intro|outro|coda|bridge|verse|chorus|pre|refrain|tag|turn)[\d]?$/i.test(l.trim());

      // ── Analyze font sizes from PDF ────────────────────────────────
      let pdfChordFontSize = 0;
      let pdfLyricFontSize = 0;
      const chordFontSamples: number[] = [];
      const lyricFontSamples: number[] = [];

      // Sample first 20 body lines to get font sizes
      for (let i = 0; i < Math.min(20, bodyLines.length); i++) {
        const pdfLine = bodyLines[i];
        const line = pdfLine.text;
        const avgFontSize = pdfLine.items.reduce((sum, item) => sum + (item.fontSize || 0), 0) / Math.max(1, pdfLine.items.length);
        
        if (isChordLine(line)) {
          chordFontSamples.push(avgFontSize);
        } else if (!isSectionCode(line) && line.trim()) {
          lyricFontSamples.push(avgFontSize);
        }
      }

      if (chordFontSamples.length > 0) {
        pdfChordFontSize = chordFontSamples.reduce((a, b) => a + b, 0) / chordFontSamples.length;
      }
      if (lyricFontSamples.length > 0) {
        pdfLyricFontSize = lyricFontSamples.reduce((a, b) => a + b, 0) / lyricFontSamples.length;
      }

      console.log(`PDF font sizes - Chords: ${pdfChordFontSize.toFixed(1)}pt, Lyrics: ${pdfLyricFontSize.toFixed(1)}pt`);

      // ── Build sections ─────────────────────────────────────────────
      type RawSection = { label: string; lines: Array<{ chords: string; lyrics: string }>; autoCreated?: boolean };
      const sections: RawSection[] = [];
      const cur = { section: null as RawSection | null };

      // Align chords above lyrics using x-positions
      // From debug data: lyric font is ~7.5px per character
      // Lyric lines start around x=70, chord items have precise x positions
      const alignChordsToLyrics = (chordItems: PdfItem[], lyricItems: PdfItem[]): string => {
        if (!chordItems.length) return '';

        // Get lyric origin x (leftmost x of lyric line)
        const lyricOriginX = lyricItems.length > 0 ? lyricItems[0].x : chordItems[0].x;

        // Calculate px-per-char from lyric items if we have multiple items with known positions
        // Otherwise use empirical value of 7.5px/char derived from this PDF's font
        let lyricPxPerChar = 7.5;
        if (lyricItems.length > 1) {
          // Use span between first and last lyric items
          const lastLyric = lyricItems[lyricItems.length - 1];
          const totalChars = lyricItems.reduce((sum, i) => sum + i.str.length, 0);
          const totalPx = lastLyric.x - lyricItems[0].x + lastLyric.str.length * 7.5;
          if (totalChars > 5) lyricPxPerChar = totalPx / totalChars;
        }

        // CALCULATED SPACING MULTIPLIER based on actual font sizes:
        // The key insight: PDF chords at 11pt are MUCH narrower than editor chords at 13pt bold
        // So we need MANY MORE spaces in the editor to cover the same visual distance
        // 
        // Formula breakdown:
        // 1. Ratio of PDF fonts: (pdfLyricSize / pdfChordSize) - how much wider lyrics are in PDF
        // 2. Ratio of editor fonts: (editorLyricSize / editorChordSize) - how much wider lyrics are in editor
        // 3. Multiply these together
        // 4. Add an additional scaling factor because proportional spacing in PDFs is wider than monospace
        //
        // Fallback to empirical 2.2 if we don't have font size data
        let spacingMultiplier = 2.2;
        if (pdfChordFontSize > 0 && pdfLyricFontSize > 0) {
          const editorChordEffectiveSize = 13 * 1.12; // 13pt bold ≈ 14.56pt
          const editorLyricSize = 16;
          const pdfRatio = pdfLyricFontSize / pdfChordFontSize;
          const editorRatio = editorLyricSize / editorChordEffectiveSize;
          // Add 1.7x scaling factor for proportional vs monospace spacing differences
          spacingMultiplier = pdfRatio * editorRatio * 1.7;
          console.log(`Spacing multiplier: ${spacingMultiplier.toFixed(2)} (PDF: ${pdfChordFontSize.toFixed(1)}/${pdfLyricFontSize.toFixed(1)}, Editor: 13pt bold/16pt)`);
        }

        let result = '';
        let currentCharPos = 0;
        
        for (const chord of chordItems) {
          const targetCharPos = Math.round((chord.x - lyricOriginX) / lyricPxPerChar);
          const charGap = targetCharPos - currentCharPos;
          
          // Apply spacing multiplier to compensate for font differences
          // Use minimum of 2 spaces between chords for better readability
          const spacesNeeded = Math.max(2, Math.round(charGap * spacingMultiplier));
          
          result += (currentCharPos === 0 && targetCharPos <= 0 ? '' : ' '.repeat(spacesNeeded)) + chord.str;
          
          // Update position in terms of PDF character positions
          currentCharPos = targetCharPos + chord.str.length;
        }
        return result;
      };

      // Post-process chord lines to ensure readable spacing (2 spaces minimum)
      // Only applies to rhythm notation lines (with / and |)
      const cleanChordSpacing = (chordLine: string): string => {
        // Check if this is a rhythm notation line (contains / or |)
        if (!chordLine.includes('/') && !chordLine.includes('|')) {
          // Regular chord progression - keep single spaces
          return chordLine;
        }
        
        // Rhythm notation - use 2 spaces for readability
        const tokens = chordLine.split(' ').filter(Boolean);
        return tokens.join('  ');
      };

      const labelCount: Record<string, number> = {};
      const makeLabel = (base: string) => {
        labelCount[base] = (labelCount[base] || 0) + 1;
        return labelCount[base] === 1 ? base : `${base} ${labelCount[base]}`;
      };

      const sectionNameMap: Record<string, string> = {
        v: 'Verse', c: 'Chorus', b: 'Bridge', intro: 'Intro',
        outro: 'Outro', coda: 'Coda', pre: 'Pre-Chorus', bridge: 'Bridge',
        verse: 'Verse', chorus: 'Chorus', refrain: 'Chorus', tag: 'Tag',
        turn: 'Instrumental',
      };

      let pendingChordLine: PdfLine | null = null;

      for (let i = 0; i < bodyLines.length; i++) {
        const pdfLine = bodyLines[i];
        let line = pdfLine.text;


        // Check if line STARTS with a section code followed by actual content
        // E.g., "intro G / / | C2 / / |" or "v1 Am F C G"
        const sectionCodeMatch = line.match(/^(v|c|b|intro|outro|coda|bridge|verse|chorus|pre|refrain|tag|turn)(\d+)?\s+(.+)/i);
        if (sectionCodeMatch) {
          const sectionCode = sectionCodeMatch[1] + (sectionCodeMatch[2] || '');
          const restOfLine = sectionCodeMatch[3];
          
          
          // Only add pending chord to current section if it would be empty otherwise
          const savedChord: PdfLine | null = pendingChordLine;
          if (pendingChordLine && cur.section && cur.section.lines.length === 0) {
            cur.section.lines.push({ chords: pendingChordLine.text, lyrics: '' });
            pendingChordLine = null;
          }
          
          // Process the section code
          const key2 = sectionCode.toLowerCase().replace(/\d+$/, '');
          const base = sectionNameMap[key2] || sectionCode;
          const label = makeLabel(base);
          
          console.log(`📍 Line ${i}: Inline "${sectionCode}" → "${label}"`);
          
          if (cur.section && cur.section.lines.length === 0 && cur.section.autoCreated) {
            cur.section.label = label;
            cur.section.autoCreated = false;
          } else {
            cur.section = { label, lines: [], autoCreated: false };
            sections.push(cur.section);
          }
          
          // Restore saved chord for new section if we didn't use it
          if (savedChord && pendingChordLine === null) {
            // We used it, don't restore
          } else if (savedChord) {
            pendingChordLine = savedChord;
          }
          
          // Now process the rest of the line as chord content
          line = restOfLine;
        }

        if (isSectionCode(line)) {
          
          // Only add pending chord to current section if it would be empty otherwise
          // (e.g., instrumental sections that only have chords)
          const savedChord: PdfLine | null = pendingChordLine;
          let usedPendingChord = false;
          
          if (pendingChordLine && cur.section && cur.section.lines.length === 0) {
            cur.section.lines.push({ chords: pendingChordLine.text, lyrics: '' });
            pendingChordLine = null;
            usedPendingChord = true;
          }
          
          const key2 = line.toLowerCase().replace(/\d+$/, '');
          const base = sectionNameMap[key2] || line;
          const label = makeLabel(base);
          
          console.log(`📍 Line ${i}: Standalone "${line}" → "${label}"`);
          
          // Check if current auto-created section already has this label (e.g., auto "Intro" meeting "intro" code)
          if (cur.section && cur.section.autoCreated && cur.section.label === label) {
            console.log(`   → Auto section already has label "${label}", marking as explicit`);
            cur.section.autoCreated = false;
          }
          // Only rename if current section was auto-created and empty
          else if (cur.section && cur.section.lines.length === 0 && cur.section.autoCreated) {
            console.log(`   → Renaming empty auto section`);
            cur.section.label = label;
            cur.section.autoCreated = false;
          } else {
            if (cur.section) {
              console.log(`   → Not renaming: lines=${cur.section.lines.length}, auto=${cur.section.autoCreated}, label=${cur.section.label}`);
            }
            cur.section = { label, lines: [], autoCreated: false };
            sections.push(cur.section);
          }
          
          // Restore saved chord for new section ONLY if we didn't use it
          if (!usedPendingChord && savedChord) {
            pendingChordLine = savedChord;
          }
          
          continue;
        }

        const isChord = isChordLine(line);

        if (isChord) {
          if (!cur.section) {
            cur.section = { label: 'Intro', lines: [], autoCreated: true };
            sections.push(cur.section);
          }
          if (pendingChordLine) {
            cur.section.lines.push({ chords: pendingChordLine.text, lyrics: '' });
          }
          pendingChordLine = { ...pdfLine, text: line };
        } else {
          if (!cur.section) {
            cur.section = { label: makeLabel('Verse'), lines: [], autoCreated: true };
            sections.push(cur.section);
          }
          // Use x-positions to align chords above lyrics
          const chordStr = pendingChordLine
            ? alignChordsToLyrics(pendingChordLine.items, pdfLine.items)
            : '';
          cur.section.lines.push({ chords: chordStr, lyrics: line });
          pendingChordLine = null;
        }
      }

      if (pendingChordLine && cur.section) {
        cur.section.lines.push({ chords: pendingChordLine.text, lyrics: '' });
      }

      // Build final output — keep empty sections as-is (they represent repeat placeholders)
      const validTypes = ['Intro','Verse','Pre-Chorus','Chorus','Bridge','Instrumental','Outro','Tag','Coda'];
      const toDropdownValue = (label: string) => {
        const base = label.replace(/\s+\d+$/, '');
        return validTypes.includes(base) ? base : 'Verse';
      };

      const inputLines: string[] = [];
      const extractedLabels: string[] = [];
      const extractedRepeats: number[] = [];

      sections.forEach(section => {
        // Skip sections with no actual content lines
        if (section.lines.length === 0) {
          console.log(`Skipping empty section: ${section.label}`);
          return;
        }
        
        console.log(`Section: ${section.label}, Lines: ${section.lines.length}`);
        
        extractedLabels.push(section.label);
        extractedRepeats.push(1);
        inputLines.push(`"`);
        section.lines.forEach(line => {
          if (line.chords) inputLines.push(cleanChordSpacing(line.chords));
          if (line.lyrics) inputLines.push(line.lyrics);
        });
      });

      console.log(`Total sections created: ${extractedLabels.length}`, extractedLabels);

      // ── Populate editor fields ─────────────────────────────────────
      if (title) setSongTitle(title);
      if (writers.length) setSongWriterList(writers);
      if (bpm) setSongBPM(bpm);
      if (key) { setOriginalKey(key); setKey(key); }

      if (sections.length) {
        setSongInput(inputLines.join('\n'));
        setSectionLabels(extractedLabels.map(toDropdownValue));
        setSectionRepeats(extractedRepeats);
        // Mark as loaded so the label initialization effect doesn't reset them
        loadedLabelsRef.current = true;
      }

    } catch (e: any) {
      console.error('PDF import error:', e);
      setPdfError('Could not parse the PDF — make sure it is a text-based chord chart, not a scanned image.');
    }
    setPdfImporting(false);
    if (pdfInputRef.current) pdfInputRef.current.value = '';
  };
  
  // Tags
  const [tagList, setTagList] = useState<string[]>(initialSong?.tags || []);
  const [tagDraft, setTagDraft] = useState('');
  
  // Undo/Redo history
  type HistoryState = { songInput: string; sectionLabels: string[]; sectionRepeats: number[] };
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoAction = useRef(false);
  
  // Parse songInput into sections
  const [sections, setSections] = useState<string[][]>([['']]);
  const sectionsRef = React.useRef<string[][]>([['']]);
  const [focusedSection, setFocusedSection] = useState<number | null>(null);
  
  useEffect(() => {
    if (pasteJustFired.current) return;
    if (!songInput) { setSections([['']]); return; }
    const rawLines = songInput.split('\n');
    const parsed: string[][] = [];
    let cur: string[] = [];
    const usesQuoteMarkers = rawLines.some(l => l.startsWith('"'));
    let isFirst = true;
    rawLines.forEach(line => {
      if (line.startsWith('"')) {
        if (!isFirst) parsed.push(cur);
        isFirst = false;
        // Preserve any chord content inline after the " (old format: "Am  F  C/E...)
        // But strip section label names (Verse, Chorus, etc.) — they're not content
        const inlineContent = line.slice(1).replace(/"$/, '');
        const isSectionLabel = /^(verse|chorus|bridge|pre-chorus|instrumental|turnaround|intro|ending|outro|tag)[\s\d\w]*/i.test(inlineContent.trim());
        cur = (inlineContent.trim() && !isSectionLabel) ? [inlineContent] : [];
      } else if (!line.trim()) {
        if (!usesQuoteMarkers) {
          if (cur.length > 0) parsed.push(cur);
          cur = [];
          parsed.push(['']);
        }
      } else {
        cur.push(line);
      }
    });
    if (!isFirst) parsed.push(cur);
    const result = parsed.length > 0 ? parsed : [['']];
    sectionsRef.current = result;
    setSections(result);
  }, [songInput]);

  // Keep sectionsRef always current
  useEffect(() => { sectionsRef.current = sections; }, [sections]);
  
  // Initialize section labels and repeats when sections change
  useEffect(() => {
    // Skip entirely if we loaded labels from a saved song or PDF - they're already set
    if (loadedLabelsRef.current) {
      return;
    }
    
    // If we already have labels that match the section count, never touch them
    if (sectionLabels.length > 0 && sectionLabels.length === sections.length) {
      return;
    }
    
    // ONLY auto-initialize labels if:
    // 1. We have NO labels at all (sectionLabels.length === 0)
    // 2. AND we have sections to label (sections.length > 0)
    // This should only happen when pasting content into a truly empty editor
    if (sectionLabels.length === 0 && sections.length > 0) {
      console.log('Auto-initializing labels for new content (was empty)');
      setSectionLabels(sections.map(() => 'Verse'));
      setSectionRepeats(new Array(sections.length).fill(1));
      // Mark as loaded so we don't reinitialize again
      loadedLabelsRef.current = true;
      return;
    }
    
    // If we're editing (have labels but count changed slightly), preserve labels
    // DO NOT reset - this would destroy user's work
    if (sectionLabels.length > 0 && sections.length !== sectionLabels.length) {
      const diff = Math.abs(sections.length - sectionLabels.length);
      
      // Only auto-adjust if the difference is small (1-3 sections) - indicates editing
      // Large differences indicate something else happened (paste, import, etc.)
      if (diff <= 3) {
        console.log('Minor section count change during editing - adjusting labels carefully');
        const newLabels = [...sectionLabels];
        const newRepeats = [...sectionRepeats];
        
        // Add defaults for any new sections
        while (newLabels.length < sections.length) {
          newLabels.push('Verse');
          newRepeats.push(1);
        }
        
        // Trim if sections were deleted
        if (newLabels.length > sections.length) {
          setSectionLabels(newLabels.slice(0, sections.length));
          setSectionRepeats(newRepeats.slice(0, sections.length));
        } else {
          setSectionLabels(newLabels);
          setSectionRepeats(newRepeats);
        }
      } else {
        // Large difference - something unexpected happened
        // Don't auto-adjust, let user fix manually
        console.warn(`Large section count mismatch: ${sectionLabels.length} labels vs ${sections.length} sections - not auto-adjusting`);
      }
    }
  }, [sections.length]);

  // Load from saved song if provided
  useEffect(() => {
    if (initialSong) {
      console.log('Loading song:', initialSong.title);
      console.log('sectionLabels:', initialSong.sectionLabels);
      console.log('sectionLabels length:', initialSong.sectionLabels?.length);
      
      // Reset the ref based on whether this song has labels
      loadedLabelsRef.current = !!(initialSong.sectionLabels && initialSong.sectionLabels.length > 0);
      console.log('Set loadedLabelsRef to:', loadedLabelsRef.current);
      
      setSongTitle(initialSong.title);
      setSongBPM(initialSong.bpm);
      setSongWriterList(initialSong.writers
        ? initialSong.writers.split(',').map(w => w.trim()).filter(Boolean)
        : []);
      setOriginalKey(initialSong.key.replace(/m$/, ''));
      setIsMinorKey(initialSong.key.endsWith('m'));
      setKey((initialSong as any).openKey || initialSong.key.replace(/m$/, ''));
      setSongInput(initialSong.input);
      setSaveToPublic(initialSong.userId === null); // If no userId, it's a public song
      setArtistName(initialSong.artistName || '');
      
      // Load tags
      setTagList(initialSong.tags || []);
      
      // If song has saved labels, use them
      if (initialSong.sectionLabels && initialSong.sectionLabels.length > 0) {
        console.log('Using saved labels:', initialSong.sectionLabels);
        setSectionLabels(initialSong.sectionLabels);
      } else {
        console.log('No saved labels found - will default to Verse');
        setSectionLabels([]); // Clear any old labels
      }
      // Otherwise, let the section parsing trigger and default to 'Verse' - user can change
      
      if (initialSong.sectionRepeats) setSectionRepeats(initialSong.sectionRepeats);
      if (initialSong.blankSections) setBlankSections(initialSong.blankSections);
      if (initialSong.ghostSourceByLabel) setGhostSourceByLabel(initialSong.ghostSourceByLabel);
      if (initialSong.ghostSourceByBlank) setGhostSourceByBlank(initialSong.ghostSourceByBlank);
      if (initialSong.manualSplits) setManualSplits(initialSong.manualSplits);
      if (initialSong.manualMerges) setManualMerges(initialSong.manualMerges);
      if (initialSong.lineOverrides) setLineOverrides(initialSong.lineOverrides);
    } else {
      // New song - clear the ref so labels can be auto-initialized
      loadedLabelsRef.current = false;
      setSectionLabels([]);
    }
  }, [initialSong?.id]);
  
  // Save to history (for undo/redo)
  const saveHistory = React.useCallback(() => {
    if (isUndoRedoAction.current) return; // Don't save history during undo/redo
    
    const snapshot: HistoryState = {
      songInput,
      sectionLabels: [...sectionLabels],
      sectionRepeats: [...sectionRepeats],
    };
    
    // Trim history if we're not at the end
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(snapshot);
    
    // Keep only last 50 states
    if (newHistory.length > 50) newHistory.shift();
    else setHistoryIndex(historyIndex + 1);
    
    setHistory(newHistory);
  }, [songInput, sectionLabels, sectionRepeats, history, historyIndex]);
  
  // Undo/Redo keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        
        if (e.shiftKey) {
          // Redo
          if (historyIndex < history.length - 1) {
            const next = history[historyIndex + 1];
            isUndoRedoAction.current = true;
            setSongInput(next.songInput);
            setSectionLabels(next.sectionLabels);
            setSectionRepeats(next.sectionRepeats);
            setHistoryIndex(historyIndex + 1);
            setTimeout(() => { isUndoRedoAction.current = false; }, 10);
          }
        } else {
          // Undo
          if (historyIndex > 0) {
            const prev = history[historyIndex - 1];
            isUndoRedoAction.current = true;
            setSongInput(prev.songInput);
            setSectionLabels(prev.sectionLabels);
            setSectionRepeats(prev.sectionRepeats);
            setHistoryIndex(historyIndex - 1);
            setTimeout(() => { isUndoRedoAction.current = false; }, 10);
          }
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, historyIndex]);
  // Manual splits: array of {sectionIdx, lineIdx} break points inserted by user
  const [manualSplits, setManualSplits] = useState<{sectionIdx: number, lineIdx: number}[]>([]);
  // Chord offsets: key = "sectionIdx-lineIdx-tokenIdx", value = spaces added/removed
  // lineOverrides: store modified chord line strings keyed "baseSectionIdx-absoluteLineIdx"
  const [lineOverrides, setLineOverrides] = useState<{[key: string]: string}>({});
  
  // lineFormatOverrides: force a line to be displayed as chord or lyric
  // Format: "sectionIdx-lineIdx" -> "chord" | "lyric"
  const [lineFormatOverrides, setLineFormatOverrides] = useState<{[key: string]: 'chord' | 'lyric'}>({});
  const [selectedChord, setSelectedChord] = useState<string | null>(null); // "lineKey-tokenIdx"
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);
  // Hovered split line position
  const [hoveredSplit, setHoveredSplit] = useState<{sectionIdx: number, lineIdx: number} | null>(null);
  const [hoveredBlankInsert, setHoveredBlankInsert] = useState<number | null>(null); // display sectionIdx

  const lines = songInput.split("\n").map(line => {
    if (line.startsWith('. ')) {
      return line.slice(2);
    } else if (line.startsWith('.')) {
      return line.slice(1);
    }
    return line;
  });

  const detectInputType = (): "numbers" | "letters" => {
    for (const line of lines) {
      const normalized = normalizeLine(line);
      if (!normalized || normalized.startsWith('"')) continue;
      const tokens = normalized.split(" ").filter(Boolean);
      // Only check lines that look like chord lines
      const looksLikeChordLine = tokens.some(t => /^[A-G][#b]?((m|maj|dim|aug|sus)?[0-9]*)?(\/[A-G][#b]?)?$/.test(t)) ||
        tokens.every(t => /^[1-7](b|#)?(maj|min|m|dim|aug|sus|sus2|sus4|add)?[0-9]*$/.test(t) || /^[\/|.\-x%]+$/.test(t));
      if (!looksLikeChordLine) continue;
      for (const token of tokens) {
        if (/^[1-7](b|#)?(maj|min|m|dim|aug|sus|sus2|sus4|add)?[0-9]*$/.test(token)) {
          return "numbers";
        }
        if (/^[A-G][#b]?/.test(token)) {
          return "letters";
        }
      }
    }
    return "letters";
  };

  const inputType = detectInputType();

  useEffect(() => {
    if (inputType === "letters" && songInput.trim().length > 0) {
      const detectedKey = detectKey(songInput);
      setOriginalKey(detectedKey);
      setKey(detectedKey);
    }
  }, [songInput, inputType]);

  // Initialize section labels and repeats when sections change
  useEffect(() => {
    if (sections.length > 0 && sections.length !== sectionLabels.length) {
      // Skip auto-detection if we loaded labels from a saved song
      if (loadedLabelsRef.current) { loadedLabelsRef.current = false; return; }
      // Default all sections to 'Verse' — user can change manually
      const newLabels = sections.map(() => 'Verse');
      setSectionLabels(newLabels);
      setSectionRepeats(new Array(sections.length).fill(1));
      setManualSplits([]);
      setLineOverrides({});
      setManualMerges([]);
    }
  }, [sections.length]);

  // Check if a split exists between lineIdx and lineIdx+1 within a base sectionIdx
  const hasSplit = (sectionIdx: number, lineIdx: number) =>
    manualSplits.some(s => s.sectionIdx === sectionIdx && s.lineIdx === lineIdx);

  // Add a split after lineIdx in sectionIdx
  const addSplit = (sectionIdx: number, lineIdx: number) => {
    if (!hasSplit(sectionIdx, lineIdx)) {
      setManualSplits(prev => [...prev, {sectionIdx, lineIdx}]);
      setSectionLabels(prev => {
        const next = [...prev];
        next.splice(sectionIdx + 1, 0, prev[sectionIdx] || 'Verse');
        return next;
      });
      setSectionRepeats(prev => {
        const next = [...prev];
        next.splice(sectionIdx + 1, 0, 1);
        return next;
      });
    }
  };

  // Remove a split
  const removeSplit = (sectionIdx: number, lineIdx: number) => {
    setManualSplits(prev => prev.filter(s => !(s.sectionIdx === sectionIdx && s.lineIdx === lineIdx)));
    setSectionLabels(prev => {
      const next = [...prev];
      next.splice(sectionIdx + 1, 1);
      return next;
    });
    setSectionRepeats(prev => {
      const next = [...prev];
      next.splice(sectionIdx + 1, 1);
      return next;
    });
  };

  // manualMerges: set of baseSectionIdx values that should be merged INTO the previous base section
  const [manualMerges, setManualMerges] = useState<number[]>([]);
  // Extra blank rows appended after all parsed sections
  const [blankSections, setBlankSections] = useState<{id: string, afterIdx: number, label: string, repeat: number}[]>([]);
  const [ghostSourceByLabel, setGhostSourceByLabel] = useState<Record<string, number>>(
    initialSong?.ghostSourceByLabel || {}
  );
  const [ghostSourceByBlank, setGhostSourceByBlank] = useState<Record<string, number>>(
    initialSong?.ghostSourceByBlank || {}
  );

  // Merge display section sectionIdx with the one above it
  const mergeWithAbove = (sectionIdx: number) => {
    if (sectionIdx === 0) return;
    const above = displaySections[sectionIdx - 1];
    const current = displaySections[sectionIdx];

    if (above.baseSectionIdx === current.baseSectionIdx) {
      // Sub-sections of same base — remove the manual split between them
      const splitLineIdx = above.lineOffset + above.lines.length - 1;
      removeSplit(above.baseSectionIdx, splitLineIdx);
    } else {
      // Different base sections — add a manual merge
      setManualMerges(prev => [...prev, current.baseSectionIdx]);
      setSectionLabels(prev => { const n = [...prev]; n.splice(sectionIdx, 1); return n; });
      setSectionRepeats(prev => { const n = [...prev]; n.splice(sectionIdx, 1); return n; });
    }
  };
  // Each entry: { lines, baseSectionIdx, lineOffset (lines before this sub-section within base) }
  const insertBlankAfter = (afterIdx: number) => {
    const id = `blank_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setBlankSections(prev => [...prev, { id, afterIdx, label: 'Chorus', repeat: 1 }]);
  };

  const displaySections: { lines: string[]; baseSectionIdx: number; lineOffset: number }[] = React.useMemo(() => {
    const result: { lines: string[]; baseSectionIdx: number; lineOffset: number }[] = [];
    sections.forEach((section, sIdx) => {
      const splitsInSection = manualSplits
        .filter(s => s.sectionIdx === sIdx)
        .map(s => s.lineIdx)
        .sort((a, b) => a - b);

      const subSections: { lines: string[]; lineOffset: number }[] = [];
      if (splitsInSection.length === 0) {
        subSections.push({ lines: section, lineOffset: 0 });
      } else {
        let start = 0;
        splitsInSection.forEach(splitAt => {
          subSections.push({ lines: section.slice(start, splitAt + 1), lineOffset: start });
          start = splitAt + 1;
        });
        subSections.push({ lines: section.slice(start), lineOffset: start });
      }

      subSections.forEach(sub => {
        if (manualMerges.includes(sIdx) && result.length > 0 && sub.lineOffset === 0) {
          // Merge all lines of this base section into the previous display section
          const prev = result[result.length - 1];
          prev.lines = [...prev.lines, ...sub.lines];
        } else {
          result.push({ lines: sub.lines, baseSectionIdx: sIdx, lineOffset: sub.lineOffset });
        }
      });
    });
    return result;
  }, [sections, manualSplits, manualMerges]);

  const syncingFromOverridesRef = React.useRef(false);


  // lineKey = "baseSectionIdx-absoluteLineIdx", tokenIdx = index of chord token (non-space)
  const nudgeChord = React.useCallback((lineKey: string, tokenIdx: number, direction: number) => {
    setLineOverrides(prev => {
      const line = prev[lineKey];
      if (!line) return prev; // should be seeded on selection
      const tokens = line.split(/(\s+)/);
      // Find the tokenIdx-th non-space token
      let chordCount = 0;
      let chordPos = -1;
      for (let i = 0; i < tokens.length; i++) {
        if (!/^\s*$/.test(tokens[i])) {
          if (chordCount === tokenIdx) { chordPos = i; break; }
          chordCount++;
        }
      }
      if (chordPos === -1) return prev;
      if (direction > 0) {
        // Move right: add space before chord, remove one space after chord
        const spaceBefore = chordPos > 0 ? tokens[chordPos - 1] : '';
        tokens[chordPos - 1] = spaceBefore + ' ';
        // Remove space after if possible
        if (chordPos + 1 < tokens.length && /^\s+$/.test(tokens[chordPos + 1]) && tokens[chordPos + 1].length > 1) {
          tokens[chordPos + 1] = tokens[chordPos + 1].slice(1);
        }
      } else {
        // Move left: remove space before chord, add one space after chord
        const spaceBefore = chordPos > 0 ? tokens[chordPos - 1] : '';
        if (spaceBefore.length > 1) {
          tokens[chordPos - 1] = spaceBefore.slice(1);
          // Add space after
          if (chordPos + 1 < tokens.length) {
            tokens[chordPos + 1] = ' ' + tokens[chordPos + 1];
          }
        }
      }
      return { ...prev, [lineKey]: tokens.join('') };
    });
  }, []);

  const selectedChordRef = React.useRef<{key: string, tokenIdx: number} | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const sc = selectedChordRef.current;
      if (!sc) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); nudgeChord(sc.key, sc.tokenIdx, 1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); nudgeChord(sc.key, sc.tokenIdx, -1); }
      if (e.key === 'Escape')     { setSelectedChord(null); selectedChordRef.current = null; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nudgeChord]);

  const renderPicker = (label: string, value: string, setter: (v: string) => void) => (
    <div style={{ marginBottom: 20 }}>
      <label style={{ fontWeight: "bold", marginRight: 8, fontFamily: "Helvetica, sans-serif", fontSize: "12pt" }}>{label}:</label>
      <select value={value} onChange={(e) => setter(e.target.value)} style={{ fontFamily: "Helvetica, sans-serif", fontSize: "12pt" }}>
        {Object.keys(KEYS).map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    </div>
  );

  const exportToPDF = () => {
    void exportSongPDF({
      title: songTitle, bpm: songBPM, writers: songWriters,
      originalKey, displayKey: key,
      inputType,
      useFlats: new Set(['F','Bb','Eb','Ab','Db','Gb']).has(key),
      displaySections, blankSections, sectionLabels, sectionRepeats, lineOverrides, ghostSourceByBlank,
    });
  };

  const handleSaveClick = (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (!songTitle.trim()) { alert('Please enter a song title before saving.'); return; }

    // Manually sync any active contentEditable content before saving
    const activeEl = document.activeElement;
    if (activeEl && activeEl.getAttribute('contenteditable') === 'true') {
      const sectionIdxAttr = activeEl.closest('tr')?.getAttribute('data-section-idx');
      if (sectionIdxAttr) {
        const idx = parseInt(sectionIdxAttr);
        const newText = (activeEl as HTMLElement).innerText || '';
        const lines = newText.split('\n').map(l => l.replace(/\u200B/g, ''));
        let trimmedLines = lines;
        while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1].trim() === '') {
          trimmedLines = trimmedLines.slice(0, -1);
        }
        if (trimmedLines.length === 0) trimmedLines = [''];
        const updatedSections = [...sectionsRef.current];
        updatedSections[idx] = trimmedLines;
        const inputText = updatedSections.map((sec, i) => {
          const lines = sec.map((l, li) => li === 0 ? l.replace(/^"/, '') : l);
          return ['"', ...lines].join('\n');
        }).join('\n');
        sectionsRef.current = updatedSections;
        setSections(updatedSections);
        setSongInput(inputText);
        const validBlankSections = blankSections;
        const trimmedLabels = sectionLabels.slice(0, displaySections.length);
        const trimmedRepeats = sectionRepeats.slice(0, displaySections.length);
        onSave({
          id: initialSong?.id || Date.now().toString(),
          title: songTitle, bpm: songBPM, writers: songWriters, key: originalKey + (isMinorKey ? 'm' : ''),
          input: bakeOverridesIntoInput(inputText, lineOverrides),
          savedAt: Date.now(), userId: saveToPublic ? null : undefined,
          tags: [...tagList], sectionLabels: trimmedLabels, sectionRepeats: trimmedRepeats,
          blankSections: validBlankSections, manualSplits: [...manualSplits],
          manualMerges: [...manualMerges], lineOverrides: {},
          spotify_track_id: spotifyTrackId || undefined,
          artistName: artistName || undefined,
          parentSongId: initialSong?.parentSongId ?? undefined,
          ghostSourceByLabel: Object.keys(ghostSourceByLabel).length > 0 ? ghostSourceByLabel : undefined,
          ghostSourceByBlank: Object.keys(ghostSourceByBlank).length > 0 ? ghostSourceByBlank : undefined,
        });
        return;
      }
    }
// --- LABEL HELPERS (match UI logic, no shared mutation bugs) ---
const buildLabelTexts = (
  base: string,
  repeat: number,
  counts: Record<string, number>
) => {
  if (!counts[base]) counts[base] = 0;

  const start = counts[base] + 1;
  counts[base] += repeat;

  return Array.from({ length: repeat }).map((_, i) => `${base}${start + i}`);
};

const getBaseFromLabel = (label: string) => {
  if (label === 'Verse') return 'v';
  if (label === 'Chorus') return 'c';
  if (label === 'Bridge') return 'b';
  if (label === 'Pre-Chorus') return 'prech';
  if (label === 'Instrumental') return 'inst';
  if (label === 'Tag') return 'tag';
  return label.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
};
    const validBlankSections = blankSections;
    console.log('SAVE DEBUG blankSections:', JSON.stringify(blankSections));
    const trimmedLabels = sectionLabels.slice(0, displaySections.length);
    const trimmedRepeats = sectionRepeats.slice(0, displaySections.length);
    onSave({
      id: initialSong?.id || Date.now().toString(),
      title: songTitle, bpm: songBPM, writers: songWriters, key: originalKey + (isMinorKey ? 'm' : ''),
      input: bakeOverridesIntoInput(songInput, lineOverrides),
      savedAt: Date.now(), userId: saveToPublic ? null : undefined,
      tags: [...tagList], sectionLabels: trimmedLabels, sectionRepeats: trimmedRepeats,
      blankSections: validBlankSections, manualSplits: [...manualSplits],
      manualMerges: [...manualMerges], lineOverrides: {},
      spotify_track_id: spotifyTrackId || undefined,
      artistName: artistName || undefined,
      parentSongId: initialSong?.parentSongId ?? undefined,
      ghostSourceByLabel: Object.keys(ghostSourceByLabel).length > 0 ? ghostSourceByLabel : undefined,
      ghostSourceByBlank: Object.keys(ghostSourceByBlank).length > 0 ? ghostSourceByBlank : undefined,
    });
  };

  return (
    <div style={{ fontFamily: "Helvetica, sans-serif", padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center", fontFamily: "Helvetica, sans-serif", fontSize: "24pt" }}>ChartApp</h1>

      {/* PDF Import */}
      <div style={{ marginBottom: 24, padding: '14px 16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12pt', fontWeight: 700, fontFamily: 'Helvetica, sans-serif', marginBottom: 2 }}>Import from PDF</div>
            <div style={{ fontSize: '9pt', color: '#64748b', fontFamily: 'Helvetica, sans-serif' }}>Upload a chord chart PDF — title, writers, BPM, key, chords & lyrics will be extracted automatically</div>
          </div>
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfImport(f); }}
          />
          <button
            onClick={() => pdfInputRef.current?.click()}
            disabled={pdfImporting}
            style={{ padding: '8px 18px', fontSize: '10pt', fontWeight: 700, cursor: pdfImporting ? 'default' : 'pointer', backgroundColor: pdfImporting ? '#94a3b8' : '#1a1a1a', color: 'white', border: 'none', borderRadius: 6, fontFamily: 'Helvetica, sans-serif', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {pdfImporting ? (
              <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span> Extracting...</>
            ) : (
              <>📄 Choose PDF</>
            )}
          </button>
        </div>
        {pdfError && (
          <div style={{ marginTop: 10, padding: '8px 12px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: '9pt', color: '#dc2626', fontFamily: 'Helvetica, sans-serif' }}>
            {pdfError}
          </div>
        )}
        {pdfImporting && (
          <div style={{ marginTop: 10, fontSize: '9pt', color: '#64748b', fontFamily: 'Helvetica, sans-serif' }}>
            Reading PDF and extracting chord chart data...
          </div>
        )}
      </div>

      {/* Song Title */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", marginBottom: 4, fontFamily: "Helvetica, sans-serif", fontSize: "12pt", fontWeight: "bold" }}>Song Title:</label>
        <input
          type="text"
          value={songTitle}
          onChange={(e) => setSongTitle(e.target.value)}
          placeholder="Enter song title"
          style={{ 
            width: "100%", 
            padding: "8px", 
            fontFamily: "Helvetica, sans-serif", 
            fontSize: "12pt",
            border: "1px solid #ccc",
            borderRadius: "4px"
          }}
        />
      </div>

      {/* BPM, Artist, Writers */}
      <div style={{ marginBottom: 20, display: 'flex', gap: '20px' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", marginBottom: 4, fontFamily: "Helvetica, sans-serif", fontSize: "12pt", fontWeight: "bold" }}>BPM:</label>
          <input
            type="text"
            value={songBPM}
            onChange={(e) => setSongBPM(e.target.value)}
            placeholder="e.g., 120"
            style={{ 
              width: "100%", 
              padding: "8px", 
              fontFamily: "Helvetica, sans-serif", 
              fontSize: "12pt",
              border: "1px solid #ccc",
              borderRadius: "4px"
            }}
          />
        </div>
        <div style={{ flex: 2 }}>
          <label style={{ display: "block", marginBottom: 4, fontFamily: "Helvetica, sans-serif", fontSize: "12pt", fontWeight: "bold" }}>Version:</label>
          <input
            type="text"
            value={artistName}
            onChange={e => setArtistName(e.target.value)}
            placeholder="e.g., Hillsong, Chris Tomlin…"
            style={{ width: "100%", padding: "8px", fontFamily: "Helvetica, sans-serif", fontSize: "12pt", border: "1px solid #ccc", borderRadius: "4px", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ flex: 2 }}>
          <label style={{ display: "block", marginBottom: 4, fontFamily: "Helvetica, sans-serif", fontSize: "12pt", fontWeight: "bold" }}>Writers:</label>
          <div style={{ display: "flex", flexWrap: "nowrap", gap: 4, padding: "8px", border: "1px solid #ccc", borderRadius: 4, boxSizing: "border-box", alignItems: "center", cursor: "text", backgroundColor: "white", overflowX: "auto", overflowY: "hidden" }}
            onClick={() => { const el = document.getElementById('writer-input'); if (el) el.focus(); }}>
            {songWriterList.map((w, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, backgroundColor: "#f0f0f0", border: "1px solid #ddd", borderRadius: 4, padding: "0 6px", fontSize: "12pt", fontFamily: "Helvetica, sans-serif", whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {w}
                <span onClick={() => setSongWriterList(prev => prev.filter((_, j) => j !== i))}
                  style={{ cursor: "pointer", color: "#999", fontSize: "10pt", lineHeight: 1, marginLeft: 2 }}>✕</span>
              </span>
            ))}
            <input
              id="writer-input"
              type="text"
              value={writerDraft}
              onChange={e => {
                const val = e.target.value;
                if (val.endsWith(',')) {
                  const name = val.slice(0, -1).trim();
                  if (name) setSongWriterList(prev => [...prev, name]);
                  setWriterDraft('');
                } else {
                  setWriterDraft(val);
                }
              }}
              onKeyDown={e => {
                if ((e.key === 'Enter' || e.key === ',') && writerDraft.trim()) {
                  e.preventDefault();
                  setSongWriterList(prev => [...prev, writerDraft.trim()]);
                  setWriterDraft('');
                } else if (e.key === 'Backspace' && !writerDraft && songWriterList.length > 0) {
                  setSongWriterList(prev => prev.slice(0, -1));
                }
              }}
              onPaste={e => {
                const pasted = e.clipboardData.getData('text');
                if (pasted.includes(',')) {
                  e.preventDefault();
                  const names = pasted.split(',').map(n => n.trim()).filter(Boolean);
                  setSongWriterList(prev => [...prev, ...names]);
                  setWriterDraft('');
                }
              }}
              onBlur={() => {
                if (writerDraft.trim()) {
                  setSongWriterList(prev => [...prev, writerDraft.trim()]);
                  setWriterDraft('');
                }
              }}
              placeholder={songWriterList.length === 0 ? "Type a name, press comma or Enter…" : ""}
              style={{ border: "none", outline: "none", fontSize: "12pt", fontFamily: "Helvetica, sans-serif", flex: 1, minWidth: 120, padding: 0, margin: 0, backgroundColor: "transparent", lineHeight: 1 }}
            />
          </div>
        </div>
      </div>

      {/* Tags */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", marginBottom: 4, fontFamily: "Helvetica, sans-serif", fontSize: "12pt", fontWeight: "bold" }}>Tags:</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "8px", border: "1px solid #ccc", borderRadius: 4, boxSizing: "border-box", alignItems: "center", cursor: "text", backgroundColor: "white", minHeight: 42 }}
          onClick={() => { const el = document.getElementById('tag-input'); if (el) el.focus(); }}>
          {tagList.map((t, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, backgroundColor: "#f0f0f0", border: "1px solid #ddd", borderRadius: 4, padding: "2px 8px", fontSize: "11pt", fontFamily: "Helvetica, sans-serif", whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1.4 }}>
              {t}
              <span onClick={() => setTagList(prev => prev.filter((_, j) => j !== i))}
                style={{ cursor: "pointer", color: "#999", fontSize: "10pt", lineHeight: 1, marginLeft: 2 }}>✕</span>
            </span>
          ))}
          <input
            id="tag-input"
            type="text"
            value={tagDraft}
            onChange={e => {
              const val = e.target.value;
              if (val.endsWith(',')) {
                const tag = val.slice(0, -1).trim();
                if (tag) setTagList(prev => [...prev, tag]);
                setTagDraft('');
              } else {
                setTagDraft(val);
              }
            }}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ',') && tagDraft.trim()) {
                e.preventDefault();
                setTagList(prev => [...prev, tagDraft.trim()]);
                setTagDraft('');
              } else if (e.key === 'Backspace' && !tagDraft && tagList.length > 0) {
                setTagList(prev => prev.slice(0, -1));
              }
            }}
            onPaste={e => {
              const pasted = e.clipboardData.getData('text');
              if (pasted.includes(',')) {
                e.preventDefault();
                const tags = pasted.split(',').map(t => t.trim()).filter(Boolean);
                setTagList(prev => [...prev, ...tags]);
                setTagDraft('');
              }
            }}
            onBlur={() => {
              if (tagDraft.trim()) {
                setTagList(prev => [...prev, tagDraft.trim()]);
                setTagDraft('');
              }
            }}
            placeholder={tagList.length === 0 ? "Type a tag, press comma or Enter…" : ""}
            style={{ border: "none", outline: "none", fontSize: "11pt", fontFamily: "Helvetica, sans-serif", flex: 1, minWidth: 120, padding: 0, margin: 0, backgroundColor: "transparent", lineHeight: 1.4 }}
          />
        </div>
      </div>

      {/* Spotify Track */}
      {spotifyToken && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 8, fontFamily: 'Helvetica, sans-serif', fontSize: '12pt', fontWeight: 'bold' }}>Spotify Track:</label>
          {spotifyTrackId ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6 }}>
              <span style={{ fontSize: '16pt' }}>🎵</span>
              <span style={{ flex: 1, fontSize: '10pt', color: '#166534' }}>Track linked</span>
              <button onClick={() => {
                setSpotifySearchQuery(songTitle);
                setShowSpotifySearch(s => !s);
              }} style={{ padding: '4px 10px', fontSize: '9pt', cursor: 'pointer', backgroundColor: 'white', border: '1px solid #ccc', borderRadius: 4 }}>Change</button>
              <button onClick={() => setSpotifyTrackId('')} style={{ padding: '4px 10px', fontSize: '9pt', cursor: 'pointer', backgroundColor: 'white', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: 4 }}>Remove</button>
            </div>
          ) : (
            <button onClick={() => {
              setSpotifySearchQuery(songTitle);
              setShowSpotifySearch(s => !s);
            }} style={{ padding: '6px 14px', fontSize: '10pt', cursor: 'pointer', backgroundColor: '#1db954', color: 'white', border: 'none', borderRadius: 6, fontFamily: 'Helvetica, sans-serif' }}>
              + Link Spotify Track
            </button>
          )}
          {showSpotifySearch && (
            <div style={{ marginTop: 10, padding: 12, border: '1px solid #e2e8f0', borderRadius: 8, backgroundColor: '#fafafa' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input
                  type="text"
                  value={spotifySearchQuery}
                  onChange={e => setSpotifySearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchSpotify()}
                  placeholder={`Search "${songTitle}" on Spotify...`}
                  style={{ flex: 1, padding: '8px 10px', fontSize: '10pt', border: '1px solid #ccc', borderRadius: 4 }}
                  autoFocus
                />
                <button onClick={searchSpotify} disabled={spotifySearching} style={{ padding: '8px 14px', fontSize: '10pt', cursor: 'pointer', backgroundColor: '#1db954', color: 'white', border: 'none', borderRadius: 4 }}>
                  {spotifySearching ? '...' : 'Search'}
                </button>
              </div>
              {spotifyResults.map(track => (
                <div key={track.id}
                  onClick={() => { setSpotifyTrackId(track.id); setArtistName(track.artists?.map((a: any) => a.name).join(', ') || ''); setShowSpotifySearch(false); setSpotifyResults([]); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', borderRadius: 6, cursor: 'pointer', marginBottom: 4, backgroundColor: 'white', border: '1px solid #e2e8f0' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0fdf4'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}
                >
                  {track.album?.images?.[2]?.url && <img src={track.album.images[2].url} alt="" style={{ width: 40, height: 40, borderRadius: 4, flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '10pt', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
                    <div style={{ fontSize: '9pt', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artists?.map((a: any) => a.name).join(', ')}</div>
                  </div>
                  <div style={{ fontSize: '9pt', color: '#999', flexShrink: 0 }}>{Math.floor(track.duration_ms / 60000)}:{String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}</div>
                </div>
              ))}
              {spotifyResults.length === 0 && !spotifySearching && spotifySearchQuery && (
                <div style={{ fontSize: '10pt', color: '#999', textAlign: 'center', padding: 12 }}>No results. Try a different search.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Save to Public toggle (admin only) */}
      {authUser?.id === ADMIN_USER_ID && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "Helvetica, sans-serif", fontSize: "11pt", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={saveToPublic}
              onChange={e => setSaveToPublic(e.target.checked)}
              style={{ width: 18, height: 18, cursor: "pointer" }}
            />
            <span>Save to Public Archive (no userId — won't appear in My Archive)</span>
          </label>
        </div>
      )}

      {/* Original Key */}
      {inputType === "letters" && (
        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontWeight: "bold", marginRight: 4, fontFamily: "Helvetica, sans-serif", fontSize: "12pt" }}>Original Key:</label>
          <select value={originalKey} onChange={e => setOriginalKey(e.target.value)} style={{ fontFamily: "Helvetica, sans-serif", fontSize: "12pt" }}>
            {Object.keys(KEYS).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: "Helvetica, sans-serif", fontSize: "11pt", cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={isMinorKey}
              onChange={e => {
                const nowMinor = e.target.checked;
                setIsMinorKey(nowMinor);
                // Shift key to relative minor/major
                const chromatic = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
                const enharmonic: Record<string,string> = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };
                const normalize = (k: string) => enharmonic[k] || k;
                const denormalize = (k: string, preferFlat: boolean): string => {
                  const flatMap: Record<string,string> = { 'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb' };
                  return (preferFlat && flatMap[k]) ? flatMap[k] : k;
                };
                const idx = chromatic.indexOf(normalize(originalKey));
                if (idx === -1) return;
                // Relative minor = down 3 semitones; relative major = up 3 semitones
                const newIdx = nowMinor ? (idx + 9) % 12 : (idx + 3) % 12;
                const newBase = chromatic[newIdx];
                const FLAT_KEYS_SET = new Set(['F','Bb','Eb','Ab','Db','Gb']);
                const preferFlat = FLAT_KEYS_SET.has(originalKey);
                setOriginalKey(denormalize(newBase, preferFlat));
              }}
              style={{ width: 15, height: 15, cursor: 'pointer' }}
            />
            Minor key
          </label>
          {isMinorKey && (
            <span style={{ color: '#888', fontSize: '10pt', fontStyle: 'italic', fontFamily: 'Helvetica, sans-serif' }}>
              (saves as {originalKey}m)
            </span>
          )}
        </div>
      )}

      {/* Top Save Button */}
      <div style={{ marginBottom: 16 }}>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={handleSaveClick}
          style={{ padding: '6px 12px', fontSize: '12pt', cursor: 'pointer', backgroundColor: '#1a1a1a', color: 'white', border: '1px solid #1a1a1a', borderRadius: '4px', fontFamily: "Helvetica, sans-serif" }}
        >
          {initialSong ? 'Update in Archive' : 'Save to Archive'}
        </button>
      </div>

      {/* Integrated WYSIWYG Editor with Sections */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", marginBottom: 4, fontFamily: "Helvetica, sans-serif", fontSize: "12pt", fontWeight: 600 }}>Song Content:</label>
        <div
          style={{ 
            border: "1px solid #ccc", 
            borderRadius: 4, 
            padding: 6,
            minHeight: 400,
            backgroundColor: "transparent"
          }}
          onCopy={(e) => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return;

            // Collect all contentEditable cells in order
            const allCells = Array.from(
              e.currentTarget.querySelectorAll('[contenteditable]')
            ) as HTMLElement[];

            // Find which cells are (even partially) within the selection
            const range = sel.getRangeAt(0);
            const selectedCells = allCells.filter(cell => {
              const cellRange = document.createRange();
              cellRange.selectNodeContents(cell);
              return (
                range.compareBoundaryPoints(Range.END_TO_START, cellRange) < 0 &&
                range.compareBoundaryPoints(Range.START_TO_END, cellRange) > 0
              );
            });

            if (selectedCells.length <= 1) return; // single section — let browser handle it

            // Build plain text across all selected cells
            const parts = selectedCells.map(cell => {
              // If this is the first or last cell, try to honour partial selection
              const cellRange = document.createRange();
              cellRange.selectNodeContents(cell);
              const start = range.compareBoundaryPoints(Range.START_TO_START, cellRange) > 0
                ? range.startOffset : null;
              const end = range.compareBoundaryPoints(Range.END_TO_END, cellRange) < 0
                ? range.endOffset : null;
              // Just grab innerText for the whole cell — partial line selection across
              // multiple contentEditables is impractical; give the full content
              return (cell.innerText || '').replace(/\u200B/g, '');
            });

            const text = parts.join('\n\n');
            e.preventDefault();
            e.clipboardData.setData('text/plain', text);
          }}
        >
          <table data-editor-wrapper style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <React.Fragment>
              {(() => {
                const emptySectionLabels = new Set<string>();
                const nonEmptyCountByLabel: Record<string, number> = {};
                sections.forEach((sec, i) => {
                  const lbl = sectionLabels[i] || 'Verse';
                  const hasContent = sec.some(l => l.replace(/[\u00A0\uFFFC\u200B\u200C\u200D\uFEFF]/g, '').trim());
                  if (hasContent) {
                    nonEmptyCountByLabel[lbl] = (nonEmptyCountByLabel[lbl] || 0) + 1;
                  } else {
                    emptySectionLabels.add(lbl);
                  }
                });
                return sections.map((section, sectionIdx) => {
                const label = sectionLabels[sectionIdx] || 'Verse';
                const repeat = sectionRepeats[sectionIdx] || 1;
                const rowBg = sectionIdx % 2 === 0 ? "#fff" : "#f9f9f9";
                
                // Generate pill label like "v1", "c2", etc.
                const base = label === 'Verse' ? 'v' : label === 'Chorus' ? 'c' : label === 'Bridge' ? 'b' :
                  label === 'Pre-Chorus' ? 'prech' : label === 'Instrumental' ? 'inst' :
                  label.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
                const SHORT_LABELS = ['v', 'c', 'b', 'tag', 'inst'];
                const isPill = SHORT_LABELS.includes(base);
                const counts: Record<string, number> = {};
                for (let i = 0; i <= sectionIdx; i++) {
                  const lbl = sectionLabels[i] || 'Verse';
                  const b = lbl === 'Verse' ? 'v' : lbl === 'Chorus' ? 'c' : lbl === 'Bridge' ? 'b' :
                    lbl === 'Pre-Chorus' ? 'prech' : lbl === 'Instrumental' ? 'inst' :
                    lbl.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
                  counts[b] = (counts[b] || 0) + 1;
                }
                const labelText = isPill ? `${base}${counts[base]}` : label;
                const color = label === 'Verse' ? '#3b82f6' : label === 'Chorus' ? '#dc2626' : 
                  label === 'Bridge' ? '#16a34a' : label === 'Pre-Chorus' ? '#a855f7' : 
                  label === 'Instrumental' ? '#6b7280' : label === 'Tag' ? '#f97316' : '#6b7280';
                
                return (
                  <React.Fragment key={sectionIdx}>
                  <tr data-section-idx={sectionIdx} style={{ backgroundColor: rowBg }}>
                    {/* Visual Pill Label */}
                    <td style={{ padding: "6px 8px", verticalAlign: "top", width: 60, textAlign: "center", userSelect: "none" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {Array.from({ length: repeat }).map((_, r) => {
                          const stackText = isPill ? `${base}${counts[base] + r}` : (repeat > 1 ? labelText : labelText);
                          return isPill ? (
                            <div key={r} style={{ 
                              border: `1.5px solid ${color}`, 
                              borderRadius: 2, 
                              padding: "4px 8px", 
                              fontSize: "10pt", 
                              fontWeight: 700, 
                              color,
                              display: "inline-block",
                              minWidth: 32,
                              textAlign: "center"
                            }}>
                              {stackText}
                            </div>
                          ) : (
                            <div key={r} style={{ fontSize: "10pt", fontWeight: 700, color: "#666" }}>
                              {labelText}
                              {repeat > 1 && <div style={{ fontSize: "7pt" }}>x{repeat}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    
                    {/* Section Label Column */}
                    <td style={{ padding: "6px", verticalAlign: "top", width: 80, userSelect: "none" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, height: "100%", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <select
                            value={label}
                            onChange={(e) => {
                              const newLabels = [...sectionLabels];
                              newLabels[sectionIdx] = e.target.value;
                              setSectionLabels(newLabels);
                              saveHistory();
                            }}
                            style={{ fontFamily: "Helvetica, sans-serif", fontSize: "9pt", padding: "2px", border: "1px solid #ccc", borderRadius: "4px" }}
                          >
                            <option value="Intro">Intro</option>
                            <option value="Verse">Verse</option>
                            <option value="Pre-Chorus">Pre-Chorus</option>
                            <option value="Chorus">Chorus</option>
                            <option value="Bridge">Bridge</option>
                            <option value="Instrumental">Instrumental</option>
                            <option value="Outro">Outro</option>
                            <option value="Tag">Tag</option>
                            <option value="Coda">Coda</option>
                          </select>
                          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <label style={{ fontFamily: "Helvetica, sans-serif", fontSize: "9pt", color: "#666" }}>x</label>
                            <input
                              type="number"
                              min={1}
                              max={8}
                              value={repeat}
                              onChange={(e) => {
                                const newRepeats = [...sectionRepeats];
                                newRepeats[sectionIdx] = Math.max(1, Math.min(8, parseInt(e.target.value) || 1));
                                setSectionRepeats(newRepeats);
                                saveHistory();
                              }}
                              style={{ fontFamily: "Helvetica, sans-serif", fontSize: "9pt", width: "36px", padding: "2px 4px", border: "1px solid #ccc", borderRadius: "4px" }}
                            />
                          </div>
                          {/* Ghost source pills on empty sections with multiple content siblings */}
                          {(() => {
                            const isEmpty = !section.some(l => l.replace(/[ ￼​‌‍ ]/g, "").trim());
                            if (!isEmpty) return null;
                            const contentSiblings = sections
                              .map((sec, si) => ({ sec, si, lbl: sectionLabels[si] || "Verse" }))
                              .filter(({ sec, lbl, si }) => lbl === label && si !== sectionIdx && sec.some(l => l.replace(/[ ￼​‌‍ ]/g, "").trim()));
                            if (contentSiblings.length < 2) return null;
                            const shortBase = label === "Verse" ? "v" : label === "Chorus" ? "c" : label === "Bridge" ? "b" : label === "Pre-Chorus" ? "prech" : label.slice(0,4).toLowerCase();
                            const color = label === "Verse" ? "#3b82f6" : label === "Chorus" ? "#dc2626" : label === "Bridge" ? "#16a34a" : label === "Pre-Chorus" ? "#a855f7" : label === "Tag" ? "#f97316" : "#6b7280";
                            const pinnedSrcIdx = ghostSourceByBlank["empty_" + sectionIdx];
                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
                                <span style={{ fontFamily: "Helvetica, sans-serif", fontSize: "7.5pt", color: "#999" }}>ghost from:</span>
                                {contentSiblings.map(({ si }) => {
                                  const isSelected = pinnedSrcIdx === si;
                                  // Count how many times this label appears up to and including si
                                  const labelNum = sectionLabels.slice(0, si + 1).filter(l => (l || 'Verse') === label).length;
                                  return (
                                    <span
                                      key={si}
                                      onClick={() => {
                                        const newMap = { ...ghostSourceByBlank };
                                        const key = "empty_" + sectionIdx;
                                        if (isSelected) { delete newMap[key]; } else { newMap[key] = si; }
                                        setGhostSourceByBlank(newMap);
                                      }}
                                      style={{ display: "inline-block", border: "1.5px solid " + color, borderRadius: 1, padding: "2px 6px", fontSize: "9pt", fontWeight: 700, color: isSelected ? "white" : color, backgroundColor: isSelected ? color : "transparent", cursor: "pointer", width: "fit-content", userSelect: "none" }}
                                    >
                                      {shortBase}{labelNum}
                                    </span>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                        {/* Add Section Button */}
                        <button
                          onClick={() => {
                            const newSections = [...sections];
                            newSections.splice(sectionIdx + 1, 0, ['']); // Insert empty section after current
                            setSections(newSections);
                            
                            // Preserve existing labels and add default for new section
                            const newLabels = [...sectionLabels];
                            newLabels.splice(sectionIdx + 1, 0, 'Verse');
                            setSectionLabels(newLabels);
                            
                            const newRepeats = [...sectionRepeats];
                            newRepeats.splice(sectionIdx + 1, 0, 1);
                            setSectionRepeats(newRepeats);
                            
                            // Rebuild songInput
                            const inputText = newSections.map((sec, i) => {
                              const lines = sec.map((l, li) => li === 0 ? l.replace(/^"/, '') : l);
                              return ['"', ...lines].join('\n');
                            }).join('\n');
                            setSongInput(inputText);
                            saveHistory();
                          }}
                          style={{
                            padding: "3px 6px",
                            fontSize: "8pt",
                            cursor: "pointer",
                            backgroundColor: "white",
                            color: "#666",
                            border: "1px solid #ccc",
                            borderRadius: 3,
                            fontFamily: "Helvetica, sans-serif",
                            width: "100%"
                          }}
                        >
                          + Section
                        </button>
                      </div>
                    </td>
                    
                    {/* Content Column */}
                    <td
                      style={{ padding: "8px 6px", verticalAlign: "top", cursor: focusedSection === sectionIdx ? 'text' : 'text' }}
                      onClick={() => { if (focusedSection !== sectionIdx) setFocusedSection(sectionIdx); }}
                    >
                      {/* Placeholder shown when section is empty and not focused */}
                      {focusedSection !== sectionIdx && (section.length === 0 || (section.length === 1 && !section[0].trim())) && (
                        <div
                          onClick={(e) => {
                            setFocusedSection(sectionIdx);
                            // Focus the always-editable contentEditable sibling
                            const ce = (e.currentTarget as HTMLElement).parentElement?.querySelector('[contenteditable]') as HTMLElement;
                            if (ce) { ce.focus(); const r = document.createRange(); r.selectNodeContents(ce); r.collapse(true); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r); }
                          }}
                          style={{
                            color: '#aaa',
                            fontSize: '13pt',
                            fontFamily: 'Helvetica, sans-serif',
                            fontStyle: 'italic',
                            padding: '4px 2px',
                            cursor: 'text',
                            userSelect: 'none',
                            borderRadius: 3,
                          }}
                        >
                          Click to type or paste chords &amp; lyrics…
                        </div>
                      )}
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        onClick={() => {
                          if (focusedSection !== sectionIdx) setFocusedSection(sectionIdx);
                        }}
                        onContextMenu={(e) => {
                          // Only show menu if there's a selection
                          const selection = window.getSelection();
                          if (!selection || selection.isCollapsed) return; // No selection, allow default
                          
                          e.preventDefault();
                          e.stopPropagation();
                          
                          // Find which line is selected
                          const range = selection.getRangeAt(0);
                          const container = range.commonAncestorContainer;
                          const element = container.nodeType === 3 ? container.parentElement : container as Element;
                          const lineDiv = element?.closest('[data-line-idx]') as HTMLElement;
                          
                          if (!lineDiv) return;
                          
                          const lineIdx = parseInt(lineDiv.getAttribute('data-line-idx') || '0');
                          if (lineIdx >= section.length) return;
                          
                          const currentLine = section[lineIdx];
                          if (!currentLine || !currentLine.trim()) return;
                          
                          const overrideKey = `${sectionIdx}-${lineIdx}`;
                          const cleanLine = currentLine.replace(/^"/, '').replace(/"$/, '');
                          const hasOverride = lineFormatOverrides[overrideKey];
                          const isCurrentlyChord = hasOverride 
                            ? lineFormatOverrides[overrideKey] === 'chord'
                            : Boolean(cleanLine.trim() && isChordLine(cleanLine));
                          
                          // Create menu
                          const menu = document.createElement('div');
                          menu.style.cssText = 'position: fixed; background: white; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 9999; padding: 4px; font-family: Helvetica, sans-serif;';
                          menu.style.left = e.clientX + 'px';
                          menu.style.top = e.clientY + 'px';
                          
                          const createOption = (label: string, value: 'chord' | 'lyric' | null) => {
                            const isActive = value === null ? !hasOverride : (hasOverride && lineFormatOverrides[overrideKey] === value);
                            const btn = document.createElement('button');
                            btn.textContent = (isActive ? '✓ ' : '') + label;
                            btn.style.cssText = `display: block; width: 100%; text-align: left; padding: 8px 16px; border: none; background: ${isActive ? '#f0f0f0' : 'none'}; cursor: pointer; font-size: 11pt; border-radius: 4px; white-space: nowrap; font-weight: ${isActive ? 600 : 400};`;
                            btn.onmouseenter = () => btn.style.backgroundColor = '#f0f0f0';
                            btn.onmouseleave = () => btn.style.backgroundColor = isActive ? '#f0f0f0' : 'transparent';
                            btn.onmousedown = (e) => e.preventDefault(); // Prevent focus loss
                            btn.onclick = () => {
                              const newOverrides = { ...lineFormatOverrides };
                              if (value === null) {
                                delete newOverrides[overrideKey];
                              } else {
                                newOverrides[overrideKey] = value;
                              }
                              setLineFormatOverrides(newOverrides);
                              menu.remove();
                              backdrop.remove();
                            };
                            return btn;
                          };
                          
                          menu.appendChild(createOption('Auto', null));
                          menu.appendChild(createOption('Chord', 'chord'));
                          menu.appendChild(createOption('Lyric', 'lyric'));
                          
                          // Backdrop
                          const backdrop = document.createElement('div');
                          backdrop.style.cssText = 'position: fixed; inset: 0; z-index: 9998;';
                          backdrop.onmousedown = (e) => {
                            e.preventDefault();
                            menu.remove();
                            backdrop.remove();
                          };
                          
                          document.body.appendChild(backdrop);
                          document.body.appendChild(menu);
                        }}
                        onPaste={(e) => {
                          // Prevent default paste and only allow plain text
                          e.preventDefault();
                          let text = e.clipboardData.getData('text/plain');
                          
                          console.log('=== PASTE EVENT ===');
                          console.log('Raw pasted text:', text);
                          
                          // Clean up special characters
                          text = text.replace(/\uFFFC/g, ''); // Remove object replacement characters (images)
                          text = text.replace(/[\u200B-\u200D\uFEFF]/g, ''); // Remove zero-width spaces
                          
                          // Check if pasted content contains section markers
                          const lines = text.split('\n');
                          console.log('Lines after split:', lines);
                          const hasSectionMarkers = lines.some(line => line.trim().startsWith('"'));
                          // Detect blank-line-separated sections (multi-section paste without markers)
                          const hasBlankLineSections = !hasSectionMarkers && lines.some(l => !l.trim()) && lines.some(l => l.trim());
                          console.log('Has section markers:', hasSectionMarkers, '| Has blank-line sections:', hasBlankLineSections);
                          
                          if (hasSectionMarkers || hasBlankLineSections) {
                            // Parse into sections: split on " markers OR blank lines
                            const parsedSections: string[][] = [];
                            let currentSection: string[] = [];
                            
                            lines.forEach((line, idx) => {
                              const trimmed = line.trim();
                              
                              if (trimmed.startsWith('"')) {
                                // Opening quote marker — start new section
                                if (currentSection.length > 0) parsedSections.push([...currentSection]);
                                currentSection = [];
                                const inlineContent = line.replace(/^\s*"/, '').replace(/"\s*$/, '').trimEnd();
                                if (inlineContent.trim()) {
                                  currentSection.push(inlineContent);
                                  if (line.replace(/^\s*"/, '').trimEnd().endsWith('"')) {
                                    parsedSections.push([...currentSection]);
                                    currentSection = [];
                                  }
                                }
                              } else if (trimmed === '"') {
                                // Standalone closing " — close the current section
                                if (currentSection.length > 0) {
                                  parsedSections.push([...currentSection]);
                                  currentSection = [];
                                }
                              } else if (!trimmed && hasBlankLineSections) {
                                // Blank line separator — start new section
                                if (currentSection.length > 0) {
                                  parsedSections.push([...currentSection]);
                                  currentSection = [];
                                }
                              } else if (trimmed) {
                                const endsWithQuote = line.trimEnd().endsWith('"');
                                const cleanLine = endsWithQuote ? line.replace(/"\s*$/, '').trimEnd() : line.trimEnd();
                                if (cleanLine.trim()) currentSection.push(cleanLine);
                                if (endsWithQuote) {
                                  parsedSections.push([...currentSection]);
                                  currentSection = [];
                                }
                              }
                            });
                            if (currentSection.length > 0) parsedSections.push([...currentSection]);
                            
                            console.log('Parsed sections:', parsedSections.length, parsedSections);
                            
                            if (parsedSections.length > 0) {
                              sectionsRef.current = parsedSections;
                              setSections(parsedSections);
                              setSectionLabels(parsedSections.map(() => 'Verse'));
                              setSectionRepeats(parsedSections.map(() => 1));
                              loadedLabelsRef.current = true;
                              
                              // Rebuild songInput using quote-marker format
                              const inputText = parsedSections.map(sec => {
                                const lines = sec.map((l, li) => li === 0 ? l.replace(/^"/, '') : l);
                                return ['"', ...lines].join('\n');
                              }).join('\n');
                              
                              console.log('Final songInput:', inputText);
                              pasteJustFired.current = true;
                              setSongInput(inputText);
                              saveHistory();
                              setTimeout(() => { pasteJustFired.current = false; }, 300);
                            }
                          } else {
                            // No section markers, no blank-line sections — insert at cursor position
                            let pastedLines = lines.map(l => l.replace(/\u200B/g, ''));
                            while (pastedLines.length > 0 && !pastedLines[pastedLines.length - 1].trim()) {
                              pastedLines = pastedLines.slice(0, -1);
                            }
                            if (pastedLines.length === 0) pastedLines = [''];

                            // Determine cursor position within the contentEditable
                            const selection = window.getSelection();
                            const currentSectionLines = [...(sectionsRef.current[sectionIdx] || [''])];

                            let insertLineIdx = currentSectionLines.length; // default: append at end
                            let insertCharIdx = 0;

                            if (selection && selection.rangeCount > 0) {
                              const range = selection.getRangeAt(0);
                              const el = e.currentTarget as HTMLElement;
                              const divs = Array.from(el.querySelectorAll('div')) as HTMLDivElement[];

                              // Find which div the cursor is in
                              let anchorNode: Node | null = range.startContainer;
                              // Walk up to find the immediate child div of the contentEditable
                              let cursorDiv: HTMLDivElement | null = null;
                              let node: Node | null = anchorNode;
                              while (node && node !== el) {
                                if (node.parentElement === el && node.nodeType === 1) {
                                  cursorDiv = node as HTMLDivElement;
                                  break;
                                }
                                node = node.parentElement;
                              }

                              if (cursorDiv) {
                                const divIdx = divs.indexOf(cursorDiv);
                                if (divIdx !== -1) {
                                  insertLineIdx = divIdx;
                                  insertCharIdx = range.startOffset;
                                }
                              } else if (anchorNode === el) {
                                // Cursor is directly in the contentEditable (before any div)
                                insertLineIdx = 0;
                                insertCharIdx = 0;
                              }
                            }

                            // Delete selected text first if there's a selection
                            if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                              const range = selection.getRangeAt(0);
                              const el = e.currentTarget as HTMLElement;
                              const divs = Array.from(el.querySelectorAll('div')) as HTMLDivElement[];

                              let startLineIdx = insertLineIdx;
                              let startCharIdx = insertCharIdx;

                              let endNode: Node | null = range.endContainer;
                              let endDiv: HTMLDivElement | null = null;
                              let endNode2: Node | null = endNode;
                              while (endNode2 && endNode2 !== el) {
                                if (endNode2.parentElement === el && endNode2.nodeType === 1) {
                                  endDiv = endNode2 as HTMLDivElement;
                                  break;
                                }
                                endNode2 = endNode2.parentElement;
                              }

                              let endLineIdx = currentSectionLines.length - 1;
                              let endCharIdx = (currentSectionLines[endLineIdx] || '').length;
                              if (endDiv) {
                                const endDivIdx = divs.indexOf(endDiv);
                                if (endDivIdx !== -1) {
                                  endLineIdx = endDivIdx;
                                  endCharIdx = range.endOffset;
                                }
                              }

                              if (startLineIdx === endLineIdx) {
                                currentSectionLines[startLineIdx] =
                                  (currentSectionLines[startLineIdx] || '').slice(0, startCharIdx) +
                                  (currentSectionLines[startLineIdx] || '').slice(endCharIdx);
                              } else {
                                const startText = (currentSectionLines[startLineIdx] || '').slice(0, startCharIdx);
                                const endText = (currentSectionLines[endLineIdx] || '').slice(endCharIdx);
                                currentSectionLines.splice(startLineIdx, endLineIdx - startLineIdx + 1, startText + endText);
                              }
                            }

                            // Now insert pasted lines at cursor
                            const lineAtCursor = currentSectionLines[insertLineIdx] || '';
                            const before = lineAtCursor.slice(0, insertCharIdx);
                            const after = lineAtCursor.slice(insertCharIdx);

                            if (pastedLines.length === 1) {
                              currentSectionLines[insertLineIdx] = before + pastedLines[0] + after;
                            } else {
                              const firstLine = before + pastedLines[0];
                              const lastLine = pastedLines[pastedLines.length - 1] + after;
                              const middleLines = pastedLines.slice(1, -1);
                              currentSectionLines.splice(insertLineIdx, 1, firstLine, ...middleLines, lastLine);
                            }

                            const newSections = [...sectionsRef.current];
                            newSections[sectionIdx] = currentSectionLines;
                            sectionsRef.current = newSections;
                            setSections(newSections);
                            loadedLabelsRef.current = true;
                            const inputText = newSections.map(sec => {
                              const ls = sec.map((l, li) => li === 0 ? l.replace(/^"/, '') : l);
                              return ['"', ...ls].join('\n');
                            }).join('\n');
                            pasteJustFired.current = true;
                            setSongInput(inputText);
                            saveHistory();
                            setTimeout(() => { pasteJustFired.current = false; }, 300);
                          }
                        }}
                        onInput={(e) => {
                          // Live re-style lines as user types without committing to state
                          const el = e.currentTarget;
                          const divs = el.querySelectorAll('div');
                          divs.forEach(div => {
                            const text = (div.innerText || '').replace(/\u200B/g, '').trim();
                            if (!text) return;
                            const chord = isChordLine(text);
                            div.style.fontSize = chord ? '13pt' : '16pt';
                            div.style.fontWeight = chord ? '700' : '400';
                            div.style.lineHeight = '1.3';
                          });
                        }}
                        onBlur={(e) => {
                          // Skip if paste just handled state update directly
                          if (pasteJustFired.current) {
                            pasteJustFired.current = false;
                            setFocusedSection(null);
                            return;
                          }
                          // If focus is moving to another contentEditable section, don't clear focusedSection
                          const relatedTarget = e.relatedTarget as HTMLElement | null;
                          const editorWrapper = e.currentTarget.closest('[data-editor-wrapper]');
                          if (relatedTarget && editorWrapper?.contains(relatedTarget)) {
                            // focus moving within editor — skip
                          } else {
                            setFocusedSection(null);
                          }

                          // Prevent duplicate blur processing (can happen with paste)
                          const now = Date.now();
                          if (now - lastBlurTime.current < 100) {
                            console.log('Skipping duplicate blur');
                            return;
                          }
                          lastBlurTime.current = now;
                          
                          const newText = e.currentTarget.innerText || '';
                          const lines = newText.split('\n').map(l => l.replace(/\u200B/g, '')); // Remove zero-width spaces
                          console.log('onBlur - section', sectionIdx, '- lines:', lines.length);
                          
                          // Filter out trailing empty lines to prevent creating phantom sections
                          let trimmedLines = lines;
                          while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1].trim() === '') {
                            trimmedLines = trimmedLines.slice(0, -1);
                          }
                          // Keep at least one line even if empty
                          if (trimmedLines.length === 0) trimmedLines = [''];
                          
                          const newSections = [...sectionsRef.current];
                          newSections[sectionIdx] = trimmedLines;
                          
                          console.log('=== onBlur: Rebuilding songInput ===');
                          console.log('Section', sectionIdx, 'updated to:', trimmedLines);
                          console.log('Total sections:', newSections.length);
                          
                          setSections(newSections);
                          
                          // Rebuild songInput with proper section markers
                          const inputText = newSections.map((sec, i) => {
                            const lines = sec.map((l, li) => li === 0 ? l.replace(/^"/, '') : l);
                            console.log(`Section ${i}: first line = "${lines[0]?.substring(0, 50)}"`);
                            return ['"', ...lines].join('\n');
                          }).join('\n');
                          
                          console.log('=== Rebuilt songInput (first 500 chars) ===');
                          console.log(inputText.substring(0, 500));
                          console.log('========================================');
                          
                          setSongInput(inputText);
                          saveHistory();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Backspace' && sectionIdx > 0) {
                            // Check if cursor is at the very start of the first line
                            const sel = window.getSelection();
                            if (sel && sel.rangeCount > 0) {
                              const range = sel.getRangeAt(0);
                              const el = e.currentTarget;
                              const divs = Array.from(el.querySelectorAll('div'));
                              const firstDiv = divs[0];
                              const isAtStart = range.startOffset === 0 &&
                                (range.startContainer === firstDiv ||
                                 range.startContainer === firstDiv?.firstChild ||
                                 (divs.indexOf(range.startContainer as unknown as HTMLDivElement) === 0));
                              if (isAtStart) {
                                e.preventDefault();
                                // Merge this section into the previous one
                                const currentLines = divs.map(d =>
                                  (d.innerText || '').replace(/\u200B/g, '')
                                ).filter((l, i, arr) => i < arr.length - 1 || l !== '');
                                const prevSection = sections[sectionIdx - 1];
                                const merged = [...prevSection, ...currentLines];
                                const newSections = [...sections];
                                newSections[sectionIdx - 1] = merged;
                                newSections.splice(sectionIdx, 1);
                                setSections(newSections);
                                const newLabels = [...sectionLabels];
                                newLabels.splice(sectionIdx, 1);
                                setSectionLabels(newLabels);
                                const newRepeats = [...sectionRepeats];
                                newRepeats.splice(sectionIdx, 1);
                                setSectionRepeats(newRepeats);
                                const inputText = newSections.map((sec, i) => {
                                  const lines = sec.map((l, li) => li === 0 ? l.replace(/^"/, '') : l);
                                  return ['"', ...lines].join('\n');
                                }).join('\n');
                                setSongInput(inputText);
                                // Focus previous section, place cursor at end of last line before merge point
                                setTimeout(() => {
                                  const rows = document.querySelectorAll('[data-section-idx]');
                                  const prevRow = rows[sectionIdx - 1];
                                  if (prevRow) {
                                    const ce = prevRow.querySelector('[contenteditable]') as HTMLElement;
                                    if (ce) {
                                      ce.focus();
                                      const prevDivs = ce.querySelectorAll('div');
                                      const targetDiv = prevDivs[prevSection.length - 1] || prevDivs[prevDivs.length - 1];
                                      if (targetDiv) {
                                        const r = document.createRange();
                                        const textNode = targetDiv.firstChild;
                                        const offset = textNode ? (textNode as Text).length ?? 0 : 0;
                                        r.setStart(textNode || targetDiv, offset);
                                        r.collapse(true);
                                        const s = window.getSelection();
                                        s?.removeAllRanges();
                                        s?.addRange(r);
                                      }
                                    }
                                  }
                                }, 50);
                                return;
                              }
                            }
                          }
                          if (e.key === 'Enter' && e.shiftKey) {
                            e.preventDefault();

                            // Get cursor position within the contentEditable
                            const sel = window.getSelection();
                            const el = e.currentTarget;
                            const divs = Array.from(el.querySelectorAll('div'));

                            // Find which div the cursor is in and its char offset
                            let cursorLineIdx = divs.length - 1;
                            let cursorCharIdx = 0;
                            if (sel && sel.rangeCount > 0) {
                              const range = sel.getRangeAt(0);
                              const container = range.startContainer;
                              for (let i = 0; i < divs.length; i++) {
                                if (divs[i] === container || divs[i].contains(container)) {
                                  cursorLineIdx = i;
                                  cursorCharIdx = range.startOffset;
                                  break;
                                }
                              }
                            }

                            // Get current lines from the DOM (live, not stale state)
                            const currentLines = divs.map(d =>
                              (d.innerText || '').replace(/\u200B/g, '')
                            );

                            // Split at cursor: lines before+at cursor line stay, rest go to new section
                            const lineAtCursor = currentLines[cursorLineIdx] || '';
                            const before = lineAtCursor.slice(0, cursorCharIdx);
                            const after = lineAtCursor.slice(cursorCharIdx);

                            const thisSection = [
                              ...currentLines.slice(0, cursorLineIdx),
                              before,
                            ].filter((l, i, arr) => i < arr.length - 1 || l !== '' || arr.length === 1);

                            const newSection = [
                              after,
                              ...currentLines.slice(cursorLineIdx + 1),
                            ].filter((l, i) => i > 0 || l !== ''); // drop leading empty line

                            const newSections = [...sections];
                            newSections[sectionIdx] = thisSection.length ? thisSection : [''];
                            newSections.splice(sectionIdx + 1, 0, newSection.length ? newSection : ['']);
                            setSections(newSections);

                            const newLabels = [...sectionLabels];
                            newLabels.splice(sectionIdx + 1, 0, 'Verse');
                            setSectionLabels(newLabels);

                            const newRepeats = [...sectionRepeats];
                            newRepeats.splice(sectionIdx + 1, 0, 1);
                            setSectionRepeats(newRepeats);

                            const inputText = newSections.map((sec, i) => {
                              const lines = sec.map((l, li) => li === 0 ? l.replace(/^"/, '') : l);
                              return ['"', ...lines].join('\n');
                            }).join('\n');
                            setSongInput(inputText);

                            // Focus the new section after render
                            setTimeout(() => {
                              const rows = document.querySelectorAll('[data-section-idx]');
                              const nextRow = rows[sectionIdx + 1];
                              if (nextRow) {
                                const ce = nextRow.querySelector('[contenteditable]') as HTMLElement;
                                if (ce) {
                                  ce.focus();
                                  // Place cursor at start
                                  const r = document.createRange();
                                  const firstDiv = ce.querySelector('div');
                                  if (firstDiv) {
                                    const textNode = firstDiv.firstChild || firstDiv;
                                    r.setStart(textNode, 0);
                                    r.collapse(true);
                                    const s = window.getSelection();
                                    s?.removeAllRanges();
                                    s?.addRange(r);
                                  }
                                }
                              }
                            }, 50);
                          }
                        }}
                        dangerouslySetInnerHTML={{
                          __html: section.map((line, lineIdx) => {
                            // Strip quote marks used for section markers
                            const cleanLine = line.replace(/^"/, '').replace(/"$/, '');
                            const overrideKey = `${sectionIdx}-${lineIdx}`;
                            
                            // Check for format override first
                            let isChord: boolean;
                            if (lineFormatOverrides[overrideKey]) {
                              isChord = lineFormatOverrides[overrideKey] === 'chord';
                            } else {
                              isChord = Boolean(cleanLine.trim() && isChordLine(cleanLine));
                            }
                            
                            if (cleanLine.includes("F#m") || cleanLine.includes("F##m")) {
                              console.log(`Editor line: "${cleanLine}", isChord=${isChord}`);
                            }
                            const fontSize = isChord ? "13pt" : "16pt";
                            const fontWeight = isChord ? 700 : 400;
                            const displayLine = cleanLine || '\u200B';
                            
                            // Add a small indicator if this line has a format override
                            const overrideIndicator = lineFormatOverrides[overrideKey] ? '<span style="color: #3b82f6; margin-left: 4px; font-size: 8pt;">●</span>' : '';
                            
                            const escapedLine = displayLine.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            const styledLine = escapedLine.replace(/\[3\]/g, '<span style="color:#7F77DD;font-size:10pt;font-weight:700;letter-spacing:0.5px;">[3]</span>');
                            return `<div data-line-idx="${lineIdx}" style="font-size: ${fontSize}; font-weight: ${fontWeight}; line-height: 1.3; white-space: pre;">${styledLine}${overrideIndicator}</div>`;
                          }).join('') || '<div>\u200B</div>'
                        }}
                        style={{
                          fontFamily: "Helvetica, sans-serif",
                          lineHeight: "1.3",
                          minHeight: "1.3em",
                          padding: "2px 0",
                          outline: "none",
                          cursor: 'text',
                          userSelect: 'text',
                          display: 'block',
                        }}
                      />
                    </td>
                    
                    {/* Delete Section Column */}
                    <td style={{ padding: "6px", verticalAlign: "top", width: 40, textAlign: "center", userSelect: "none" }}>
                      {sections.length > 1 && (
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (window.confirm('Delete this section?')) {
                              // Remove focus to prevent onBlur conflicts
                              if (document.activeElement instanceof HTMLElement) {
                                document.activeElement.blur();
                              }
                              
                              setTimeout(() => {
                                const newSections = sections.filter((_, i) => i !== sectionIdx);
                                setSections(newSections);
                                
                                // Remove corresponding labels and repeats
                                const newLabels = sectionLabels.filter((_, i) => i !== sectionIdx);
                                setSectionLabels(newLabels);
                                const newRepeats = sectionRepeats.filter((_, i) => i !== sectionIdx);
                                setSectionRepeats(newRepeats);
                                
                                // Rebuild songInput
                                const inputText = newSections.map((sec, i) => {
                                  const lines = sec.map((l, li) => li === 0 ? l.replace(/^"/, '') : l);
                                  return ['"', ...lines].join('\n');
                                }).join('\n');
                                setSongInput(inputText);
                                saveHistory();
                              }, 10);
                            }
                          }}
                          style={{
                            padding: "4px 8px",
                            fontSize: "9pt",
                            cursor: "pointer",
                            backgroundColor: "#fee",
                            color: "#c00",
                            border: "1px solid #c00",
                            borderRadius: 3,
                            fontFamily: "Helvetica, sans-serif"
                          }}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Inline blank rows that follow this section */}
                  {blankSections
                    .filter(b => b.afterIdx === sectionIdx)
                    .map(blank => {
                      const blankColor = ({ Verse: '#6366f1', Chorus: '#ec4899', Bridge: '#f59e0b', 'Pre-Chorus': '#8b5cf6', Intro: '#10b981', Outro: '#10b981', Instrumental: '#64748b', Tag: '#0ea5e9', Coda: '#0ea5e9' } as Record<string,string>)[blank.label] || '#6b7280';
                      const contentSectionsForLabel = sections
                        .map((sec, si) => ({ sec, si, lbl: sectionLabels[si] || 'Verse' }))
                        .filter(({ sec, lbl }) => lbl === blank.label && sec.some(l => l.replace(/[\u00A0\uFFFC\u200B\u200C\u200D\uFEFF]/g, '').trim()));
                      const ghostSrcIdx = ghostSourceByBlank[blank.id];
                      const shortLabel = blank.label === 'Verse' ? 'v' : blank.label === 'Chorus' ? 'c' : blank.label === 'Bridge' ? 'b' : blank.label === 'Pre-Chorus' ? 'prech' : blank.label.slice(0,4).toLowerCase();
                      return (
                        <tr key={blank.id} style={{ backgroundColor: '#fafafa', borderTop: '1px dashed #e5e7eb' }}>
                          <td style={{ padding: '6px 8px', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {/* Faded blank pill showing what type this blank is */}
                              <span style={{ display: 'inline-block', border: `1.5px solid ${blankColor}`, borderRadius: 1, padding: '2px 6px', fontSize: '9pt', fontWeight: 700, color: blankColor, opacity: 0.4, width: 'fit-content' }}>
                                {shortLabel}
                              </span>
                              {/* Clickable source pills — click one to pin which content section this blank mirrors */}
                              {contentSectionsForLabel.map(({ si }, ci) => {
                                const isSelected = ghostSrcIdx === si;
                                const srcPillLabel = `${shortLabel}${contentSectionsForLabel.length > 1 ? ci + 1 : ''}`;
                                return (
                                  <span
                                    key={si}
                                    onClick={() => {
                                      const newMap = { ...ghostSourceByBlank };
                                      if (isSelected) { delete newMap[blank.id]; } else { newMap[blank.id] = si; }
                                      setGhostSourceByBlank(newMap);
                                    }}
                                    title={isSelected ? `Pinned to ${srcPillLabel} — click to unpin` : `Pin ghost to ${srcPillLabel}`}
                                    style={{ display: 'inline-block', border: `1.5px solid ${blankColor}`, borderRadius: 1, padding: '2px 6px', fontSize: '9pt', fontWeight: 700, color: isSelected ? 'white' : blankColor, backgroundColor: isSelected ? blankColor : 'transparent', cursor: 'pointer', width: 'fit-content', userSelect: 'none' }}
                                  >
                                    {srcPillLabel}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td style={{ padding: '6px 8px', color: '#ccc', fontSize: '9pt', fontStyle: 'italic', fontFamily: 'Helvetica, sans-serif', verticalAlign: 'middle' }}>
                            blank
                          </td>
                          <td style={{ padding: '6px', verticalAlign: 'middle', width: 40, textAlign: 'center' }}>
                            <button
                              onClick={() => {
                                setBlankSections(prev => prev.filter(b => b.id !== blank.id));
                                const newMap = { ...ghostSourceByBlank };
                                delete newMap[blank.id];
                                setGhostSourceByBlank(newMap);
                              }}
                              style={{ padding: '2px 6px', fontSize: '9pt', cursor: 'pointer', backgroundColor: '#fee', color: '#c00', border: '1px solid #c00', borderRadius: 3, fontFamily: 'Helvetica, sans-serif' }}
                            >×</button>
                          </td>
                        </tr>
                      );
                    })
                  }

                  </React.Fragment>
                );
              });
              })()}
              </React.Fragment>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: "9pt", color: "#666", marginTop: 4, fontFamily: "Helvetica, sans-serif", fontStyle: "italic" }}>
          Press Enter for new line • Shift+Enter for new section • Click "+ Section" or "×" to manage sections
        </div>
      </div>

      {/* Save Button */}
      <div style={{ marginBottom: 10 }}>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={handleSaveClick}
          style={{ padding: '6px 12px', fontSize: '12pt', cursor: 'pointer', backgroundColor: '#1a1a1a', color: 'white', border: '1px solid #1a1a1a', borderRadius: '4px', fontFamily: "Helvetica, sans-serif" }}
        >
          {initialSong ? 'Update in Archive' : 'Save to Archive'}
        </button>
      </div>
    </div>
  );
}

// ============================
// Helper Functions
// ============================
// Transpose a chord line string, applying the same spacing adjustments as the editor:
// if a chord gains a #/b it gets wider (remove 2 spaces after), loses one it gets narrower (add 2 spaces after)

function transposeChordLine(line: string, originalKey: string, displayKey: string, inputType: string): string {
  const tokens = line.split(/(\s+)/);
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\s*$/.test(t)) {
      // This is a whitespace token — check the previous chord token for accidental change
      const prevToken = i > 0 ? tokens[i - 1] : '';
      const nextToken = i < tokens.length - 1 ? tokens[i + 1] : '';
      // Don't adjust spaces before / | or after .
      const hasException = (nextToken === '/' || nextToken === '|' || nextToken.startsWith('.')) ||
                           (prevToken.endsWith('.'));
      let spacingAdjustment = 0;
      if (!hasException && prevToken && !/^\s*$/.test(prevToken)) {
        if (prevToken.includes('/')) {
          const parts = prevToken.split('/');
          const convertedParts = convertChord(prevToken, originalKey, displayKey, inputType === 'letters').split('/');
          parts.forEach((part, partIdx) => {
            const origHasAccidental = /[#b]/.test(part);
            const newHasAccidental = convertedParts[partIdx] ? /[#b]/.test(convertedParts[partIdx]) : false;
            if (!origHasAccidental && newHasAccidental) spacingAdjustment -= 2;
            else if (origHasAccidental && !newHasAccidental) spacingAdjustment += 2;
          });
        } else {
          const origHasAccidental = /[#b]/.test(prevToken);
          const converted = convertChord(prevToken, originalKey, displayKey, inputType === 'letters');
          const newHasAccidental = /[#b]/.test(converted);
          if (!origHasAccidental && newHasAccidental) spacingAdjustment = -2;
          else if (origHasAccidental && !newHasAccidental) spacingAdjustment = 2;
        }
      }
      let spaces = t;
      if (spacingAdjustment < 0) spaces = spaces.slice(0, Math.max(0, spaces.length + spacingAdjustment));
      else if (spacingAdjustment > 0) spaces = spaces + ' '.repeat(spacingAdjustment);
      result.push(spaces);
    } else {
      result.push(convertChord(t, originalKey, displayKey, inputType === 'letters'));
    }
  }
  return result.join('');
}

function buildExportParams(song: SavedSong, displayKey: string, useFlats: boolean): ExportParams {
  const inputType: "letters" | "numbers" = (() => {
    for (const line of song.input.split("\n")) {
      const normalized = line.replace(/\u00A0/g, ' ').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
      if (!normalized || normalized.startsWith('"')) continue;
      // Only check lines that look like chord lines
      const tokens = normalized.split(' ').filter(Boolean);
      const looksLikeChordLine = tokens.some(t => /^[A-G][#b]?((m|maj|dim|aug|sus)?[0-9]*)?(\/[A-G][#b]?)?$/.test(t)) ||
        tokens.every(t => /^[1-7](b|#)?(maj|min|m|dim|aug|sus|sus2|sus4|add)?[0-9]*$/.test(t) || /^[\/|.\-x%]+$/.test(t));
      if (!looksLikeChordLine) continue;
      for (const t of tokens) {
        if (/^[1-7](b|#)?(maj|min|m|dim|aug|sus|sus2|sus4|add)?[0-9]*$/.test(t)) return "numbers";
        if (/^[A-G][#b]?/.test(t)) return "letters";
      }
    }
    return "letters";
  })();

  // Parse raw sections from input — skip blank lines entirely to avoid ghost empty sections
  const rawLines = song.input.split("\n").map((l: string) =>
    l.startsWith(". ") ? l.slice(2) : l.startsWith(".") ? l.slice(1) : l
  );
  const baseSections: string[][] = [];
  let cur: string[] = [];
  let inSection = false;
  rawLines.forEach((line: string) => {
    if (line.startsWith('"')) {
      // Push previous section (even if empty — empty = repeat placeholder)
      if (inSection) baseSections.push(cur);
      inSection = true;
      let first = line.slice(1);
      if (first.endsWith('"')) first = first.slice(0, -1);
      cur = first.trim() ? [first] : [];
    } else if (line.replace(/[\u00A0\uFFFC\u200B\u200C\u200D\uFEFF]/g, '').trim() === '') {
      // Blank line between sections — ignore (separators only in quote-marker format)
    } else {
      if (line.endsWith('"')) {
        cur.push(line.slice(0, -1).trimEnd());
        baseSections.push(cur);
        inSection = false;
        cur = [];
      } else {
        cur.push(line.trimEnd());
      }
    }
  });
  if (inSection) baseSections.push(cur);

  // Rebuild displaySections applying saved manualSplits and manualMerges
  const manualSplits = song.manualSplits || [];
  const manualMerges = song.manualMerges || [];
  const displaySections: { lines: string[]; baseSectionIdx: number; lineOffset: number }[] = [];

  baseSections.forEach((section, sIdx) => {
    const splits = manualSplits.filter(s => s.sectionIdx === sIdx).map(s => s.lineIdx).sort((a, b) => a - b);
    const subSections: { lines: string[]; lineOffset: number }[] = [];
    let prev = 0;
    splits.forEach(splitAt => {
      subSections.push({ lines: section.slice(prev, splitAt + 1), lineOffset: prev });
      prev = splitAt + 1;
    });
    subSections.push({ lines: section.slice(prev), lineOffset: prev });

    subSections.forEach((sub, subIdx) => {
      if (subIdx === 0 && manualMerges.includes(sIdx) && displaySections.length > 0) {
        displaySections[displaySections.length - 1].lines.push(...sub.lines);
      } else {
        displaySections.push({ lines: sub.lines, baseSectionIdx: sIdx, lineOffset: sub.lineOffset });
      }
    });
  });

  return {
    title: song.title,
    bpm: song.bpm,
    writers: song.writers,
    originalKey: (() => {
      const raw = song.key.replace(/m$/, '');
      const ENHARMONIC_NORM: Record<string,string> = { 'G#':'Ab','A#':'Bb','C#':'Db','D#':'Eb' };
      return (typeof KEYS[raw] === 'undefined' && ENHARMONIC_NORM[raw]) ? ENHARMONIC_NORM[raw] : raw;
    })(),
    displayKey,
    useFlats,
    inputType,
    displaySections,
    blankSections: (song.blankSections || []).map(b => ({ ...b, id: b.id || `legacy_${b.afterIdx}_${b.label}` })),
    ghostSourceByBlank: song.ghostSourceByBlank,
    sectionLabels: song.sectionLabels || displaySections.map(() => "Verse"),
    sectionRepeats: song.sectionRepeats || displaySections.map(() => 1),
    lineOverrides: (() => {
      const raw = song.key.replace(/m$/, '');
      const ENHARMONIC_NORM: Record<string,string> = { 'G#':'Ab','A#':'Bb','C#':'Db','D#':'Eb' };
      const normalizedBase = (typeof KEYS[raw] === 'undefined' && ENHARMONIC_NORM[raw]) ? ENHARMONIC_NORM[raw] : raw;
      return displayKey === normalizedBase ? (song.lineOverrides || {}) : {};
    })(),
  };
}

// ============================
// Shared AppBar button styles
// ============================
const APP_BAR_BTN: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  backgroundColor: "#ffffff",
  color: "#334155",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
  transition: "background-color 0.15s ease",
  whiteSpace: "nowrap" as const,
  lineHeight: 1.4,
};
const APP_BAR_BTN_PRIMARY: React.CSSProperties = {
  ...APP_BAR_BTN,
  backgroundColor: "#0f172a",
  color: "white",
  border: "none",
};
const APP_BAR_BTN_DANGER: React.CSSProperties = {
  ...APP_BAR_BTN,
  backgroundColor: "#fee2e2",
  color: "#dc2626",
  border: "none",
};

function SongPreview({ song, onEdit, onBack, onForward, onHome, setlist, setlistIdx, onSetlistNav, authUser, onBookmark, isBookmarked, sourceTab, onDuplicate, onCopyToPublic, settings, onSettingsChange, spotifyToken, spotifyPlayer, spotifyDeviceId, spotifyReady, spotifyTogglePlay, onSave, allSongs, onAddVersion, onSetPreferredVersion, onSwitchVersion, onDisplayKeyChange }: {
  song: SavedSong;
  onEdit: () => void;
  onBack: () => void;
  onForward?: () => void;
  onHome: () => void;
  setlist?: Setlist | null;
  setlistIdx?: number;
  onSetlistNav?: (dir: number) => void;
  authUser?: AuthUser | null;
  onBookmark?: (song: SavedSong) => void;
  isBookmarked?: boolean;
  sourceTab?: 'public' | 'mine';
  onDuplicate?: (song: SavedSong) => void;
  onCopyToPublic?: (song: SavedSong) => void;
  settings?: UserSettings;
  onSettingsChange?: (settings: UserSettings) => void;
  spotifyToken?: string | null;
  spotifyPlayer?: React.MutableRefObject<any>;
  spotifyDeviceId?: React.MutableRefObject<string | null>;
  spotifyReady?: React.MutableRefObject<boolean>;
  spotifyTogglePlay?: React.MutableRefObject<(() => void) | null>;
  onSave?: (song: SavedSong) => void;
  allSongs?: SavedSong[];
  onAddVersion?: (parentId: string) => void;
  onSetPreferredVersion?: (parentId: string, versionId: string) => void;
  onSwitchVersion?: (song: SavedSong) => void;
  onDisplayKeyChange?: (key: string) => void;
}) {
  const KEY_LIST = ['A','Bb','B','C','Db','D','Eb','E','F','F#','G','Ab'];
  // Standard minor key names for each major root — minor keys prefer sharps
  const MINOR_KEY_LABELS: Record<string, string> = {
    'A': 'Am', 'Bb': 'Bbm', 'B': 'Bm', 'C': 'Cm', 'Db': 'C#m',
    'D': 'Dm', 'Eb': 'D#m', 'E': 'Em', 'F': 'Fm', 'F#': 'F#m',
    'G': 'Gm', 'Ab': 'G#m'
  };
  const [displayKey, setDisplayKey] = useState<string>(() => {
    const raw = ((song as any).openKey || song.key).replace(/m$/, '');
    const ENHARMONIC_NORM: Record<string,string> = { 'G#':'Ab','A#':'Bb','C#':'Db','D#':'Eb' };
    return (typeof KEYS[raw] === 'undefined' && ENHARMONIC_NORM[raw]) ? ENHARMONIC_NORM[raw] : raw;
  });
  const effectiveDisplayKey = displayKey;
  // Strip minor suffix for all chord math — song.key may be "Am", "Em" etc.
  const songBaseKey = (() => {
    const raw = song.key.replace(/m$/, '');
    // Normalize to a key that exists in KEYS (e.g. G# → Ab, A# → Bb)
    const ENHARMONIC_NORM: Record<string,string> = { 'G#':'Ab','A#':'Bb','C#':'Db','D#':'Eb','F#':'F#' };
    return (typeof KEYS[raw] === 'undefined' && ENHARMONIC_NORM[raw]) ? ENHARMONIC_NORM[raw] : raw;
  })();
  const songIsMinor = song.key.endsWith('m');
  // Enharmonic equivalent of the base key (for dot indicator matching)
  const ENHARMONIC_MAP: Record<string,string> = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#','C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb' };
  const songBaseKeyAlt = ENHARMONIC_MAP[songBaseKey] || songBaseKey;

  // Sharps vs flats preference — default based on stored key (raw, before normalization)
  const FLAT_KEYS = new Set(['F','Bb','Eb','Ab','Db','Gb']);
  const SHARP_KEYS = new Set(['G','D','A','E','B','F#','C#','G#','D#','A#']);
  const FLAT_MINOR_KEYS = new Set(['D','G','C','F','Bb','Eb','Ab']); // relative minor roots that use flats
  const SHARP_MINOR_KEYS = new Set(['A','E','B','F#','C#','G#','D#']); // relative minor roots that use sharps
  const rawStoredBase = song.key.replace(/m$/, '');
  const defaultUseFlats = songIsMinor
    ? SHARP_MINOR_KEYS.has(rawStoredBase) ? false : FLAT_MINOR_KEYS.has(rawStoredBase) ? true : FLAT_KEYS.has(songBaseKey)
    : SHARP_KEYS.has(rawStoredBase) ? false : FLAT_KEYS.has(songBaseKey);
  const [useFlats, setUseFlats] = useState<boolean>(defaultUseFlats);

  // Enharmonic maps for rendering
  const TO_FLAT: Record<string, string> = { 'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb' };
  const TO_SHARP: Record<string, string> = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };

  // Convert a single note/chord token's accidentals based on preference
  const applyAccidentalPref = (chord: string): string => {
    if (useFlats) {
      return chord.replace(/([A-G])(#)/g, (_, note, acc) => TO_FLAT[note + acc] || (note + acc));
    } else {
      return chord.replace(/([A-G])(b)/g, (_, note, acc) => TO_SHARP[note + acc] || (note + acc));
    }
  };

  // Apply preference to a full chord line (already transposed)
  const applyAccidentalPrefToLine = (line: string): string => {
    return line.split(/(\s+)/).map(t => /^\s+$/.test(t) ? t : applyAccidentalPref(t)).join('');
  };

  // Key label shown in UI — respects flat/sharp preference
  const displayKeyLabel = applyAccidentalPref(effectiveDisplayKey);
  const [favoriteKey, setFavoriteKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [ppMode, setPpMode] = useState(false);
  const [ppChordSize, setPpChordSize] = useState(59);
  const [ppCopiedIdx, setPpCopiedIdx] = useState<number | null>(null);
  // ppSectionLines: local line overrides per section (after user splits)
  const [ppSectionLines, setPpSectionLines] = useState<{[idx: number]: string[]}>({});
  // ppSplitCursor: which line the user clicked, char position in that line, and raw pixel X for partner-line lookup
  const [ppSplitCursor, setPpSplitCursor] = useState<{secIdx: number; lineIdx: number; charPos: number; clientX: number} | null>(null);
  
  // Load favorite key from database
  useEffect(() => {
    const loadFavoriteKey = async () => {
      if (!authUser) return;
      try {
        const { data, error } = await supabase
          .from('favorite_keys')
          .select('favorite_key')
          .eq('user_id', authUser.id)
          .eq('song_id', song.id)
          .single();
        
        if (!error && data) {
          setFavoriteKey(data.favorite_key);
          // Only apply favorite key if the song was NOT opened with a specific plan key
          if (!(song as any).openKey) {
            setDisplayKey(data.favorite_key);
            setUseFlats(FLAT_KEYS.has(data.favorite_key));
          }
        }
      } catch (e) {
        // No favorite key exists, that's fine
      }
    };
    loadFavoriteKey();
  }, [authUser, song.id]);
  
  // Toggle favorite key
  const toggleFavoriteKey = async (key: string) => {
    if (!authUser) return;
    
    try {
      if (favoriteKey === key) {
        // Remove favorite
        await supabase
          .from('favorite_keys')
          .delete()
          .eq('user_id', authUser.id)
          .eq('song_id', song.id);
        setFavoriteKey(null);
      } else {
        // Set favorite (upsert)
        await supabase
          .from('favorite_keys')
          .upsert({
            user_id: authUser.id,
            song_id: song.id,
            favorite_key: key
          });
        setFavoriteKey(key);
      }
    } catch (error) {
      console.error('Error toggling favorite key:', error);
    }
  };
  const [showGhost, setShowGhost] = useState(true);
  const isMobile = window.innerWidth < 768;
  const [showMenu, setShowMenu] = useState(false);
  const spotifyBarRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll + section highlight state
  const [playbackPos, setPlaybackPos] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [playbackPlaying, setPlaybackPlaying] = useState(false);
  const sectionRowRefs = React.useRef<(HTMLTableRowElement | null)[]>([]);
  const chartScrollRef = React.useRef<HTMLDivElement>(null);
  const autoScrollPausedRef = React.useRef(false);

  // Section marker timings (ms) — saved to Supabase, cached in Preferences
  const timingsKey = `section_timings_${song.id}`;
  const [sectionTimings, setSectionTimings] = useState<number[]>([]);
  const [editingMarkers, setEditingMarkers] = useState(false);
  const timingsSaveTimer = React.useRef<NodeJS.Timeout | null>(null);

  // Seed from Preferences immediately so there's no flash on re-visit
  React.useEffect(() => {
    store.get(timingsKey).then(s => {
      try { if (s) setSectionTimings(JSON.parse(s)); } catch {}
    });
  }, [timingsKey]);

  // Load timings from Supabase on mount (authoritative source)
  React.useEffect(() => {
    if (!authUser) return;
    supabase
      .from('section_timings')
      .select('timings')
      .eq('user_id', authUser.id)
      .eq('song_id', song.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.timings && Array.isArray(data.timings) && data.timings.length > 0) {
          setSectionTimings(data.timings);
          store.set(timingsKey, JSON.stringify(data.timings));
        }
      });
  }, [song.id, authUser?.id]);

  // Save timings to Preferences immediately and Supabase after a short debounce
  React.useEffect(() => {
    if (sectionTimings.length === 0) return;
    store.set(timingsKey, JSON.stringify(sectionTimings));
    if (!authUser) return;
    if (timingsSaveTimer.current) clearTimeout(timingsSaveTimer.current);
    timingsSaveTimer.current = setTimeout(() => {
      supabase
        .from('section_timings')
        .upsert({ user_id: authUser.id, song_id: song.id, timings: sectionTimings, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,song_id' })
        .then(({ error }) => { if (error) console.error('Error saving timings:', error); });
    }, 800);
    return () => { if (timingsSaveTimer.current) clearTimeout(timingsSaveTimer.current); };
  }, [sectionTimings]);

  // rowsRef keeps rows current for auto-scroll effect
  const rowsRef = React.useRef<any[]>([]);

  // When the PP modal opens, snapshot the current section lines into ppSectionLines
  // so the modal can maintain its own split-edited copies independently.
  React.useEffect(() => {
    if (ppMode) {
      const init: {[idx: number]: string[]} = {};
      rowsRef.current
        .filter((r: any) => r.type === 'section')
        .forEach((r: any, i: number) => { init[i] = [...r.lines]; });
      setPpSectionLines(init);
      setPpSplitCursor(null);
    }
  }, [ppMode]);

  // Lock body scroll while preview is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  
  // Keyboard shortcuts:
  // Space = play/pause Spotify
  // Tab = cycle zoom (fit → reset → fit...)
  // Shift+Tab = toggle ghost lines
  // Arrow left/right = setlist navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Setlist navigation
      if (setlist && onSetlistNav) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); onSetlistNav(-1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); onSetlistNav(1); return; }
      }

      // Shift+Tab = toggle ghost lines
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        setShowGhost(g => !g);
        return;
      }

      // Tab = cycle zoom: small ↔ normal
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        setZoom(z => z < 0.9 ? 1.0 : 0.75);
        return;
      }

      // Space = play/pause Spotify (same as clicking the button)
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (spotifyTogglePlay?.current) spotifyTogglePlay.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setlist, onSetlistNav, zoom, spotifyTogglePlay]);

  const [tableWidth, setTableWidth] = useState<number | null>(null);
  const [tableHeight, setTableHeight] = useState<number>(0);
  const tableRef = React.useRef<HTMLTableElement>(null);

  // Fit table width on mobile — declared after tableWidth so deps are valid
  const fitZoom = React.useCallback(() => {
    if (!isMobile || !tableRef.current) return;
    const naturalWidth = tableRef.current.scrollWidth;
    const available = window.innerWidth - 8;
    if (naturalWidth > available) {
      setZoom(parseFloat(Math.max(0.3, available / naturalWidth).toFixed(2)));
    }
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    fitZoom();
    const t = setTimeout(fitZoom, 400);
    return () => clearTimeout(t);
  }, [fitZoom]);

  useEffect(() => {
    if (!isMobile || !tableWidth) return;
    const t = setTimeout(fitZoom, 100);
    return () => clearTimeout(t);
  }, [tableWidth, isMobile, fitZoom]);
  React.useEffect(() => {
    if (!tableRef.current) return;
    const update = () => {
      if (tableRef.current) {
        setTableWidth(tableRef.current.getBoundingClientRect().width);
        // scrollHeight gives the natural unscaled height regardless of CSS transform
        setTableHeight(tableRef.current.scrollHeight);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(tableRef.current);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [zoom]);
  const params = buildExportParams(song, effectiveDisplayKey, useFlats);
  console.log('PREVIEW DEBUG song.blankSections:', JSON.stringify(song.blankSections));

  const sectionColors = SECTION_COLORS_HEX;

  const isChordLine = (line: string) => {
    const tokens = line.replace(/\u266D/g, 'b').replace(/\u266F/g, '#').replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '').replace(/\u200B/g, '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!tokens.length) return false;
    const isSymbol = (t: string) => /^[\/|.\-x%]+$/.test(t);
    const isChord = (t: string) => {
      const cleaned = t.replace(/[()]/g, '');
      if (/^\/[A-G][#b]?$/.test(cleaned)) return true;
      return /^[A-G][#b]?((m|maj|7|9|11|13|dim|aug|sus|sus2|sus4|add|º|°)?[0-9]*)?(\/[A-G][#b]?)?\.?$/.test(cleaned);
    };
    const CHORD_SUFFIXES = /^(maj|dim|aug|sus|add)/i;
    const isClearWord = (t: string) => {
      if (isChord(t)) return false;
      if (CHORD_SUFFIXES.test(t.slice(1))) return false;
      return /^[A-Za-z][a-z]{2,}/.test(t);
    };
    const symbolCount = tokens.filter(t => isSymbol(t)).length;
    const chordCount = tokens.filter(t => !isSymbol(t) && isChord(t)).length;
    const wordCount = tokens.filter(t => !isSymbol(t) && isClearWord(t)).length;
    const meaningfulCount = tokens.length - symbolCount;
    if (meaningfulCount === 0) return true; // all symbols = chord line (e.g. "/ / / /")
    if (wordCount > 0) return false;
    if (chordCount > 0 && wordCount === 0) return true;
    return chordCount / meaningfulCount >= 0.5;
  };

  // Build same combined row order as PDF: display sections + blank rows interleaved
  type PreviewRow =
    | { type: "section"; sectionIdx: number; lines: string[]; label: string; repeat: number }
    | { type: "blank"; id?: string; label: string; repeat: number };

  const rows: PreviewRow[] = [];
  params.displaySections.forEach(({ lines }, sectionIdx) => {
    const label = params.sectionLabels[sectionIdx] || "Verse";
    const repeat = params.sectionRepeats[sectionIdx] || 1;
    rows.push({ type: "section", sectionIdx, lines, label, repeat });
    params.blankSections
      .filter(b => b.afterIdx === sectionIdx)
      .forEach(b => rows.push({ type: "blank", label: b.label, repeat: b.repeat }));
  });
  params.blankSections
    .filter(b => b.afterIdx >= params.displaySections.length)
    .forEach(b => rows.push({ type: "blank", id: b.id, label: b.label, repeat: b.repeat }));

  // Update rowsRef synchronously so fetchAudioAnalysis always sees current rows
  rowsRef.current = rows;

  // Pre-populate ghost content — ghostSourceByBlank (per blank instance) takes priority,
  // with ghostSourceByLabel as legacy fallback, otherwise last occurrence wins
  const ghostSourceByLabel = song.ghostSourceByLabel || {};
  const ghostSourceByBlank = (params as any).ghostSourceByBlank || song.ghostSourceByBlank || {};
  const lastLinesByLabel: Record<string, string[]> = {};
  const linesBySection: Record<number, string[]> = {}; // sectionIdx -> lines for blank-specific lookup
  let lastLinesAny: string[] = [];
  const nonEmptyCountByLabelPreview: Record<string, number> = {};
  rows.forEach(row => {
    if (row.type === "section") {
      const hasContent = row.lines.some(l => l.replace(/[\u00A0\uFFFC\u200B\u200C\u200D\uFEFF]/g, '').trim());
      if (hasContent) {
        nonEmptyCountByLabelPreview[row.label] = (nonEmptyCountByLabelPreview[row.label] || 0) + 1;
        linesBySection[row.sectionIdx] = row.lines;
        const pinnedIdx = ghostSourceByLabel[row.label];
        if (pinnedIdx === undefined) {
          lastLinesByLabel[row.label] = row.lines;
        } else if (row.sectionIdx === pinnedIdx) {
          lastLinesByLabel[row.label] = row.lines;
        }
        lastLinesAny = row.lines;
      }
    }
  });

  // Section label counter for pill text (v1, v2, c1, etc.)
  const sectionCounts: Record<string, number> = {};
  const getLabelText = (labelType: string, repeat: number = 1) => {
    const base = labelType === "Verse" ? "v" : labelType === "Chorus" ? "c" : labelType === "Bridge" ? "b"
      : labelType === "Pre-Chorus" ? "pre ch" : labelType === "Instrumental" ? "inst"
      : labelType === "Intro" ? "intro" : labelType === "Outro" ? "outro" : labelType === "Tag" ? "tag"
      : labelType.toLowerCase();
    const isPill = ["v","c","b"].includes(base);
    if (!sectionCounts[base]) sectionCounts[base] = 0;
    const startNum = sectionCounts[base] + 1;
    sectionCounts[base] += repeat; // advance by repeat so next section picks up correctly
    return isPill ? `${base}${startNum}` : base;
  };

  // Figure out active section index for highlight
  const activeSectionIndex = (() => {
    if (playbackDuration <= 0) return -1;
    const numSections = rows.filter(r => r.type === 'section').length;
    if (numSections === 0) return -1;
    if (sectionTimings.length >= numSections) {
      let active = 0;
      for (let i = 0; i < numSections; i++) {
        if (playbackPos >= sectionTimings[i]) active = i;
        else break;
      }
      return active;
    }
    const progress = playbackPos / playbackDuration;
    return Math.min(numSections - 1, Math.floor(progress * numSections));
  })();

  // Keep rows in a ref for the auto-scroll effect
  React.useEffect(() => { rowsRef.current = rows; });

  // Scroll to top whenever the song changes
  React.useEffect(() => {
    if (chartScrollRef.current) {
      chartScrollRef.current.scrollTop = 0;
    }
  }, [song.id]);

  // Auto-scroll: always scrolls when playing
  React.useEffect(() => {
    if (!playbackPlaying || playbackDuration <= 0) return;
    if (autoScrollPausedRef.current) return;
    const currentRows = rowsRef.current;
    const numSections = currentRows.filter(r => r.type === 'section').length;
    if (numSections === 0) return;
    let sectionIdx: number;
    if (sectionTimings.length >= numSections) {
      sectionIdx = 0;
      for (let i = 0; i < numSections; i++) {
        if (playbackPos >= sectionTimings[i]) sectionIdx = i;
        else break;
      }
    } else {
      const progress = playbackPos / playbackDuration;
      sectionIdx = Math.min(numSections - 1, Math.floor(progress * numSections));
    }
    let overallIdx = 0;
    let sectionCount = 0;
    for (let i = 0; i < currentRows.length; i++) {
      if (currentRows[i].type === 'section') {
        if (sectionCount === sectionIdx) { overallIdx = i; break; }
        sectionCount++;
      }
    }
    const rowEl = sectionRowRefs.current[overallIdx];
    const scrollEl = chartScrollRef.current;
    if (!rowEl || !scrollEl) return;
    const scrollTop = rowEl.offsetTop * zoom - 80;
    scrollEl.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
  }, [playbackPos, playbackPlaying, zoom, sectionTimings]);

  return (
    <div style={{ fontFamily: "Helvetica, sans-serif", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", paddingTop: isMobile ? "env(safe-area-inset-top)" : 0, paddingBottom: isMobile ? "calc(52px + env(safe-area-inset-bottom))" : 0 }}>
      {isMobile && <PreviewToolbar
        onBack={onBack}
        onHome={onHome}
        setlist={setlist}
        setlistIdx={setlistIdx}
        onSetlistNav={onSetlistNav}
        displayKey={effectiveDisplayKey}
        songBaseKey={songBaseKey}
        songIsMinor={songIsMinor}
        keyList={KEY_LIST}
        flatKeys={FLAT_KEYS}
        onKeyChange={k => { setDisplayKey(k); setUseFlats(FLAT_KEYS.has(k)); onDisplayKeyChange?.(k); }}
        isPlaying={playbackPlaying}
        hasSpotify={!!spotifyToken}
        hasTrack={!!song.spotify_track_id}
        onPlayPause={() => spotifyTogglePlay?.current?.()}
        playbackPos={playbackPos}
        playbackDuration={playbackDuration}
        onEdit={onEdit}
        onExportPDF={() => { void exportSongPDF(params); }}
        onBookmark={!isBookmarked && onBookmark ? () => onBookmark(song) : undefined}
        isBookmarked={!!isBookmarked}
        authUser={authUser}
        song={song}
      />}
      <AppBar onHome={onHome}
        backButton={
          <button
            onClick={onBack}
            style={{ ...APP_BAR_BTN, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor='#f1f5f9'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor='#ffffff'}
            title={setlist ? `Back to ${setlist.name}` : 'Back'}
          >{setlist ? `← ${setlist.name}` : '← Back'}</button>
        }
        centerContent={<>
        {setlist && onSetlistNav && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {(() => {
              const songEntries = setlist.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.songId !== '__element__');
              const currentSongPos = songEntries.findIndex(({ i }) => i === setlistIdx);
              const hasPrev = songEntries.some(({ i }) => i < (setlistIdx ?? 0));
              const hasNext = songEntries.some(({ i }) => i > (setlistIdx ?? 0));
              const displayPos = currentSongPos >= 0 ? currentSongPos + 1 : '?';
              const displayTotal = songEntries.length;
              return (<>
                <button
                  onClick={() => onSetlistNav(-1)}
                  disabled={!hasPrev}
                  style={{ padding: "6px 10px", fontSize: "14pt", lineHeight: 1, cursor: !hasPrev ? "default" : "pointer", backgroundColor: "white", border: "1px solid #ccc", borderRadius: 4, color: !hasPrev ? "#ccc" : "#1a1a1a", fontFamily: "Helvetica, sans-serif" }}
                >‹</button>
                <span style={{ fontSize: "9pt", color: "#555", fontFamily: "Helvetica, sans-serif", whiteSpace: "nowrap" }}>{displayPos}/{displayTotal}</span>
                <button
                  onClick={() => onSetlistNav(1)}
                  disabled={!hasNext}
                  style={{ padding: "6px 10px", fontSize: "14pt", lineHeight: 1, cursor: !hasNext ? "default" : "pointer", backgroundColor: "white", border: "1px solid #ccc", borderRadius: 4, color: !hasNext ? "#ccc" : "#1a1a1a", fontFamily: "Helvetica, sans-serif" }}
                >›</button>
              </>);
            })()}
          </div>
        )}
        {!isMobile && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 0, border: "1px solid #ccc", borderRadius: 4, overflow: "hidden" }}>
            {KEY_LIST.map(k => {
              const kLabel = songIsMinor ? (MINOR_KEY_LABELS[k] || k + 'm') : k;
              return (
              <button key={k} 
                onClick={() => { setDisplayKey(k); setUseFlats(FLAT_KEYS.has(k)); onDisplayKeyChange?.(k); }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  toggleFavoriteKey(k);
                }}
                title={k === songBaseKey ? "Original Key | Right-click to favorite" : k === favoriteKey ? "Your Favorite Key | Right-click to remove" : "Right-click to set as favorite"}
                style={{ padding: "5px 9px 7px", fontSize: songIsMinor ? "9pt" : "10pt", cursor: "pointer", border: "none", borderRight: "1px solid #ccc", backgroundColor: k === effectiveDisplayKey ? "#1a1a1a" : "white", color: k === effectiveDisplayKey ? "white" : "#333", fontFamily: "Helvetica, sans-serif", fontWeight: k === effectiveDisplayKey ? 700 : 400, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, lineHeight: 1 }}
              >
                <FlatLabel text={kLabel} invert={k === effectiveDisplayKey} />
                <div style={{ display: "flex", gap: 2, alignItems: "center", height: 3 }}>
                  {(k === songBaseKey || k === songBaseKeyAlt) && <span style={{ width: 3, height: 3, borderRadius: "50%", backgroundColor: k === effectiveDisplayKey ? "white" : "#1a1a1a", display: "block" }} />}
                  {k === favoriteKey && <span style={{ fontSize: "6pt", lineHeight: 1, color: k === effectiveDisplayKey ? "white" : "#1a1a1a" }}>★</span>}
                </div>
              </button>
            )})}
            </div>
            <button
              onClick={() => setUseFlats(f => !f)}
              title={useFlats ? "Currently showing flats — click for sharps" : "Currently showing sharps — click for flats"}
              style={{ padding: "5px 8px", fontSize: "10pt", cursor: "pointer", border: "1px solid #ccc", borderRadius: 4, backgroundColor: "white", color: "#333", fontFamily: "Helvetica, sans-serif", lineHeight: 1, whiteSpace: "nowrap" }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}
            >{useFlats ? '♭' : '♯'}</button>
          </div>
        )}
      </>}
      subRow={isMobile ? (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 0, border: "1px solid #ccc", borderRadius: 4, overflow: "hidden", flex: 1 }}>
          {KEY_LIST.map((k, i) => {
            let longPressTimer: NodeJS.Timeout | null = null;
            const kLabel = songIsMinor ? (MINOR_KEY_LABELS[k] || k + 'm') : k;
            return (
              <button key={k} 
                onClick={() => { setDisplayKey(k); setUseFlats(FLAT_KEYS.has(k)); onDisplayKeyChange?.(k); }}
                onTouchStart={(e) => {
                  longPressTimer = setTimeout(() => {
                    toggleFavoriteKey(k);
                    // Haptic feedback if available
                    if (navigator.vibrate) navigator.vibrate(50);
                  }, 500);
                }}
                onTouchEnd={() => {
                  if (longPressTimer) clearTimeout(longPressTimer);
                }}
                onTouchMove={() => {
                  if (longPressTimer) clearTimeout(longPressTimer);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  toggleFavoriteKey(k);
                }}
                title={k === songBaseKey ? "Original Key | Long press to favorite" : k === favoriteKey ? "Your Favorite Key | Long press to remove" : "Long press to set as favorite"}
                style={{ padding: "4px 4px 5px", fontSize: songIsMinor ? "7.5pt" : "9pt", cursor: "pointer", border: "none", borderRight: i < KEY_LIST.length - 1 ? "1px solid #ccc" : "none", backgroundColor: k === effectiveDisplayKey ? "#1a1a1a" : "white", color: k === effectiveDisplayKey ? "white" : "#333", fontFamily: "Helvetica, sans-serif", fontWeight: k === effectiveDisplayKey ? 700 : 400, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, lineHeight: 1, flex: 1 }}
              >
                <FlatLabel text={kLabel} invert={k === effectiveDisplayKey} />
                <div style={{ display: "flex", gap: 2, alignItems: "center", height: 3 }}>
                  {(k === songBaseKey || k === songBaseKeyAlt) && <span style={{ width: 3, height: 3, borderRadius: "50%", backgroundColor: k === effectiveDisplayKey ? "white" : "#1a1a1a", display: "block" }} />}
                  {k === favoriteKey && <span style={{ fontSize: "5pt", lineHeight: 1, color: k === effectiveDisplayKey ? "white" : "#1a1a1a" }}>★</span>}
                </div>
              </button>
            );
          })}
          </div>
          <button
            onClick={() => setUseFlats(f => !f)}
            title={useFlats ? "Currently showing flats — click for sharps" : "Currently showing sharps — click for flats"}
            style={{ padding: "4px 7px", fontSize: "10pt", cursor: "pointer", border: "1px solid #ccc", borderRadius: 4, backgroundColor: "white", color: "#333", fontFamily: "Helvetica, sans-serif", lineHeight: 1, flexShrink: 0 }}
          >{useFlats ? '♭' : '♯'}</button>
        </div>
      ) : undefined}
      >
        {/* Menu button - right side */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowMenu(!showMenu)}
            style={{ padding: "6px 12px", fontSize: "10pt", cursor: "pointer", backgroundColor: "white", border: "1px solid #ccc", borderRadius: 4, fontFamily: "Helvetica, sans-serif" }}
          >⋯</button>
            
            {/* Dropdown menu */}
            {showMenu && ReactDOM.createPortal(
              <>
                {/* Backdrop to close menu */}
                <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={() => setShowMenu(false)} />
                
                <div style={{ position: "fixed", top: "calc(56px + env(safe-area-inset-top))", right: 12, backgroundColor: "white", border: "1px solid #ccc", borderRadius: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", minWidth: 200, zIndex: 9999, maxHeight: "80vh", overflowY: "auto" }}>
                  {/* Edit */}
                  {authUser && (song.userId === authUser.id || (!song.userId && authUser.id === ADMIN_USER_ID)) && (
                    <button
                      onClick={() => { onEdit(); setShowMenu(false); }}
                      style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif", borderBottom: "1px solid #eee" }}
                    >Edit Song</button>
                  )}
                  {/* Set as Original Key */}
                  {authUser && onSave && effectiveDisplayKey !== songBaseKey && (song.userId === authUser.id || (!song.userId && authUser.id === ADMIN_USER_ID)) && (
                    <button
                      onClick={() => {
                        if (!window.confirm(`Set "${effectiveDisplayKey}" as the original key for "${song.title}"?\n\nAll chord content will be retransposed from ${songBaseKey} → ${effectiveDisplayKey} and saved.`)) return;
                        // Retranspose every chord line in song.input from songBaseKey → effectiveDisplayKey
                        const rawLines = song.input.split('\n');
                        const newLines = rawLines.map(line => {
                          // Preserve section markers and empty lines
                          if (line.startsWith('"') || !line.trim()) return line;
                          const cleaned = line.replace(/\u00A0/g, ' ');
                          if (!isChordLine(cleaned.replace(/^[."(]/, ''))) return line;
                          return transposeChordLine(cleaned, songBaseKey, effectiveDisplayKey, 'letters');
                        });
                        const updatedSong: SavedSong = {
                          ...song,
                          key: effectiveDisplayKey + (songIsMinor ? 'm' : ''),
                          input: newLines.join('\n'),
                          savedAt: Date.now(),
                        };
                        onSave(updatedSong);
                        setDisplayKey(effectiveDisplayKey);
                        setShowMenu(false);
                      }}
                      style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif", borderBottom: "1px solid #eee", color: "#1a1a1a" }}
                    >
                      Set {effectiveDisplayKey} as Original Key
                    </button>
                  )}

                  {/* Duplicate */}
                  {authUser && onDuplicate && (
                    <button
                      onClick={() => {
                        const copy: SavedSong = {
                          ...song,
                          id: Date.now().toString(),
                          title: song.title + ' (Copy)',
                          userId: authUser.id,
                          savedAt: Date.now(),
                        };
                        onDuplicate(copy);
                        setShowMenu(false);
                      }}
                      style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif", borderBottom: "1px solid #eee" }}
                    >
                      Duplicate Song
                    </button>
                  )}
                  
                  {/* Add New Version */}
                  {authUser && onAddVersion && (
                    <button
                      onClick={() => {
                        const parentId = song.parentSongId || song.id;
                        onAddVersion(parentId);
                        setShowMenu(false);
                      }}
                      style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif", borderBottom: "1px solid #eee" }}
                    >
                      + Add New Version
                    </button>
                  )}

                  {/* Set as Preferred Version */}
                  {authUser && allSongs && onSetPreferredVersion && (() => {
                    const canonicalId = song.parentSongId || song.id;
                    const siblings = allSongs.filter(s => s.id === canonicalId || s.parentSongId === canonicalId);
                    if (siblings.length <= 1) return null;
                    const parent = allSongs.find(s => s.id === canonicalId);
                    const isAlreadyPreferred = parent?.preferredVersionId === song.id || (!parent?.preferredVersionId && !song.parentSongId);
                    if (isAlreadyPreferred) return null;
                    return (
                      <button
                        onClick={() => { onSetPreferredVersion(canonicalId, song.id); setShowMenu(false); }}
                        style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif", borderBottom: "1px solid #eee" }}
                      >
                        ★ Set as Preferred Version
                      </button>
                    );
                  })()}

                  {/* Save/Saved */}
                  {authUser && onBookmark && (
                    <button
                      onClick={() => { if (!isBookmarked) onBookmark(song); setShowMenu(false); }}
                      disabled={isBookmarked}
                      style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: isBookmarked ? "default" : "pointer", fontFamily: "Helvetica, sans-serif", color: isBookmarked ? "#22c55e" : "#1a1a1a", borderBottom: "1px solid #eee" }}
                    >
                      {isBookmarked ? "✓ Saved to My Archive" : "+ Save to My Archive"}
                    </button>
                  )}
                  
                  {/* ProPresenter Copy */}
                  <button
                    onClick={() => { setPpMode(true); setShowMenu(false); }}
                    style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif", borderBottom: "1px solid #eee" }}
                  >
                    ProPresenter Copy…
                  </button>

                  {/* PDF export */}
                  <button
                    onClick={() => { void exportSongPDF(params); setShowMenu(false); }}
                    style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif", borderBottom: "1px solid #eee" }}
                  >
                    Export PDF
                  </button>
                  
                  {/* Copy to Public (admin only) */}
                  {authUser?.id === ADMIN_USER_ID && song.userId && onCopyToPublic && (
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        if (!window.confirm(`Copy "${song.title}" to the Public Archive?\n\nThis will make it visible to all users.`)) return;
                        const publicCopy: SavedSong = {
                          ...song,
                          id: Date.now().toString(),
                          userId: null,
                          savedAt: Date.now(),
                        };
                        onCopyToPublic(publicCopy);
                      }}
                      style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif", borderBottom: "1px solid #eee" }}
                    >
                      Copy to Public Archive
                    </button>
                  )}
                  
                  {/* Setlist navigation */}
                  {setlist && onSetlistNav && (
                    <div style={{ padding: "10px 16px", borderBottom: "1px solid #eee" }}>
                      <div style={{ fontSize: "9pt", color: "#666", marginBottom: 6, fontFamily: "Helvetica, sans-serif" }}>Plan</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {(() => {
                          const songEntries = setlist.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.songId !== '__element__');
                          const currentSongPos = songEntries.findIndex(({ i }) => i === setlistIdx);
                          const hasPrev = songEntries.some(({ i }) => i < (setlistIdx ?? 0));
                          const hasNext = songEntries.some(({ i }) => i > (setlistIdx ?? 0));
                          const displayPos = currentSongPos >= 0 ? currentSongPos + 1 : '?';
                          const displayTotal = songEntries.length;
                          return (<>
                            <button
                              onClick={() => { onSetlistNav(-1); setShowMenu(false); }}
                              disabled={!hasPrev}
                              style={{ flex: 1, padding: "6px", fontSize: "10pt", border: "1px solid #ccc", borderRadius: 4, backgroundColor: "white", cursor: !hasPrev ? "default" : "pointer", color: !hasPrev ? "#ccc" : "#1a1a1a", fontFamily: "Helvetica, sans-serif" }}
                            >‹ Prev</button>
                            <span style={{ fontSize: "9pt", color: "#555", fontFamily: "Helvetica, sans-serif", whiteSpace: "nowrap" }}>{displayPos}/{displayTotal}</span>
                            <button
                              onClick={() => { onSetlistNav(1); setShowMenu(false); }}
                              disabled={!hasNext}
                              style={{ flex: 1, padding: "6px", fontSize: "10pt", border: "1px solid #ccc", borderRadius: 4, backgroundColor: "white", cursor: !hasNext ? "default" : "pointer", color: !hasNext ? "#ccc" : "#1a1a1a", fontFamily: "Helvetica, sans-serif" }}
                            >Next ›</button>
                          </>);
                        })()}
                      </div>
                    </div>
                  )}
                  
                  {/* Mobile zoom controls */}
                  {window.innerWidth < 768 && (
                    <div style={{ padding: "10px 16px", borderBottom: "1px solid #eee" }}>
                      <div style={{ fontSize: "9pt", color: "#666", marginBottom: 6, fontFamily: "Helvetica, sans-serif" }}>Zoom</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button 
                          onClick={() => { setZoom(z => Math.max(0.25, Math.round((z - 0.1) * 10) / 10)); }}
                          style={{ flex: 1, padding: "6px", fontSize: "14pt", border: "1px solid #ccc", borderRadius: 4, backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif" }}
                        >
                          −
                        </button>
                        <button 
                          onClick={() => { setZoom(z => Math.min(1.0, Math.round((z + 0.1) * 10) / 10)); }}
                          style={{ flex: 1, padding: "6px", fontSize: "14pt", border: "1px solid #ccc", borderRadius: 4, backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif" }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* Capo toggle */}
                  {settings && onSettingsChange && (
                    <button
                      onClick={() => {
                        onSettingsChange({ ...settings, showCapoSuggestions: !settings.showCapoSuggestions });
                      }}
                      style={{ width: "100%", padding: "10px 16px", fontSize: "10pt", textAlign: "left", border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: "Helvetica, sans-serif", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                    >
                      <span>Show Capo Suggestions</span>
                      {/* Pill toggle switch */}
                      <div style={{ 
                        width: 40, 
                        height: 22, 
                        borderRadius: 11, 
                        backgroundColor: settings.showCapoSuggestions ? "#22c55e" : "#ccc", 
                        position: "relative",
                        transition: "background-color 0.2s"
                      }}>
                        <div style={{ 
                          width: 18, 
                          height: 18, 
                          borderRadius: "50%", 
                          backgroundColor: "white", 
                          position: "absolute",
                          top: 2,
                          left: settings.showCapoSuggestions ? 20 : 2,
                          transition: "left 0.2s",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
                        }} />
                      </div>
                    </button>
                  )}
                </div>
              </>,
              document.body
            )}
          </div>
        </AppBar>
        {/* Capo suggestion */}
        {settings?.showCapoSuggestions && effectiveDisplayKey !== songBaseKey && (() => {
          const capoSuggestion = getCapoSuggestion(songBaseKey, effectiveDisplayKey);
          return capoSuggestion ? (
            <div style={{ textAlign: "center", fontSize: "9pt", color: "#666", fontFamily: "Helvetica, sans-serif", fontStyle: "italic", backgroundColor: "#fafafa", padding: "4px 8px", borderBottom: "1px solid #eee" }}>
              Capo {capoSuggestion.capo}
            </div>
          ) : null;
        })()}

      {/* Chart */}
      <div
        ref={chartScrollRef}
        style={{ overflowX: "hidden", overflowY: "auto", flex: 1, minHeight: 0, WebkitOverflowScrolling: 'touch' } as any}
        onTouchStart={e => {
          if (!isMobile) return;
          autoScrollPausedRef.current = true;
          (e.currentTarget as any)._swipeStartX = e.touches[0].clientX;
          (e.currentTarget as any)._swipeStartY = e.touches[0].clientY;
        }}
        onTouchEnd={e => {
          if (!isMobile) return;
          setTimeout(() => { autoScrollPausedRef.current = false; }, 3000);
          const el = e.currentTarget as any;
          const dx = e.changedTouches[0].clientX - (el._swipeStartX ?? 0);
          const dy = e.changedTouches[0].clientY - (el._swipeStartY ?? 0);
          if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 60) {
            if (setlist && onSetlistNav) {
              if (dx < 0) onSetlistNav(1);
              else onSetlistNav(-1);
            }
            (e.nativeEvent as any)._swipeHandled = true;
          }
        }}
        onWheel={() => { autoScrollPausedRef.current = true; setTimeout(() => { autoScrollPausedRef.current = false; }, 3000); }}
        onMouseDown={() => { autoScrollPausedRef.current = true; setTimeout(() => { autoScrollPausedRef.current = false; }, 3000); }}
      >
        {/* Outer div collapses to the post-scale visual size so scroll matches content */}
        <div style={isMobile ? {
          width: "100%",
          height: tableHeight > 0 ? `${(tableHeight + 100) * zoom}px` : "auto",
          overflow: "hidden",
          position: "relative",
        } : { width: "100%", boxSizing: "border-box" as const }}>
          {/* Inner div is scaled from top-left — visually fits screen, scroll matches */}
          <div style={isMobile ? {
            transformOrigin: "top left",
            transform: `scale(${zoom})`,
            width: `${100 / zoom}%`,
            position: "absolute",
            top: 0,
            left: 0,
          } : {}}>
          <div style={{ display: "flex", justifyContent: "center", padding: isMobile ? "10px 0 40px" : "20px 20px 40px" }}>

        <table ref={tableRef} style={{ borderCollapse: "collapse", fontFamily: "Helvetica, sans-serif" }}>
          <tbody>
            {/* Header row — spans full table width so it aligns with content */}
            <tr>
              <td colSpan={2} style={{ padding: "0 4px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ color: "#888", fontSize: "9pt", fontStyle: "italic", whiteSpace: 'nowrap' }}>{song.bpm ? `${song.bpm} bpm  ` : ""}<FlatLabel text={`[${displayKeyLabel}${songIsMinor ? 'm' : ''}]`} light /></span>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: "17pt", fontWeight: 400, fontFamily: "Helvetica, sans-serif", padding: "0 16px" }}>{song.title}</span>
                    {/* Version dropdown — only shown when siblings exist */}
                    {(() => {
                      if (!allSongs) return null;
                      const canonicalId = song.parentSongId || song.id;
                      const siblings = allSongs.filter(s => s.id === canonicalId || s.parentSongId === canonicalId);
                      if (siblings.length <= 1) return null;
                      return (
                        <select
                          value={song.id}
                          onChange={e => {
                            const target = allSongs.find(s => s.id === e.target.value);
                            if (target && onSwitchVersion) onSwitchVersion(target);
                          }}
                          style={{ fontSize: "9pt", border: "1px solid #ddd", borderRadius: 4, padding: "2px 6px", fontFamily: "Helvetica, sans-serif", color: "#555", background: "white", cursor: "pointer" }}
                        >
                          {siblings.map(s => {
                            const isParent = !s.parentSongId;
                            const label = s.artistName || (isParent ? "Original" : "Unknown Artist");
                            const isPreferred = (() => {
                              const parent = allSongs.find(p => p.id === canonicalId);
                              return parent?.preferredVersionId === s.id || (!parent?.preferredVersionId && isParent);
                            })();
                            return <option key={s.id} value={s.id}>{label}{isPreferred ? " ★" : ""}</option>;
                          })}
                        </select>
                      );
                    })()}
                  </div>
                  <span style={{ color: "#888", fontSize: "9pt", fontStyle: "italic" }}>{song.writers}</span>
                </div>
              </td>
            </tr>
            {rows.map((row, rowIdx) => {
              const rowBg = rowIdx % 2 === 0 ? "#ffffff" : "#f3f3f3";

              if (row.type === "blank") {
                const color = sectionColors[row.label] || "#6b7280";
                const firstLabel = getLabelText(row.label, row.repeat);
                const labelTexts: string[] = Array.from({ length: row.repeat }).map((_, r) => {
                  const isPill = /^[vcb]\d+$/.test(firstLabel);
                  return isPill
                    ? `${firstLabel.replace(/\d+$/, '')}${parseInt(firstLabel.match(/\d+$/)?.[0] || "1") + r}`
                    : firstLabel;
                });
                // Per-blank ghost source takes priority over label-based
                const blankPinnedSectionIdx = row.id ? ghostSourceByBlank[row.id] : undefined;
                const ghostLines = (blankPinnedSectionIdx !== undefined && linesBySection[blankPinnedSectionIdx])
                  ? linesBySection[blankPinnedSectionIdx]
                  : lastLinesByLabel[row.label] || lastLinesAny;
                return (
                  <tr key={`blank-${rowIdx}`} style={{ backgroundColor: rowBg }}>
                    <td style={{ width: 64, padding: "6px 8px", verticalAlign: "top" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {labelTexts.map((lt, i) => {
                          const isPill = /^[vcb]\d+$/.test(lt);
                          return isPill ? (
                            <span key={i} style={{ display: "inline-block", border: `1.5px solid ${color}`, borderRadius: 1, padding: "2px 6px", fontSize: "10pt", fontWeight: 700, color, width: "fit-content" }}>{lt}</span>
                          ) : (
                            <span key={i} style={{ fontSize: "10pt", fontWeight: 700, color: "#666" }}>{lt}{row.repeat > 1 && i === 0 ? <span style={{ display: "block", fontSize: "7pt" }}>x{row.repeat}</span> : null}</span>
                          );
                        })}
                      </div>
                    </td>
                    <td style={{ padding: "6px 6px", verticalAlign: "top", backgroundColor: rowBg }}>
                      {showGhost && ghostLines.length > 0 ? (
                        <div style={{ opacity: 0.75 }}>
                          {ghostLines.map((line, lIdx) => {
                            const normalized = line.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '').replace(/^"/, '').trimEnd();
                            if (!normalized) return <div key={lIdx} style={{ height: "1em" }} />;
                            const isChord = isChordLine(normalized);
                            let displayed: string;
                            if (effectiveDisplayKey !== songBaseKey && isChord) {
                              displayed = applyAccidentalPrefToLine(transposeChordLine(normalized, songBaseKey, effectiveDisplayKey, params.inputType)).replace(/ /g, "\u00A0");
                            } else {
                              displayed = normalized.split(/(\s+)/).map(t =>
                                /^\s+$/.test(t) ? t : (isChord ? applyAccidentalPref(convertChord(t, songBaseKey, effectiveDisplayKey, params.inputType === "letters")) : t)
                              ).join("").replace(/ /g, "\u00A0");
                            }
                            return isChord && displayed.includes('[3]') ? (
                              <ChordLineWithTriplets key={lIdx} text={displayed} fontSize={13} />
                            ) : (
                              <pre key={lIdx} style={{
                                margin: 0, padding: 0, lineHeight: 1.3,
                                fontFamily: "Helvetica, sans-serif",
                                fontSize: isChord ? "13pt" : "16pt",
                                fontWeight: isChord ? 700 : 400,
                                backgroundColor: "transparent",
                              }}>{isChord ? renderChordLine(displayed) : displayed}</pre>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ height: "1em" }} />
                      )}
                    </td>
                  </tr>
                );
              }

              const { lines, label, repeat } = row;
              const color = sectionColors[label] || "#6b7280";
              const labelText = getLabelText(label, repeat);
              const isPill = /^[vcb]\d+$/.test(labelText);
              // Determine if this is the "active" section
              const thisSectionIndex = rows.slice(0, rowIdx).filter(r => r.type === 'section').length;
              const isActiveSection = activeSectionIndex === thisSectionIndex && playbackDuration > 0;

              // Gray out non-source sections when a ghost source is pinned for this label
              const sectionHasContent = !lines.every(l => !l.replace(/[\u00A0\uFFFC\u200B\u200C\u200D\uFEFF]/g, '').trim());
              const pinnedSource = ghostSourceByLabel[label];
              // Check if this section is pinned as source for ANY blank with matching label
              const isPinnedForAnyBlank = Object.entries(ghostSourceByBlank).some(([blankId, srcIdx]) => {
                const blank = params.blankSections?.find((b: any) => b.id === blankId);
                return blank && blank.label === label && srcIdx === row.sectionIdx;
              });
              const isNonSource = sectionHasContent && (nonEmptyCountByLabelPreview[label] || 0) > 1 &&
                !isPinnedForAnyBlank &&
                (pinnedSource !== undefined ? pinnedSource !== row.sectionIdx : false);
              const pillColor = isNonSource ? '#9ca3af' : color;

              return (
                <tr
                  key={`section-${row.sectionIdx}`}
                  ref={el => { sectionRowRefs.current[rowIdx] = el; }}
                  style={{ backgroundColor: isActiveSection ? `${color}12` : rowBg, transition: 'background-color 0.4s ease', outline: isActiveSection ? `2px solid ${color}44` : 'none' }}
                >
                  <td
                    style={{ width: 64, padding: "8px 8px", verticalAlign: "top", cursor: (spotifyToken && song.spotify_track_id && playbackDuration > 0) ? 'pointer' : 'default' }}
                    title={(spotifyToken && song.spotify_track_id && playbackDuration > 0) ? `Jump to this section` : undefined}
                    onClick={() => {
                      if (!spotifyToken || !song.spotify_track_id || playbackDuration <= 0) return;
                      const allSectionRows = rows.filter(r => r.type === 'section');
                      const thisSectionIdx = allSectionRows.indexOf(row as any);
                      // Use saved timing if available, otherwise fall back to even spacing
                      const seekMs = sectionTimings.length > thisSectionIdx && sectionTimings[thisSectionIdx] != null
                        ? sectionTimings[thisSectionIdx]
                        : Math.floor((thisSectionIdx / allSectionRows.length) * playbackDuration);
                      if (spotifyPlayer?.current) {
                        spotifyPlayer.current.seek(seekMs);
                        setPlaybackPos(seekMs);
                      }
                      // Scroll chart to this row
                      const rowEl = sectionRowRefs.current[rowIdx];
                      const scrollEl = chartScrollRef.current;
                      if (rowEl && scrollEl) {
                        scrollEl.scrollTo({ top: Math.max(0, rowEl.offsetTop * zoom - 80), behavior: 'smooth' });
                      }
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {Array.from({ length: repeat }).map((_, r) => {
                        const stackText = isPill
                          ? `${labelText.replace(/\d+$/, '')}${parseInt(labelText.match(/\d+$/)?.[0] || "1") + r}`
                          : (r === 0 ? labelText : null);
                        if (stackText === null) return null;
                        return isPill ? (
                          <span key={r} style={{ display: "inline-block", border: `1.5px solid ${pillColor}`, borderRadius: 1, padding: "2px 6px", fontSize: "10pt", fontWeight: 700, color: pillColor, width: "fit-content" }}>{stackText}</span>
                        ) : (
                          <span key={r} style={{ fontSize: "10pt", fontWeight: 700, color: "#666" }}>
                            {labelText}{repeat > 1 && <span style={{ display: "block", fontSize: "7pt" }}>x{repeat}</span>}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td style={{ padding: "8px 6px", verticalAlign: "top", backgroundColor: isNonSource ? '#f3f4f6' : rowBg }}>
                    {lines.every(l => !l.replace(/[\u00A0\uFFFC\u200B\u200C\u200D\uFEFF]/g, '').trim()) ? (
                      // Empty section — show ghost content from pinned source or last seen section
                      showGhost ? (
                        <div style={{ opacity: 0.75 }}>
                          {(() => {
                            const pinnedEmpty = ghostSourceByBlank['empty_' + row.sectionIdx];
                            return (pinnedEmpty !== undefined && linesBySection[pinnedEmpty])
                              ? linesBySection[pinnedEmpty]
                              : lastLinesByLabel[label] || lastLinesAny;
                          })().map((line, lIdx) => {
                          const normalized = line.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '').replace(/^"/, '').trimEnd();
                          if (!normalized) return <div key={lIdx} style={{ height: "1em" }} />;
                          const isChord = isChordLine(normalized);
                          let displayed: string;
                          if (effectiveDisplayKey !== songBaseKey && isChord) {
                            displayed = applyAccidentalPrefToLine(transposeChordLine(normalized, songBaseKey, effectiveDisplayKey, params.inputType)).replace(/ /g, '\u00A0');
                          } else {
                            displayed = normalized.split(/(\s+)/).map(t =>
                              /^\s+$/.test(t) ? t : (isChord ? applyAccidentalPref(convertChord(t, songBaseKey, effectiveDisplayKey, params.inputType === "letters")) : t)
                            ).join("").replace(/ /g, '\u00A0');
                          }
                          return isChord && displayed.includes('[3]') ? (
                            <ChordLineWithTriplets key={lIdx} text={displayed} fontSize={13} />
                          ) : (
                            <pre key={lIdx} style={{
                              margin: 0, padding: 0, lineHeight: 1.3,
                              fontFamily: "Helvetica, sans-serif",
                              fontSize: isChord ? "13pt" : "16pt",
                              fontWeight: isChord ? 700 : 400,
                              backgroundColor: "transparent",
                            }}>{isChord ? renderChordLine(displayed) : displayed}</pre>
                          );
                        })}
                      </div>
                      ) : null
                    ) : (
                      <>{lines.map((line, lIdx) => {
                      const lineOffset = params.displaySections[row.sectionIdx]?.lineOffset ?? 0;
                      const overrideKey = `${params.displaySections[row.sectionIdx]?.baseSectionIdx ?? row.sectionIdx}-${lineOffset + lIdx}`;
                      const rawLine = params.lineOverrides[overrideKey] || line;
                      const finalLine = rawLine.replace(/^"/, '');
                      const trimmed = finalLine.replace(/\u00A0/g, ' ').replace(/^"/, '').trimEnd();
                      // Skip standalone quote marker lines (new format) or inline-header lines (old format)
                      if (line.startsWith('"') && finalLine.trim() === '') return null;
                      if (!trimmed) return <div key={lIdx} style={{ height: "1em" }} />;
                      const isChord = isChordLine(trimmed);
                      let displayed: string;
                      if (effectiveDisplayKey !== songBaseKey && isChord) {
                        displayed = applyAccidentalPrefToLine(transposeChordLine(trimmed, songBaseKey, effectiveDisplayKey, params.inputType)).replace(/ /g, '\u00A0');
                      } else {
                        const tokens = trimmed.split(/(\s+)/);
                        displayed = tokens.map(t => {
                          if (/^\s+$/.test(t)) return t;
                          const converted = isChord ? applyAccidentalPref(convertChord(t, songBaseKey, effectiveDisplayKey, params.inputType === "letters")) : t;
                          return converted;
                        }).join("").replace(/ /g, "\u00A0");
                      }
                      return isChord && displayed.includes('[3]') ? (
                          <ChordLineWithTriplets key={lIdx} text={displayed} fontSize={13} color={isNonSource ? '#9ca3af' : undefined} />
                        ) : (
                        <pre key={lIdx} style={{
                          margin: 0, padding: 0, lineHeight: 1.3,
                          fontFamily: "Helvetica, sans-serif",
                          fontSize: isChord ? "13pt" : "16pt",
                          fontWeight: isChord ? 700 : 400,
                          backgroundColor: "transparent",
                          color: isNonSource ? '#9ca3af' : undefined,
                        }}>{isChord ? renderChordLine(displayed) : displayed}</pre>
                        );
                    })}</>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
          </div>
          </div>{/* end scale inner */}
        </div>{/* end scale outer */}
      </div>
      {/* Spotify Player */}
      {spotifyToken && song.spotify_track_id && (
        <div ref={spotifyBarRef} style={{ borderTop: '1px solid #e2e8f0', backgroundColor: 'white', flexShrink: 0 }}>
          {/* SpotifyPlayer — hidden on mobile (playback state shared via onPlaybackState) */}
          <div style={{ display: isMobile ? 'none' : 'block', padding: '4px 12px 8px' }}>
            <SpotifyPlayer
              trackId={song.spotify_track_id}
              spotifyToken={spotifyToken}
              globalPlayer={spotifyPlayer || { current: null }}
              globalDeviceId={spotifyDeviceId || { current: null }}
              globalReady={spotifyReady || { current: false }}
              onTogglePlayRef={spotifyTogglePlay}
              onPlaybackState={({ position, duration, isPlaying }) => {
                setPlaybackPos(position);
                setPlaybackDuration(duration);
                setPlaybackPlaying(isPlaying);
              }}
              onTrackEnd={() => {
                if (onSetlistNav && setlist && setlistIdx !== undefined && setlistIdx < setlist.entries.length - 1) {
                  // Look up the next song's Spotify track ID and start it directly
                  const nextEntry = setlist.entries[setlistIdx + 1];
                  const nextSong = allSongs?.find(s => s.id === nextEntry?.songId);
                  const nextTrackId = nextSong?.spotify_track_id;
                  if (nextTrackId && spotifyToken) {
                    // Use device_id if available (web), otherwise let Spotify use active device (iOS)
                    const deviceId = spotifyDeviceId?.current;
                    const url = deviceId
                      ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`
                      : `https://api.spotify.com/v1/me/player/play`;
                    fetch(url, {
                      method: 'PUT',
                      headers: { Authorization: `Bearer ${spotifyToken}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ uris: [`spotify:track:${nextTrackId}`] }),
                    }).catch(console.error);
                  }
                  onSetlistNav(1);
                }
              }}              sectionMarkers={(() => {
                const sectionRowsList = rows.filter(r => r.type === 'section');
                return sectionRowsList.map((_, i) => {
                  const sr = sectionRowsList[i] as any;
                  const color = sectionColors[sr.label] || '#6b7280';
                  const pct = sectionTimings.length > i && playbackDuration > 0
                    ? sectionTimings[i] / playbackDuration
                    : i / sectionRowsList.length;
                  return { pct, color };
                }).filter(m => m.pct > 0);
              })()}
              editingMarkers={editingMarkers}
              onEditMarkersToggle={() => setEditingMarkers(e => !e)}
              onMarkerDrag={(markerIdx, newPct) => {
                const actualIdx = markerIdx + 1;
                const newMs = Math.round(newPct * playbackDuration);
                setSectionTimings(prev => {
                  const sectionCount = rows.filter(r => r.type === 'section').length;
                  const base = prev.length >= sectionCount
                    ? [...prev]
                    : Array.from({ length: sectionCount }, (_, i) =>
                        prev[i] ?? Math.round((i / sectionCount) * playbackDuration)
                      );
                  base[actualIdx] = newMs;
                  for (let i = 1; i < base.length; i++) {
                    if (base[i] <= base[i-1]) base[i] = base[i-1] + 1000;
                  }
                  return base;
                });
              }}
            />
          </div>

        </div>
      )}
      {spotifyToken && !song.spotify_track_id && (
        <div ref={spotifyBarRef} style={{ padding: '6px 16px', borderTop: '1px solid #e2e8f0', backgroundColor: '#fafafa', flexShrink: 0, fontSize: '9pt', color: '#999', textAlign: 'center', fontFamily: 'Helvetica, sans-serif' }}>
          No Spotify track linked — add one in the editor
        </div>
      )}

      {/* ── ProPresenter Copy Modal ────────────────────────────────────────── */}
      {ppMode && ReactDOM.createPortal(
        (() => {
          const ppLyricSize = Math.round(ppChordSize * 16 / 13);

          // Build a copy function that writes rich HTML to clipboard
          const copySection = async (sectionLines: string[], idx: number) => {
            // Transpose + normalize lines exactly as main view does
            const htmlLines = sectionLines.map(rawLine => {
              const normalized = rawLine.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '').replace(/^"/, '').trimEnd();
              if (!normalized) return '<div style="line-height:1.3;font-family:Helvetica,sans-serif;">&nbsp;</div>';
              const isChord = isChordLine(normalized);
              let displayed = normalized;
              if (effectiveDisplayKey !== songBaseKey && isChord) {
                displayed = applyAccidentalPrefToLine(transposeChordLine(normalized, songBaseKey, effectiveDisplayKey, params.inputType));
              } else if (isChord) {
                displayed = displayed.split(/(\s+)/).map(t =>
                  /^\s+$/.test(t) ? t : applyAccidentalPref(convertChord(t, songBaseKey, effectiveDisplayKey, params.inputType === 'letters'))
                ).join('');
              }
              // Replace spaces with non-breaking spaces so ProPresenter preserves alignment
              const htmlContent = displayed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
              const size = isChord ? ppChordSize : ppLyricSize;
              const weight = isChord ? 700 : 400;
              return `<div style="font-size:${size}pt;font-weight:${weight};font-family:Helvetica,sans-serif;line-height:1.3;white-space:pre;">${htmlContent}</div>`;
            });
            const html = htmlLines.join('');
            const plainLines = sectionLines.map(l => l.replace(/^"/, '').trimEnd()).join('\n');
            try {
              const item = new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([plainLines], { type: 'text/plain' }),
              });
              await navigator.clipboard.write([item]);
            } catch {
              await navigator.clipboard.writeText(plainLines);
            }
            setPpCopiedIdx(idx);
            setTimeout(() => setPpCopiedIdx(c => c === idx ? null : c), 1800);
          };

          // Reset section counts so labels start from v1/c1/b1 (not continuing from main render)
          Object.keys(sectionCounts).forEach(k => { sectionCounts[k] = 0; });

          // Collect sections to display (non-blank, with content)
          const ppSections: { label: string; lines: string[] }[] = rows
            .filter(r => r.type === 'section')
            .map((r: any) => ({ label: getLabelText(r.label, r.repeat), lines: r.lines as string[] }));

          // ── Split helpers ───────────────────────────────────────────────────
          // Fail-safe: never let a split land inside a word/chord token. Given a
          // raw line and a candidate char position, snap to the nearest position
          // that sits at whitespace (or the start/end of the line) so a click
          // that's slightly off never chops a chord or lyric word in half.
          const snapToWordBoundary = (line: string, pos: number): number => {
            const len = line.length;
            const p = Math.max(0, Math.min(pos, len));
            const isBoundary = (i: number) =>
              i <= 0 || i >= len || /\s/.test(line[i - 1]) || /\s/.test(line[i]);
            if (isBoundary(p)) return p;
            let left = p, right = p;
            while (left > 0 && !isBoundary(left)) left--;
            while (right < len && !isBoundary(right)) right++;
            return (p - left) <= (right - p) ? left : right;
          };

          // Perform the split of a line (and its chord/lyric partner) at charPos.
          const handleSplit = (secIdx: number) => {
            if (!ppSplitCursor || ppSplitCursor.secIdx !== secIdx) return;
            const { lineIdx, charPos, clientX } = ppSplitCursor;
            const lines = [...(ppSectionLines[secIdx] ?? ppSections[secIdx]?.lines ?? [])];
            const rawLine = lines[lineIdx] ?? '';
            const normalized = rawLine.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '');
            const lineIsChord = isChordLine(normalized);

            const rawCp = Math.max(0, Math.min(charPos, rawLine.length));
            const cp = snapToWordBoundary(rawLine, rawCp);
            const before = rawLine.slice(0, cp);
            const after = rawLine.slice(cp);

            const newLines = [...lines];
            const prevLine = lineIdx > 0 ? lines[lineIdx - 1] : null;
            const nextLine = lineIdx + 1 < lines.length ? lines[lineIdx + 1] : null;
            const prevIsChord = prevLine !== null && isChordLine(prevLine.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, ''));
            const nextIsChord = nextLine !== null && isChordLine(nextLine.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, ''));

            // Helper: ask the browser for the caret offset in a partner line element at
            // the same horizontal pixel (clientX) the user clicked on.  This correctly
            // accounts for the different font sizes between chord and lyric lines.
            const partnerCharPos = (partnerLineIdx: number, fallback: number): number => {
              const partnerLine = lines[partnerLineIdx] ?? '';
              const el = document.querySelector(`[data-pp-line="${secIdx}-${partnerLineIdx}"]`);
              if (!el) return snapToWordBoundary(partnerLine, fallback);
              const rect = el.getBoundingClientRect();
              const midY = rect.top + rect.height / 2;
              const doc = document as any;
              if (doc.caretRangeFromPoint) {
                const range = doc.caretRangeFromPoint(clientX, midY);
                if (range) return snapToWordBoundary(partnerLine, Math.max(0, Math.min(range.startOffset, partnerLine.length)));
              } else if (doc.caretPositionFromPoint) {
                const pos = doc.caretPositionFromPoint(clientX, midY);
                if (pos) return snapToWordBoundary(partnerLine, Math.max(0, Math.min(pos.offset, partnerLine.length)));
              }
              return snapToWordBoundary(partnerLine, fallback);
            };

            if (!lineIsChord && prevIsChord) {
              // Lyric line with a chord line directly above → split both together
              const chordLine = lines[lineIdx - 1];
              const cp2 = partnerCharPos(lineIdx - 1, Math.min(cp, chordLine.length));
              newLines.splice(lineIdx - 1, 2,
                chordLine.slice(0, cp2), before,
                chordLine.slice(cp2), after,
              );
            } else if (lineIsChord && nextLine !== null && !nextIsChord) {
              // Chord line with a lyric line directly below → split both together
              const lyricLine = lines[lineIdx + 1];
              const cp2 = partnerCharPos(lineIdx + 1, Math.min(cp, lyricLine.length));
              newLines.splice(lineIdx, 2,
                before, lyricLine.slice(0, cp2),
                after, lyricLine.slice(cp2),
              );
            } else {
              // No partner — split this line alone
              newLines.splice(lineIdx, 1, before, after);
            }

            setPpSectionLines(prev => ({ ...prev, [secIdx]: newLines }));
            setPpSplitCursor(null);
          };

          // Click handler: use caretRangeFromPoint for pixel-accurate char position.
          // We walk all text nodes inside the <pre> to get a global offset from the
          // line start — this stays correct even when the line is already split into
          // before/cursor-bar/after spans from a previous click.
          const getGlobalOffset = (container: Node, offset: number, root: Element): number => {
            let total = 0;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (node === container) { total += offset; break; }
              total += node.textContent?.length ?? 0;
            }
            return total;
          };

          const handleLineClick = (e: React.MouseEvent, secIdx: number, lineIdx: number) => {
            let charPos = 0;
            const doc = document as any;
            const preEl = e.currentTarget as Element;
            if (doc.caretRangeFromPoint) {
              const range = doc.caretRangeFromPoint(e.clientX, e.clientY);
              if (range) charPos = getGlobalOffset(range.startContainer, range.startOffset, preEl);
            } else if (doc.caretPositionFromPoint) {
              const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
              if (pos) charPos = getGlobalOffset(pos.offsetNode, pos.offset, preEl);
            }
            setPpSplitCursor({ secIdx, lineIdx, charPos, clientX: e.clientX });
          };

          // ── ProPresenter .pro file export ──────────────────────────────────────
          // Binary protobuf primitives
          const pbVarint = (n: number): Uint8Array => {
            const b: number[] = [];
            while (n > 0x7F) { b.push((n & 0x7F) | 0x80); n >>>= 7; }
            b.push(n & 0x7F);
            return new Uint8Array(b);
          };
          const pbCat = (...arrays: Uint8Array[]): Uint8Array => {
            const total = arrays.reduce((s, a) => s + a.length, 0);
            const r = new Uint8Array(total); let off = 0;
            for (const a of arrays) { r.set(a, off); off += a.length; }
            return r;
          };
          // length-delimited field
          const pbLD = (fn: number, b: Uint8Array): Uint8Array =>
            pbCat(pbVarint((fn << 3) | 2), pbVarint(b.length), b);
          // varint field
          const pbVI = (fn: number, v: number): Uint8Array =>
            pbCat(pbVarint((fn << 3) | 0), pbVarint(v));
          // 64-bit (wire type 1) field — used for IEEE 754 doubles in the protobuf
          const pbW1 = (fn: number, b: Uint8Array): Uint8Array =>
            pbCat(pbVarint((fn << 3) | 1), b);
          // hex literal → Uint8Array
          const pbHex = (h: string) =>
            new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));
          const pbEnc = new TextEncoder();
          const pbStr = (fn: number, s: string): Uint8Array => pbLD(fn, pbEnc.encode(s));
          // ProPresenter UUID wrapper: F{fn} → LD containing F1 → LD containing UUID string
          const pbUUID = (fn: number, uuid: string): Uint8Array =>
            pbLD(fn, pbLD(1, pbEnc.encode(uuid)));
          const pbNewUUID = (): string =>
            'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
              const r = Math.random() * 16 | 0;
              return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16).toUpperCase();
            });

          // Boilerplate bytes extracted verbatim from the reference .pro file.
          // These encode visual properties (shadow, kerning, bounds, font metrics)
          // that are constant across all slides.
          const BP = {
            richF3:  pbHex('0a1209d8754037e6a15040118428fe2247cf6f4012120944f11739c3eb9b4011beeb806e5cd88140'),
            richF5:  pbHex('0000000000f03f'),   // wire-type-1 double = 1.0
            richF8:  pbHex('080112060a0012001a0012210a0909000000000000f03f120909000000000000f03f1a0909000000000000f03f123c0a1209000000000000f03f11000000000000f03f121209000000000000f03f11000000000000f03f1a1209000000000000f03f11000000000000f03f12210a0911000000000000f03f120911000000000000f03f1a0911000000000000f03f1a020801'),
            richF9:  pbHex('0a05250000803f2001'),
            richF10: pbHex('1100000000000008401a140d0000803f150000803f1d0000803f250000803f'),
            richF11: pbHex('110000000000b073401900000000000014402100000000000014402a05250000803f31000000000000e83f'),
            richF12: pbHex('119a9999999999a93f'),
            richF14: pbHex('08012001290000000000003e40'),
            rtfF3:   pbHex('0a200a0c417269616c2d426f6c644d5411000000000040554040014a05417269616c10011a140d0000803f150000803f1d0000803f250000803f2200321f080229000000000000f03f4100000000000008406100000000000055406a004a005900000000000000806a060a0210381001'),
            rtfF4:   pbHex('110000000000b073401900000000000014402100000000000014402a05250000803f31000000000000e83f'),
            rtfF11:  pbHex('2020e280a22020'),
            rtfF12:  pbHex('1a140d3f357e3f155c8f423f1d6f12033d250000803f'),
            layersF6: pbHex('090000000000009e40110000000000e09040'), // text box: 1920×1080
            textRunF9: pbHex('11000000000000e03f180121b7e61c9efea6ac3f'),
            fileF1:  pbHex('08011204081a10041801220f081510032209333532353138313738'),
            fileF8:  pbHex('0a05250000803f'),
            fileF9:  pbHex('1801'),
            fileF17: pbHex('290000000000c07240'),
            textDataF4: pbHex('1801'),
          };
          // Fixed inner-element UUIDs (slide-scoped, don't need global uniqueness)
          const IU1 = 'C5D1BF09-EEDF-4902-9E23-B200B60594CA'; // lyric layers
          const IU2 = '7E6FDB83-7BDE-4BA5-8615-A545DBE3D371'; // rich text node

          // RTF escape: backslash, braces only (spaces handled separately per context)
          const rtfEsc = (s: string) =>
            s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
          // Convert all spaces (regular + NBSP) to RTF non-breaking space \'a0
          const rtfNBSP = (s: string) =>
            rtfEsc(s.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '').replace(/^"/, '').trimEnd())
              .replace(/ /g, "\\'a0");

          // Congregation slide RTF — white Arial-BoldMT 85pt centred on black background
          const buildLyricRTF = (rawLine: string): string => {
            const text = rtfEsc(
              rawLine.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '').replace(/^"/, '').trim()
            );
            return `{\\rtf1\\ansi\\ansicpg1252\\cocoartf2869\n` +
              `\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Arial-BoldMT;}\n` +
              `{\\colortbl;\\red255\\green255\\blue255;\\red255\\green255\\blue255;}\n` +
              `{\\*\\expandedcolortbl;;\\cssrgb\\c100000\\c100000\\c100000;}\n` +
              `\\deftab1680\n\\pard\\pardeftab1680\\slleading60\\pardirnatural\\qc\\partightenfactor0\n\n` +
              `\\f0\\b\\fs170 \\cf2 ${text}}`;
          };

          // Band notes RTF — Helvetica-Bold chords above Helvetica lyrics, black on white
          const buildNotesRTF = (rawChord: string | null, rawLyric: string): string => {
            const lyric = rtfNBSP(rawLyric);
            if (!rawChord) {
              return `{\\rtf1\\ansi\\ansicpg1252\\cocoartf2869\n` +
                `\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f1\\fswiss\\fcharset0 Helvetica;}\n` +
                `{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;}\n` +
                `{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0;}\n` +
                `\\deftab720\n\\pard\\pardeftab720\\partightenfactor0\n\n` +
                `\\f1\\b0\\fs194\\fsmilli97333 \\cf0 \\strokec2 ${lyric}}`;
            }
            // Transpose chord line using the same logic as the Copy panel
            let chordNorm = rawChord.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '').replace(/^"/, '').trimEnd();
            if (effectiveDisplayKey !== songBaseKey) {
              chordNorm = applyAccidentalPrefToLine(
                transposeChordLine(chordNorm, songBaseKey, effectiveDisplayKey, params.inputType)
              );
            } else {
              chordNorm = chordNorm.split(/(\s+)/).map((t: string) =>
                /^\s+$/.test(t) ? t : applyAccidentalPref(convertChord(t, songBaseKey, effectiveDisplayKey, params.inputType === 'letters'))
              ).join('');
            }
            const chord = rtfNBSP(chordNorm);
            return `{\\rtf1\\ansi\\ansicpg1252\\cocoartf2869\n` +
              `\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica-Bold;\\f1\\fswiss\\fcharset0 Helvetica;}\n` +
              `{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;}\n` +
              `{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0;}\n` +
              `\\deftab720\n\\pard\\pardeftab720\\partightenfactor0\n\n` +
              `\\f0\\b\\fs157\\fsmilli78667 \\cf0 \\expnd0\\expndtw0\\kerning0\n` +
              `\\outl0\\strokewidth0 \\strokec2 ${chord}\\\n` +
              `\\pard\\pardeftab720\\partightenfactor0\n\n` +
              `\\f1\\b0\\fs194\\fsmilli97333 \\cf0 \\strokec2 ${lyric}}`;
          };

          // Build one complete slide binary (congregation text + band notes)
          const buildProSlide = (slideUUID: string, elemUUID: string, lyricRTF: string, notesRTF: string): Uint8Array => {
            const lyricBytes = pbEnc.encode(lyricRTF);
            const notesBytes = pbEnc.encode(notesRTF);
            // F10.F23.F2.F1.F1.F1.F13 — RTF container with boilerplate visual metadata
            const rtfCont = pbCat(
              pbLD(3, BP.rtfF3), pbLD(4, BP.rtfF4),
              pbLD(5, lyricBytes),
              pbVI(6, 1), pbLD(8, new Uint8Array(0)), pbVI(9, 1),
              pbLD(11, BP.rtfF11), pbLD(12, BP.rtfF12),
            );
            // F10.F23.F2.F1.F1.F1 — rich text node
            const richText = pbCat(
              pbUUID(1, IU2),
              pbLD(3, BP.richF3),
              pbW1(5, BP.richF5),
              pbLD(8, BP.richF8), pbLD(9, BP.richF9), pbLD(10, BP.richF10),
              pbLD(11, BP.richF11), pbLD(12, BP.richF12),
              pbLD(13, rtfCont),
              pbLD(14, BP.richF14),
            );
            // F10.F23.F2.F1.F1 — text run
            const textRun = pbCat(pbLD(1, richText), pbVI(4, 3), pbLD(9, BP.textRunF9));
            // F10.F23.F2.F1 — lyric layers (full-screen 1920×1080 text box)
            const lyricLayers = pbCat(pbLD(1, textRun), pbLD(6, BP.layersF6), pbUUID(7, IU1));
            // F10.F23.F2.F2 — notes wrapper (raw RTF + empty F2)
            const notesWrapper = pbCat(pbLD(1, notesBytes), pbLD(2, new Uint8Array(0)));
            // F10.F23.F2 — text data
            const textData = pbCat(pbLD(1, lyricLayers), pbLD(2, notesWrapper), pbLD(4, BP.textDataF4));
            // F10.F23 — element data
            const elemData = pbLD(2, textData);
            // F10 — main element (type 11 = text)
            const element = pbCat(pbUUID(1, elemUUID), pbVI(6, 1), pbVI(9, 11), pbLD(23, elemData));
            // Slide
            return pbCat(
              pbUUID(1, slideUUID), pbVI(5, 1),
              pbLD(8, new Uint8Array(0)),
              pbLD(10, element),
              pbVI(12, 1),
            );
          };

          // Build a slide group (one per song section)
          const buildProGroup = (groupUUID: string, name: string, slideUUIDs: string[]): Uint8Array => {
            const info = pbCat(pbUUID(1, groupUUID), pbStr(2, name), pbLD(4, new Uint8Array(0)));
            return pbCat(pbLD(1, info), ...slideUUIDs.map(u => pbLD(2, pbLD(1, pbEnc.encode(u)))));
          };

          // Build the arrangement (ordered list of group UUIDs)
          const buildProArrangement = (arrUUID: string, name: string, groupUUIDs: string[]): Uint8Array =>
            pbCat(pbUUID(1, arrUUID), pbStr(2, name), ...groupUUIDs.map(u => pbLD(3, pbLD(1, pbEnc.encode(u)))));

          // Main export handler
          const handleExportPro = () => {
            const presUUID = pbNewUUID();
            const arrUUID  = pbNewUUID();
            const allSlides: Uint8Array[] = [];
            const allGroups: Uint8Array[] = [];
            const groupUUIDs: string[] = [];

            for (let si = 0; si < ppSections.length; si++) {
              const sec = ppSections[si];
              // Use split-adjusted lines if the user made edits in the panel
              const activeLines: string[] = ppSectionLines[si] ?? sec.lines;
              const groupUUID = pbNewUUID();
              groupUUIDs.push(groupUUID);
              const slideUUIDs: string[] = [];

              let pendingChord: string | null = null;
              for (const rawLine of activeLines) {
                const norm = rawLine.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '').trim();
                if (!norm) { pendingChord = null; continue; }
                if (isChordLine(norm)) { pendingChord = rawLine; continue; }
                // Each lyric line → one slide
                const slideUUID = pbNewUUID();
                const elemUUID  = pbNewUUID();
                slideUUIDs.push(slideUUID);
                allSlides.push(buildProSlide(
                  slideUUID, elemUUID,
                  buildLyricRTF(rawLine),
                  buildNotesRTF(pendingChord, rawLine),
                ));
                pendingChord = null;
              }
              if (slideUUIDs.length === 0) { groupUUIDs.pop(); continue; }
              allGroups.push(buildProGroup(groupUUID, sec.label, slideUUIDs));
            }

            if (allSlides.length === 0) { alert('No lyric lines found to export.'); return; }

            const arrangement = buildProArrangement(arrUUID, 'Song Order', groupUUIDs);
            const title = params.title || 'Song';

            const fileBytes = pbCat(
              pbLD(1, BP.fileF1),
              pbLD(2, pbLD(1, pbEnc.encode(presUUID))),
              pbStr(3, title),
              pbLD(8, BP.fileF8),
              pbLD(9, BP.fileF9),
              pbLD(11, arrangement),
              ...allGroups.map(g => pbLD(12, g)),
              ...allSlides.map(s => pbLD(13, s)),
              pbLD(17, BP.fileF17),
            );

            const blob = new Blob([fileBytes], { type: 'application/octet-stream' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = `${title}.pro`; a.click();
            URL.revokeObjectURL(url);
          };

          return (
            <>
              {/* Backdrop */}
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000 }}
                onClick={() => { setPpMode(false); }}
              />
              {/* Panel */}
              <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: Math.min(560, window.innerWidth),
                background: 'white', zIndex: 10001, display: 'flex', flexDirection: 'column',
                boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
              }}
                tabIndex={0}
                ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ppSplitCursor) {
                    e.preventDefault();
                    handleSplit(ppSplitCursor.secIdx);
                  }
                }}
              >
                {/* Header */}
                <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontFamily: 'Helvetica, sans-serif', fontWeight: 700, fontSize: '13pt' }}>
                      ProPresenter Copy
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={handleExportPro}
                        title="Export entire song as a .pro file with congregation lyrics + band notes"
                        style={{
                          padding: '5px 13px', fontSize: '9pt', fontWeight: 700,
                          border: 'none', borderRadius: 5, cursor: 'pointer',
                          fontFamily: 'Helvetica, sans-serif',
                          background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                          color: 'white',
                        }}
                      >⬇ Export .pro</button>
                      <button
                        onClick={() => setPpMode(false)}
                        style={{ fontSize: '14pt', border: 'none', background: 'none', cursor: 'pointer', color: '#666', padding: '0 4px' }}
                      >✕</button>
                    </div>
                  </div>
                  {/* Size control */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'Helvetica, sans-serif', fontSize: '10pt' }}>
                    <span style={{ color: '#555', whiteSpace: 'nowrap' }}>Chord size:</span>
                    <input
                      type="range" min={20} max={80} step={1} value={ppChordSize}
                      onChange={e => setPpChordSize(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ minWidth: 52, color: '#1a1a1a', fontWeight: 700 }}>{ppChordSize}pt</span>
                    <span style={{ color: '#888', whiteSpace: 'nowrap' }}>Lyrics: {ppLyricSize}pt</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: '9pt', color: '#94a3b8', fontFamily: 'Helvetica, sans-serif' }}>
                    Click a line to place a split cursor, then press Enter or ↵ Split to cut that line and its chord/lyric partner together.
                  </div>
                </div>

                {/* Section list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                  {ppSections.map((sec, idx) => {
                    const isCopied = ppCopiedIdx === idx;
                    // Use locally-modified lines if they exist, otherwise fall back to original
                    const activeLines: string[] = ppSectionLines[idx] ?? sec.lines;
                    const hasContent = activeLines.some(l => l.replace(/[\u00A0\uFFFC\u200B]/g, '').trim());
                    const sectionHasCursor = ppSplitCursor?.secIdx === idx;
                    const sectionIsModified =
                      ppSectionLines[idx] !== undefined &&
                      JSON.stringify(ppSectionLines[idx]) !== JSON.stringify(sec.lines);

                    return (
                      <div key={idx} style={{ borderBottom: '1px solid #f1f5f9', padding: '10px 16px' }}>
                        {/* Section header row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: 'Helvetica, sans-serif', fontWeight: 700, fontSize: '9pt', color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                              {sec.label}
                            </span>
                            {/* Reset button — appears once a section has been split */}
                            {sectionIsModified && (
                              <button
                                onClick={() => {
                                  setPpSectionLines(prev => { const n = {...prev}; delete n[idx]; return n; });
                                  if (sectionHasCursor) setPpSplitCursor(null);
                                }}
                                title="Undo all splits in this section"
                                style={{
                                  padding: '2px 8px', fontSize: '8pt', fontWeight: 600,
                                  border: '1px solid #e2e8f0', borderRadius: 4,
                                  background: '#f8fafc', color: '#64748b',
                                  cursor: 'pointer', fontFamily: 'Helvetica, sans-serif',
                                }}
                              >↺ Reset</button>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {/* Split button — visible when cursor is placed in this section */}
                            {sectionHasCursor && (
                              <button
                                onClick={() => handleSplit(idx)}
                                style={{
                                  padding: '4px 12px', fontSize: '9pt', fontWeight: 700,
                                  border: 'none', borderRadius: 5, fontFamily: 'Helvetica, sans-serif',
                                  backgroundColor: '#3b82f6', color: 'white', cursor: 'pointer',
                                }}
                              >↵ Split here</button>
                            )}
                            <button
                              onClick={() => copySection(activeLines, idx)}
                              disabled={!hasContent}
                              style={{
                                padding: '4px 14px', fontSize: '9pt', fontWeight: 700, cursor: hasContent ? 'pointer' : 'default',
                                border: 'none', borderRadius: 5, fontFamily: 'Helvetica, sans-serif',
                                backgroundColor: isCopied ? '#22c55e' : '#1a1a1a',
                                color: 'white', transition: 'background-color 0.25s',
                                opacity: hasContent ? 1 : 0.35,
                              }}
                            >
                              {isCopied ? '✓ Copied' : 'Copy'}
                            </button>
                          </div>
                        </div>
                        {/* Preview at readable size — same proportions as main preview page */}
                        {hasContent && (
                          <div style={{ overflowX: 'auto' }}>
                            {activeLines.map((rawLine, lIdx) => {
                              const normalized = rawLine.replace(/\u00A0/g, ' ').replace(/\uFFFC/g, '').replace(/^"/, '').trimEnd();
                              if (!normalized) return <div key={lIdx} style={{ height: '0.4em' }} />;
                              const isChord = isChordLine(normalized);
                              let displayed = normalized;
                              if (effectiveDisplayKey !== songBaseKey && isChord) {
                                displayed = applyAccidentalPrefToLine(transposeChordLine(normalized, songBaseKey, effectiveDisplayKey, params.inputType));
                              } else if (isChord) {
                                displayed = displayed.split(/(\s+)/).map(t =>
                                  /^\s+$/.test(t) ? t : applyAccidentalPref(convertChord(t, songBaseKey, effectiveDisplayKey, params.inputType === 'letters'))
                                ).join('');
                              }

                              // Is this the line where the split cursor is placed?
                              const hasCursor = ppSplitCursor?.secIdx === idx && ppSplitCursor?.lineIdx === lIdx;
                              const cursorPos = hasCursor ? ppSplitCursor!.charPos : null;

                              return (
                                <pre
                                  key={lIdx}
                                  data-pp-line={`${idx}-${lIdx}`}
                                  onClick={e => handleLineClick(e, idx, lIdx)}
                                  style={{
                                    margin: 0, padding: 0, lineHeight: 1.3,
                                    fontFamily: 'Helvetica, sans-serif',
                                    fontSize: isChord ? '13pt' : '16pt',
                                    fontWeight: isChord ? 700 : 400,
                                    backgroundColor: hasCursor ? '#eff6ff' : 'transparent',
                                    color: isChord ? '#444' : '#000',
                                    whiteSpace: 'pre',
                                    cursor: 'text',
                                    userSelect: 'none',
                                    borderRadius: 3,
                                  }}
                                >
                                  {cursorPos !== null ? (
                                    // Render with a visible split-cursor bar
                                    <>
                                      <span>{displayed.slice(0, cursorPos)}</span>
                                      <span style={{
                                        display: 'inline-block', width: 0,
                                        borderLeft: '2px solid #3b82f6',
                                        height: '1em', verticalAlign: 'text-bottom',
                                        margin: '0 -1px',
                                        animation: 'ppCursorBlink 1s step-end infinite',
                                      }} />
                                      <span>{displayed.slice(cursorPos)}</span>
                                    </>
                                  ) : (
                                    isChord ? renderChordLine(displayed) : displayed
                                  )}
                                </pre>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <style>{`@keyframes ppCursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
            </>
          );
        })(),
        document.body
      )}
    </div>
  );
}

// ============================
// Shared App Bar
// ============================
// ============================
// Shared App Bar (Modernized)
// ============================
// ── Reusable bottom sheet ─────────────────────────────────────────────────────
function BottomSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return ReactDOM.createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 998 }} onClick={onClose} />
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 999,
        background: 'white', borderRadius: '20px 20px 0 0',
        paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
        boxShadow: '0 -4px 30px rgba(0,0,0,0.18)',
        animation: 'slideUp 0.22s ease',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#cbd5e1', margin: '12px auto 8px' }} />
        {children}
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </>,
    document.body
  );
}

// ── Shared bottom tab bar chrome ───────────────────────────────────────────────
const TAB_BAR_H = 'calc(52px + env(safe-area-inset-bottom))';
const TAB_BTN: React.CSSProperties = {
  flex: 1, height: 52, display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
};

function TabBarWrap({ children }: { children: React.ReactNode }) {
  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      height: TAB_BAR_H,
      backgroundColor: 'rgba(255,255,255,0.96)',
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      borderTop: '0.5px solid rgba(0,0,0,0.12)',
      display: 'flex', alignItems: 'center', paddingBottom: 'env(safe-area-inset-bottom)',
      zIndex: 500, boxSizing: 'border-box' as const,
      // Force GPU compositing layer — prevents jitter on iOS during momentum scroll
      transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)',
      willChange: 'transform',
    }}>
      {children}
    </div>,
    document.body
  );
}

function TabBtn({ icon, label, active, onClick }: { icon: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...TAB_BTN, color: active ? '#0f172a' : '#94a3b8' }}>
      <span style={{ fontSize: '22px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '10px', fontWeight: active ? 700 : 500, letterSpacing: '0.02em', fontFamily: '-apple-system, system-ui, sans-serif' }}>{label}</span>
      {active && <div style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: '#0f172a', marginTop: 1 }} />}
    </button>
  );
}

// ── Archive / Plans / Team toolbar ────────────────────────────────────────────
function BottomTabBar({ activeTab, onTab, authUser, actions }: {
  activeTab: 'archive' | 'setlist' | 'team';
  onTab: (tab: 'archive' | 'setlist' | 'team') => void;
  authUser?: any;
  actions?: { label: string; onPress: () => void; primary?: boolean }[];
}) {
  const isMobile = window.innerWidth < 768;
  const [showSheet, setShowSheet] = useState(false);
  if (!isMobile) return null;

  const isActive = (id: string) => id === 'archive' ? activeTab === 'archive' : (activeTab === 'setlist' || activeTab === 'team');

  return (
    <>
      <TabBarWrap>
        <TabBtn icon="🎵" label="Songs" active={isActive('archive')} onClick={() => onTab('archive')} />
        <TabBtn icon="🗓️" label="Plans" active={isActive('setlist')} onClick={() => onTab('setlist')} />
        <button onClick={() => setShowSheet(true)} style={{ ...TAB_BTN, color: '#0f172a' }}>
          <span style={{ fontSize: '22px', lineHeight: 1 }}>•••</span>
          <span style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '0.02em', fontFamily: '-apple-system, system-ui, sans-serif', color: '#94a3b8' }}>More</span>
        </button>
      </TabBarWrap>

      {showSheet && (
        <BottomSheet onClose={() => setShowSheet(false)}>
          {(actions && actions.length > 0 ? actions : []).map((action, i) => (
            <button key={i} onClick={() => { action.onPress(); setShowSheet(false); }} style={{
              display: 'block', width: '100%', padding: '16px 24px',
              fontSize: '17px', fontWeight: action.primary ? 700 : 500,
              textAlign: 'left' as const, background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: '-apple-system, system-ui, sans-serif',
              color: action.primary ? '#0f172a' : '#374151',
              borderTop: i > 0 ? '1px solid #f1f5f9' : 'none',
            }}>{action.label}</button>
          ))}
          <button onClick={() => setShowSheet(false)} style={{
            display: 'block', width: 'calc(100% - 48px)', margin: '8px 24px',
            padding: '14px', fontSize: '16px', fontWeight: 600,
            textAlign: 'center' as const, background: '#f1f5f9', border: 'none',
            borderRadius: 12, cursor: 'pointer', fontFamily: '-apple-system, system-ui, sans-serif', color: '#64748b',
          }}>Cancel</button>
        </BottomSheet>
      )}
    </>
  );
}

// ── Preview toolbar (replaces BottomTabBar in song preview) ───────────────────
function PreviewToolbar({
  onBack, onHome, setlist, setlistIdx, onSetlistNav,
  displayKey, songBaseKey, songIsMinor, keyList, flatKeys, onKeyChange,
  isPlaying, hasSpotify, hasTrack, onPlayPause,
  playbackPos, playbackDuration,
  onEdit, onExportPDF, onBookmark, isBookmarked,
  authUser, song,
}: {
  onBack: () => void;
  onHome: () => void;
  setlist?: any;
  setlistIdx?: number;
  onSetlistNav?: (dir: number) => void;
  displayKey: string;
  songBaseKey: string;
  songIsMinor: boolean;
  keyList: string[];
  flatKeys: Set<string>;
  onKeyChange: (k: string) => void;
  isPlaying: boolean;
  hasSpotify: boolean;
  hasTrack: boolean;
  onPlayPause: () => void;
  playbackPos: number;
  playbackDuration: number;
  onEdit: () => void;
  onExportPDF?: () => void;
  onBookmark?: () => void;
  isBookmarked: boolean;
  authUser?: any;
  song?: any;
}) {
  const [showKeySheet, setShowKeySheet] = useState(false);
  const [showMoreSheet, setShowMoreSheet] = useState(false);

  const progressPct = playbackDuration > 0 ? Math.min(100, (playbackPos / playbackDuration) * 100) : 0;
  const timeStr = playbackDuration > 0
    ? `${Math.floor(playbackPos / 60000)}:${String(Math.floor((playbackPos % 60000) / 1000)).padStart(2, '0')}`
    : '';

  return (
    <>
      <TabBarWrap>
        {/* Back */}
        <button onClick={onBack} style={{ ...TAB_BTN, flex: 1, color: '#0f172a' }}>
          <span style={{ fontSize: '22px', lineHeight: 1 }}>‹</span>
          <span style={{ fontSize: '10px', fontWeight: 500, fontFamily: '-apple-system, system-ui, sans-serif', color: '#94a3b8' }}>Back</span>
        </button>

        {/* Key */}
        <button onClick={() => setShowKeySheet(true)} style={{ ...TAB_BTN, flex: 1, color: '#0f172a' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'Helvetica, sans-serif', lineHeight: 1.2 }}>
            {displayKey}{songIsMinor ? 'm' : ''}
          </span>
          <span style={{ fontSize: '10px', fontWeight: 500, fontFamily: '-apple-system, system-ui, sans-serif', color: '#94a3b8' }}>Key</span>
        </button>

        {/* Play / progress ring — only if spotify + track linked */}
        {hasSpotify && hasTrack ? (() => {
          // SVG progress ring: r=9.5, circumference=~59.7
          const R = 9.5;
          const C = 2 * Math.PI * R;
          const arc = progressPct / 100 * C;
          // Arc path for progress: starts at top (−90°), sweeps clockwise
          const angle = (progressPct / 100) * 360;
          const rad = (angle - 90) * Math.PI / 180;
          const x = 11 + R * Math.cos(rad);
          const y = 11 + R * Math.sin(rad);
          const largeArc = angle > 180 ? 1 : 0;
          const arcPath = progressPct > 0 && progressPct < 100
            ? `M11 1.5 A${R} ${R} 0 ${largeArc} 1 ${x.toFixed(2)} ${y.toFixed(2)}`
            : progressPct >= 100 ? `M11 1.5 A${R} ${R} 0 1 1 10.99 1.5` : '';
          return (
            <button onClick={onPlayPause} style={{ ...TAB_BTN, flex: 1, color: '#0f172a' }}>
              <svg width="26" height="26" viewBox="0 0 22 22" style={{ display: 'block' }}>
                {/* Track ring */}
                <circle cx="11" cy="11" r={R} fill="none" stroke="#e2e8f0" strokeWidth="1.4"/>
                {/* Progress arc */}
                {arcPath && (
                  <path d={arcPath} fill="none" stroke="#1db954" strokeWidth="1.8" strokeLinecap="round"/>
                )}
                {/* Play triangle or pause bars */}
                {isPlaying ? (
                  <>
                    <rect x="7.5" y="7" width="2.8" height="8" rx="1.2" fill="#0f172a"/>
                    <rect x="11.7" y="7" width="2.8" height="8" rx="1.2" fill="#0f172a"/>
                  </>
                ) : (
                  <polygon points="9,7 16,11 9,15" fill="#0f172a"/>
                )}
              </svg>
              <span style={{ fontSize: '10px', fontWeight: 500, fontFamily: '-apple-system, system-ui, sans-serif', color: '#94a3b8' }}>{timeStr || 'Play'}</span>
            </button>
          );
        })() : hasSpotify ? (
          <button disabled style={{ ...TAB_BTN, flex: 1, color: '#cbd5e1' }}>
            <svg width="26" height="26" viewBox="0 0 22 22" style={{ display: 'block' }}>
              <circle cx="11" cy="11" r="9.5" fill="none" stroke="#e2e8f0" strokeWidth="1.4"/>
              <polygon points="9,7 16,11 9,15" fill="#cbd5e1"/>
            </svg>
            <span style={{ fontSize: '10px', fontWeight: 500, fontFamily: '-apple-system, system-ui, sans-serif', color: '#cbd5e1' }}>No track</span>
          </button>
        ) : null}

        {/* More */}
        <button onClick={() => setShowMoreSheet(true)} style={{ ...TAB_BTN, flex: 1, color: '#0f172a' }}>
          <span style={{ fontSize: '22px', lineHeight: 1 }}>•••</span>
          <span style={{ fontSize: '10px', fontWeight: 500, fontFamily: '-apple-system, system-ui, sans-serif', color: '#94a3b8' }}>More</span>
        </button>
      </TabBarWrap>

      {/* Key picker sheet */}
      {showKeySheet && (
        <BottomSheet onClose={() => setShowKeySheet(false)}>
          <div style={{ padding: '4px 20px 16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12, fontFamily: '-apple-system, system-ui, sans-serif' }}>Select Key</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {keyList.map(k => {
                const isActive = k === displayKey;
                const isOriginal = k === songBaseKey;
                return (
                  <button key={k} onClick={() => { onKeyChange(k); setShowKeySheet(false); }} style={{
                    padding: '10px 4px 8px',
                    borderRadius: 10,
                    border: isOriginal && !isActive ? '1.5px solid #1a1a1a' : '1.5px solid transparent',
                    backgroundColor: isActive ? '#1a1a1a' : '#f1f5f9',
                    color: isActive ? 'white' : '#0f172a',
                    fontFamily: 'Helvetica, sans-serif',
                    fontWeight: 700,
                    fontSize: songIsMinor ? '11px' : '13px',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3,
                  }}>
                    <FlatLabel text={k + (songIsMinor ? 'm' : '')} invert={isActive} />
                    {isOriginal && (
                      <div style={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: isActive ? 'white' : '#1a1a1a' }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <button onClick={() => setShowKeySheet(false)} style={{
            display: 'block', width: 'calc(100% - 40px)', margin: '0 20px 4px',
            padding: '13px', fontSize: '16px', fontWeight: 600,
            textAlign: 'center' as const, background: '#f1f5f9', border: 'none',
            borderRadius: 12, cursor: 'pointer', fontFamily: '-apple-system, system-ui, sans-serif', color: '#64748b',
          }}>Cancel</button>
        </BottomSheet>
      )}

      {/* More sheet */}
      {showMoreSheet && (
        <BottomSheet onClose={() => setShowMoreSheet(false)}>
          {[
            ...(authUser && song && (song.userId === authUser.id || (!song.userId && authUser.id === ADMIN_USER_ID))
              ? [{ label: '✏️  Edit Song', onPress: onEdit, primary: true }]
              : []),
            ...(onExportPDF ? [{ label: '📄  Export PDF', onPress: onExportPDF }] : []),
            ...(setlist && onSetlistNav && (setlistIdx ?? 0) > 0 ? [{ label: '‹  Previous Song', onPress: () => onSetlistNav!(-1) }] : []),
            ...(setlist && onSetlistNav && (setlistIdx ?? 0) < (setlist.entries.length - 1) ? [{ label: '›  Next Song', onPress: () => onSetlistNav!(1) }] : []),
            ...(!isBookmarked && onBookmark ? [{ label: '🔖  Save to My Archive', onPress: onBookmark }] : []),
            { label: '🏠  Go to Archive', onPress: onHome },
          ].map((action, i) => (
            <button key={i} onClick={() => { action.onPress(); setShowMoreSheet(false); }} style={{
              display: 'block', width: '100%', padding: '16px 24px',
              fontSize: '17px', fontWeight: (action as any).primary ? 700 : 500,
              textAlign: 'left' as const, background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: '-apple-system, system-ui, sans-serif',
              color: (action as any).primary ? '#0f172a' : '#374151',
              borderTop: i > 0 ? '1px solid #f1f5f9' : 'none',
            }}>{action.label}</button>
          ))}
          <button onClick={() => setShowMoreSheet(false)} style={{
            display: 'block', width: 'calc(100% - 48px)', margin: '8px 24px',
            padding: '14px', fontSize: '16px', fontWeight: 600,
            textAlign: 'center' as const, background: '#f1f5f9', border: 'none',
            borderRadius: 12, cursor: 'pointer', fontFamily: '-apple-system, system-ui, sans-serif', color: '#64748b',
          }}>Cancel</button>
        </BottomSheet>
      )}
    </>
  );
}

function AppBar({ onHome, children, centerContent, subRow, backButton }: { onHome: () => void; children?: React.ReactNode; centerContent?: React.ReactNode; subRow?: React.ReactNode; backButton?: React.ReactNode }) {
  const isMobile = window.innerWidth < 768;
  if (isMobile) return null;
  return (
    <div style={{ 
      backgroundColor: "rgba(255, 255, 255, 0.85)", 
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      borderBottom: "1px solid #e2e8f0", 
      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)",
      position: "sticky", 
      top: 0, 
      zIndex: 50, 
      width: "100%", 
      boxSizing: "border-box" as const,
      paddingTop: "env(safe-area-inset-top)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
    }}>
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        height: 56, 
        padding: "0 12px", 
        gap: 6, 
        position: "relative",
        maxWidth: 1200,
        margin: "0 auto",
        minWidth: 0,
        overflow: "hidden",
      }}>
        {/* Left: logo */}
        <button onClick={onHome} title="Home" style={{ padding: 0, background: "none", border: "none", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", zIndex: 1, transition: "transform 0.2s ease" }}
          onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
          onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
        >
          <img src="/icon.png" alt="Home" style={{ width: 32, height: 32, borderRadius: 8, display: "block", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }} />
        </button>
        {/* Back button: immediately right of logo */}
        {backButton && (
          <div style={{ flexShrink: 1, minWidth: 0, zIndex: 1, overflow: "hidden" }}>
            {backButton}
          </div>
        )}
        {/* Center: absolutely positioned so it's always truly centered */}
        {centerContent && (
          <div style={{ position: "absolute", left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 8, pointerEvents: "none" }}>
            <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 8, maxWidth: "60%", overflow: "hidden" }}>
              {centerContent}
            </div>
          </div>
        )}
        {/* Right: children */}
        {children && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, zIndex: 1, flexShrink: 0 }}>
            {children}
          </div>
        )}
      </div>
      {subRow && (
        <div style={{ padding: "6px 24px 8px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "center" }}>
          {subRow}
        </div>
      )}
    </div>
  );
}

function ArchiveView({ songs, loading, onNew, onPreview, onDelete, onSetlist, onTeam, authUser, onLogin, onLogout, onBookmark, onUnbookmark, bookmarks, archiveTab, setArchiveTab, onSettings, spotifyToken, onSpotifyDisconnect, onSpotifyConnect }: {
  songs: SavedSong[];
  loading?: boolean;
  onNew: () => void;
  onPreview: (song: SavedSong, sourceTab?: 'public' | 'mine') => void;
  onDelete: (id: string) => void;
  onSetlist: () => void;
  onTeam: () => void;
  authUser?: AuthUser | null;
  onLogin: () => void;
  onLogout: () => void;
  onBookmark: (song: SavedSong) => void;
  onUnbookmark: (songId: string) => void;
  bookmarks: string[];
  archiveTab: 'public' | 'mine';
  setArchiveTab: (tab: 'public' | 'mine') => void;
  onSettings?: () => void;
  spotifyToken?: string | null;
  onSpotifyDisconnect: () => void;
  onSpotifyConnect: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState<Record<string, string>>({});
  const [sortCol, setSortCol] = useState<'title' | 'key' | 'bpm' | 'writers'>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [bookmarkCounts, setBookmarkCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showHamburger, setShowHamburger] = useState(false);
  const KEY_LIST = ['A','Bb','B','C','Db','D','Eb','E','F','F#','G','Ab'];

  const [addToSetlistSong, setAddToSetlistSong] = useState<SavedSong | null>(null);
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [setlistsLoading, setSetlistsLoading] = useState(false);
  const [lastUsedId, setLastUsedId] = useState<string | null>(null);
  useEffect(() => { store.get('lastUsedSetlistId').then(v => { if (v) setLastUsedId(v); }); }, []);
  const [newSetlistName, setNewSetlistName] = useState('');
  const [mode, setMode] = useState<'pick' | 'new'>('pick');

  // Load setlists from database
  useEffect(() => {
    const loadSetlists = async () => {
      if (!authUser) {
        setSetlists([]);
        return;
      }
      
      setSetlistsLoading(true);
      try {
        const { data: setlistsData, error } = await supabase
          .from('setlists')
          .select(`id, name, date, created_at, entries:setlist_entries(song_id, display_key, position)`)
          .eq('user_id', authUser.id)
          .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        const transformed: Setlist[] = (setlistsData || []).map((sl: any) => ({
          id: sl.id,
          name: sl.name,
          createdAt: new Date(sl.created_at).getTime(),
          date: sl.date ? String(sl.date).slice(0, 10) : undefined,
          entries: (sl.entries as any[])
            .sort((a, b) => a.position - b.position)
            .map(e => ({ songId: e.song_id, displayKey: e.display_key }))
        }));
        setSetlists(transformed);
      } catch (error) {
        setSetlists([]);
      } finally {
        setSetlistsLoading(false);
      }
    };
    loadSetlists();
  }, [authUser?.id]);


  const [selectedSetlistId, setSelectedSetlistId] = useState<string | null>(null);

  const openAddPopup = (song: SavedSong) => {
    setAddToSetlistSong(song);
    setMode('pick');
    setNewSetlistName('');
    const def = lastUsedId && setlists.find(s => s.id === lastUsedId) ? lastUsedId : setlists[0]?.id || null;
    setSelectedSetlistId(def);
  };

  const confirmAdd = async () => {
    if (!addToSetlistSong || !authUser) return;
    const entry: SetlistEntry = { songId: addToSetlistSong.id, displayKey: normalizeDisplayKey(addToSetlistSong.key) };
    let targetId = selectedSetlistId;
    
    try {
      if (mode === 'new') {
        if (!newSetlistName.trim()) return;
        const { data: newSetlist, error: createError } = await supabase
          .from('setlists')
          .insert({ user_id: authUser.id, name: newSetlistName.trim() })
          .select().single();
        if (createError) throw createError;
        targetId = newSetlist.id;
        
        const { error: entryError } = await supabase.from('setlist_entries').insert({
          setlist_id: targetId, song_id: entry.songId, display_key: entry.displayKey, position: 0
        });
        if (entryError) throw entryError;
        
        const newList: Setlist = { id: newSetlist.id, name: newSetlist.name, entries: [entry], createdAt: new Date(newSetlist.created_at).getTime() };
        setSetlists([...setlists, newList]);
      } else {
        if (!targetId) return;
        const target = setlists.find(s => s.id === targetId);
        if (!target) return;
        const { error } = await supabase.from('setlist_entries').insert({
          setlist_id: targetId, song_id: entry.songId, display_key: entry.displayKey, position: target.entries.length
        });
        if (error) throw error;
        setSetlists(setlists.map(s => s.id === targetId ? { ...s, entries: [...s.entries, entry] } : s));
      }
      if (targetId) { setLastUsedId(targetId); store.set('lastUsedSetlistId', targetId); }
      setAddToSetlistSong(null);
    } catch (error) {
      alert('Failed to add song to setlist');
    }
  };

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };


  const tabSongs = (authUser && archiveTab === 'mine'
    ? songs.filter(s => s.userId === authUser.id || bookmarks.includes(s.id))
    : songs.filter(s => s.userId === null)
  ).filter(s => !s.parentSongId); // hide versions from main list — accessible via version dropdown

  const filteredSongs = search.trim()
    ? tabSongs.filter(s => {
        const q = search.toLowerCase();
        const tagsMatch = s.tags?.some(tag => tag.toLowerCase().includes(q));
        return (s.title || '').toLowerCase().includes(q) || (s.writers || '').toLowerCase().includes(q) || tagsMatch;
      })
    : tabSongs;

  const sortedSongs = [...filteredSongs].sort((a, b) => {
    if (sortCol === 'bpm') {
      const aNum = parseFloat(a.bpm) || 0;
      const bNum = parseFloat(b.bpm) || 0;
      return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
    }
    const aStr = (sortCol === 'key' ? a.key : sortCol === 'writers' ? a.writers : a.title) || '';
    const bStr = (sortCol === 'key' ? b.key : sortCol === 'writers' ? b.writers : b.title) || '';
    return sortDir === 'asc'
      ? aStr.toLowerCase().localeCompare(bStr.toLowerCase(), undefined, { sensitivity: 'base' })
      : bStr.toLowerCase().localeCompare(aStr.toLowerCase(), undefined, { sensitivity: 'base' });
  });

  const SortHeader = ({ col, label }: { col: typeof sortCol; label: string }) => {
    const active = sortCol === col;
    return (
      <th onClick={() => handleSort(col)} style={{ textAlign: 'left', padding: "12px 16px", fontWeight: 600, color: active ? "#0f172a" : "#475569", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
        {label}
        <span style={{ marginLeft: 6, opacity: active ? 1 : 0.25, fontSize: "10px", color: "#64748b" }}>
          {active && sortDir === 'desc' ? '▲' : '▼'}
        </span>
      </th>
    );
  };

  const isMobile = window.innerWidth < 768;
  const FONT_STACK = '"Inter", system-ui, -apple-system, sans-serif';

  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (isMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if modifier keys held, or if already typing in an input/textarea
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable) return;
      // Only trigger on printable characters (letters, numbers, common punctuation)
      if (e.key.length === 1) {
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile]);

  const getTempoStyle = (bpm: string): { bg: string; color: string } => {
    const val = parseFloat(bpm);
    if (!val) return { bg: '#f1f5f9', color: '#64748b' };
    const slow = 60, fast = 160;
    const t = Math.max(0, Math.min(1, (val - slow) / (fast - slow)));
    let r, g, b;
    if (t < 0.5) { r = 239; g = Math.round(68 + t * 2 * 130); b = 68; } 
    else { r = Math.round(234 - (t - 0.5) * 2 * 160); g = 179; b = 8; }
    return { bg: `rgba(${r},${g},${b},0.15)`, color: `rgb(${Math.round(r * 0.8)},${Math.round(g * 0.8)},${Math.round(b * 0.6)})` };
  };

  return (
    <div style={{ fontFamily: FONT_STACK, minHeight: "100vh", backgroundColor: "#f8fafc", overflowX: "hidden", maxWidth: "100vw", paddingTop: isMobile ? "env(safe-area-inset-top)" : 0, paddingBottom: isMobile ? "calc(52px + env(safe-area-inset-bottom))" : 0 }}>
      {isMobile && <BottomTabBar activeTab="archive" onTab={tab => { if (tab === 'setlist') onSetlist(); else if (tab === 'team') onTeam(); }} authUser={authUser} actions={authUser ? [
        { label: '✏️  New Song', onPress: onNew, primary: true },
        ...(!spotifyToken ? [{ label: '🎵  Connect Spotify', onPress: onSpotifyConnect }] : [{ label: '🎵  Disconnect Spotify', onPress: onSpotifyDisconnect }]),
        { label: '🚪  Sign Out', onPress: onLogout },
      ] : [
        { label: '🔑  Log In', onPress: onLogin, primary: true },
      ]} />}
      <AppBar onHome={() => {}} centerContent={<span style={{ fontWeight: 700, fontSize: "17px", color: "#0f172a", letterSpacing: "-0.02em" }}>Worship Archive</span>}>
          {authUser ? (
            <>
              {isMobile ? (
                /* ── Mobile: single hamburger button ── */
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setShowHamburger(!showHamburger)}
                    style={{ ...APP_BAR_BTN, padding: "6px 10px", fontSize: "18px", lineHeight: 1 }}
                  >☰</button>
                  {showHamburger && ReactDOM.createPortal(
                    <>
                      <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={() => setShowHamburger(false)} />
                      <div style={{ position: "fixed", top: "calc(56px + env(safe-area-inset-top))", right: 12, backgroundColor: "white", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.18)", minWidth: 220, zIndex: 9999, overflow: "hidden" }}>
                        {/* Signed in as */}
                        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 2 }}>Signed in as</div>
                          <div style={{ fontSize: "13px", color: "#0f172a", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{authUser.email}</div>
                        </div>
                        {[
                          { label: "+ New Song", action: () => { onNew(); setShowHamburger(false); } },
                        ].map(item => (
                          <button key={item.label} onClick={item.action}
                            style={{ width: "100%", padding: "14px 16px", fontSize: "15px", textAlign: "left" as const, border: "none", borderBottom: "1px solid #f1f5f9", backgroundColor: "white", cursor: "pointer", fontFamily: FONT_STACK, color: "#0f172a", fontWeight: 500, display: "block", boxSizing: "border-box" as const }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#f8fafc"; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "white"; }}
                          >{item.label}</button>
                        ))}
                        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>Music</div>
                          {spotifyToken ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: "13pt" }}>🎵</span>
                              <span style={{ fontSize: "13px", color: "#1db954", fontWeight: 600, flex: 1 }}>Spotify Connected</span>
                              <button onClick={() => { onSpotifyDisconnect(); setShowHamburger(false); }} style={{ fontSize: "11px", padding: "3px 8px", border: "1px solid #fca5a5", borderRadius: 4, color: "#ef4444", backgroundColor: "white", cursor: "pointer" }}>Disconnect</button>
                            </div>
                          ) : (
                            <button onClick={onSpotifyConnect} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", backgroundColor: "#1db954", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
                              <span style={{ fontSize: "14pt" }}>🎵</span> Connect Spotify
                            </button>
                          )}
                        </div>
                        <button onClick={() => { onLogout(); setShowHamburger(false); }}
                          style={{ width: "100%", padding: "14px 16px", fontSize: "15px", textAlign: "left" as const, border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: FONT_STACK, color: "#ef4444", fontWeight: 500, boxSizing: "border-box" as const }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#fef2f2"; }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "white"; }}
                        >Sign out</button>
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              ) : (
                /* ── Desktop: full buttons ── */
                <>
                  <button onClick={onSetlist} style={APP_BAR_BTN}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#f1f5f9"; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#ffffff"; }}
                  >Plans</button>
                  <button onClick={onTeam} style={APP_BAR_BTN}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#f1f5f9"; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#ffffff"; }}
                  >Teams</button>
                  <button onClick={onNew} style={APP_BAR_BTN_PRIMARY}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = "#1e293b"}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = "#0f172a"}
                  >+ New Song</button>
                  <div style={{ position: "relative" }}>
                    <button onClick={() => setShowAccountMenu(!showAccountMenu)}
                      style={{ width: 36, height: 36, borderRadius: "50%", backgroundColor: "#1a1a1a", color: "white", border: "2px solid #e2e8f0", boxShadow: "0 2px 4px rgba(0,0,0,0.1)", cursor: "pointer", fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_STACK, transition: "transform 0.2s ease" }}
                      onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                      title={authUser.email}
                    >{authUser.email.charAt(0).toUpperCase()}</button>
                    {showAccountMenu && ReactDOM.createPortal(
                      <>
                        <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={() => setShowAccountMenu(false)} />
                        <div style={{ position: "fixed", top: "calc(56px + env(safe-area-inset-top))", right: 16, backgroundColor: "white", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15)", minWidth: 240, zIndex: 9999, overflow: "hidden" }}>
                          <div style={{ padding: "16px", borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 4 }}>Signed in as</div>
                            <div style={{ fontSize: "14px", color: "#0f172a", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{authUser.email}</div>
                          </div>
                          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>Music</div>
                            {spotifyToken ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: "13pt" }}>🎵</span>
                                <span style={{ fontSize: "13px", color: "#1db954", fontWeight: 600, flex: 1 }}>Spotify Connected</span>
                                <button onClick={() => { onSpotifyDisconnect(); setShowAccountMenu(false); }} style={{ fontSize: "11px", padding: "3px 8px", border: "1px solid #fca5a5", borderRadius: 4, color: "#ef4444", backgroundColor: "white", cursor: "pointer" }}>Disconnect</button>
                              </div>
                            ) : (
                              <button onClick={onSpotifyConnect} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", backgroundColor: "#1db954", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
                                <span style={{ fontSize: "14pt" }}>🎵</span> Connect Spotify
                              </button>
                            )}
                          </div>
                          <button onClick={() => { onLogout(); setShowAccountMenu(false); }} style={{ width: "100%", padding: "12px 16px", fontSize: "14px", textAlign: "left" as const, border: "none", backgroundColor: "white", cursor: "pointer", fontFamily: FONT_STACK, color: "#475569", fontWeight: 500, transition: "background 0.2s" }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#f8fafc"; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "white"; }}
                          >Sign out</button>
                        </div>
                      </>,
                      document.body
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <button onClick={onLogin} style={APP_BAR_BTN_PRIMARY}>Log In</button>
          )}
      </AppBar>

      {/* Page content */}
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: isMobile ? "16px 12px" : "40px 24px", boxSizing: "border-box", width: "100%", overflowX: "hidden", position: "relative", zIndex: 1 }}>

        {/* Page title + tabs */}
        <div style={{ marginBottom: 28 }}>
          {isMobile && <h1 style={{ margin: "0 0 20px 0", fontSize: "24px", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>Worship Archive</h1>}
          {authUser ? (
            <div style={{ display: 'flex', gap: 16, borderBottom: '1px solid #e2e8f0' }}>
              {(['public', 'mine'] as const).map(tab => (
                <button key={tab} onClick={() => setArchiveTab(tab)}
                  style={{ padding: '0 4px 12px', fontSize: '15px', fontWeight: archiveTab === tab ? 600 : 500, cursor: 'pointer', border: 'none', borderBottom: archiveTab === tab ? '2px solid #0f172a' : '2px solid transparent', backgroundColor: 'transparent', color: archiveTab === tab ? '#0f172a' : '#64748b', fontFamily: FONT_STACK, marginBottom: -1, transition: "all 0.2s ease" }}
                >{tab === 'public' ? 'Public Archive' : 'My Archive'}</button>
              ))}
            </div>
          ) : (
            !isMobile && <h1 style={{ margin: 0, fontSize: "32px", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em" }}>Worship Archive</h1>
          )}
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 28 }}>
          <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: "18px", pointerEvents: "none" }}>⌕</span>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search songs or writers…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{ width: "100%", boxSizing: "border-box", padding: "14px 16px 14px 44px", fontSize: "15px", fontFamily: FONT_STACK, border: "1px solid #cbd5e1", borderRadius: 12, outline: "none", backgroundColor: "white", boxShadow: "0 2px 4px rgba(0,0,0,0.02)", color: "#0f172a", transition: "all 0.2s ease" }}
            onFocus={e => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.15)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "#cbd5e1"; e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.02)"; }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "16px", padding: 4 }}>✕</button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ color: "#64748b", fontSize: "15px", fontWeight: 500 }}>Loading songs…</div>
          </div>
        ) : sortedSongs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 24px", backgroundColor: "white", borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "40px", marginBottom: 16 }}>🎵</div>
            <div style={{ color: "#0f172a", fontSize: "18px", fontWeight: 600, marginBottom: 8 }}>
              {search ? 'No songs found' : archiveTab === 'mine' ? 'Your archive is empty' : 'No songs yet'}
            </div>
            <div style={{ color: "#64748b", fontSize: "15px" }}>
              {search ? `No results for "${search}"` : archiveTab === 'mine' ? 'Save songs from the Public Archive or create your own.' : 'Click "+ New Song" to add the first chart.'}
            </div>
          </div>
        ) : (
          <div style={{ backgroundColor: "white", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)" }}>
            <div style={{ borderBottom: "1px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", fontFamily: FONT_STACK, tableLayout: "fixed" }}>
                <colgroup>
                  {isMobile ? (
                    <><col style={{ width: "auto" }} /><col style={{ width: "60px" }} /><col style={{ width: "56px" }} /></>
                  ) : (
                    <><col style={{ width: "38%" }} /><col style={{ width: "80px" }} /><col style={{ width: "80px" }} /><col /><col style={{ width: "80px" }} /></>
                  )}
                </colgroup>
                <thead>
                  <tr>
                    <SortHeader col="title" label="Title" />
                    {isMobile ? (
                      <>
                        <SortHeader col="bpm" label="BPM" />
                        <th style={{ padding: "12px 8px" }}></th>
                      </>
                    ) : (
                      <><SortHeader col="key" label="Key" /><SortHeader col="bpm" label="BPM" /><SortHeader col="writers" label="Writers" /><th style={{ padding: "12px 16px" }}></th></>
                    )}
                  </tr>
                </thead>
              </table>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", fontFamily: FONT_STACK, tableLayout: "fixed" }}>
              <colgroup>
                {isMobile ? (
                  <><col style={{ width: "auto" }} /><col style={{ width: "60px" }} /><col style={{ width: "56px" }} /></>
                ) : (
                  <><col style={{ width: "38%" }} /><col style={{ width: "80px" }} /><col style={{ width: "80px" }} /><col /><col style={{ width: "80px" }} /></>
                )}
              </colgroup>
              <tbody>
                {sortedSongs.map((song, i) => {
                  const ts = getTempoStyle(song.bpm);
                  const isBookmarked = bookmarks.includes(song.id);
                  const saves = bookmarkCounts[song.id] || 0;
                  return (
                    <tr key={song.id}
                      style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", transition: "background-color 0.2s ease" }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#f8fafc"; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      onMouseDown={e => {
                        // Prevent the input from losing focus (and triggering autocomplete) before the click registers
                        e.preventDefault();
                        onPreview({ ...song }, archiveTab);
                      }}
                    >
                      <td style={{ padding: "16px", fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{song.title}</span>
                          {spotifyToken && song.spotify_track_id && (
                            <span style={{ 
                              width: 14, 
                              height: 14, 
                              borderRadius: "50%", 
                              border: "1.5px solid #0f172a",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              fontSize: "7px",
                              lineHeight: 1,
                              color: "#0f172a",
                              paddingLeft: "1px"
                            }} title="Spotify playback available">▶</span>
                          )}
                          {song.tags?.some(t => t.toLowerCase() === 'hymn') && (
                            <span style={{
                              fontSize: "10px",
                              fontWeight: 600,
                              color: "#7c5c2e",
                              backgroundColor: "#fdf3e3",
                              border: "1px solid #e8c98a",
                              borderRadius: 4,
                              padding: "1px 5px",
                              letterSpacing: "0.04em",
                              flexShrink: 0,
                            }} title="Hymn">HYMN</span>
                          )}
                        </div>
                      </td>

                      {isMobile ? (
                        <td style={{ padding: "16px 8px", color: "#64748b", fontSize: "13px", whiteSpace: "nowrap", textAlign: "right" }}>
                          {song.bpm || "—"}
                        </td>
                      ) : (
                        <>
                          <td style={{ padding: "16px 8px", color: "#334155", fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap" }}>
                            <FlatLabel text={song.key} />
                          </td>
                          <td style={{ padding: "16px 8px" }}>
                            {song.bpm ? (
                              <span style={{ display: "inline-block", padding: "4px 8px", borderRadius: 6, fontSize: "12px", fontWeight: 600, backgroundColor: ts.bg, color: ts.color, letterSpacing: "0.02em" }}>
                                {song.bpm}
                              </span>
                            ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                          </td>
                          <td style={{ padding: "16px 8px", color: "#64748b", fontSize: "14px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {song.writers || "—"}
                          </td>
                        </>
                      )}

                      <td style={{ padding: isMobile ? "12px 8px" : "12px 16px", textAlign: "right", whiteSpace: "nowrap" }}
                        onMouseDown={e => e.stopPropagation()}
                      >
                        {authUser && archiveTab === 'public' && (
                          isBookmarked ? (
                            <button onClick={() => onUnbookmark(song.id)} title="Saved to My Archive" style={{ width: 32, height: 32, borderRadius: "50%", border: "none", backgroundColor: "#0f172a", cursor: "pointer", fontSize: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "white", padding: 0, transition: "transform 0.2s" }} onMouseEnter={e => e.currentTarget.style.transform = "scale(1.1)"} onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>✓</button>
                          ) : (
                            <button onClick={() => onBookmark(song)} title="Save to My Archive" style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #cbd5e1", backgroundColor: "white", cursor: "pointer", fontSize: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#64748b", padding: 0, transition: "all 0.2s" }} onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#0f172a"; e.currentTarget.style.color = "white"; e.currentTarget.style.borderColor = "#0f172a"; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = "white"; e.currentTarget.style.color = "#64748b"; e.currentTarget.style.borderColor = "#cbd5e1"; }}>+</button>
                          )
                        )}
                        {authUser && archiveTab === 'mine' && bookmarks.includes(song.id) && (
                          <button onClick={() => onUnbookmark(song.id)} title="Remove from My Archive" style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #fca5a5", backgroundColor: "#fef2f2", cursor: "pointer", fontSize: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#ef4444", padding: 0, transition: "all 0.2s" }} onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#ef4444"; e.currentTarget.style.color = "white"; e.currentTarget.style.borderColor = "#ef4444"; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#fef2f2"; e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#fca5a5"; }}>✕</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


// ============================
// Setlist View
// ============================
// ============================================================================
// Team Management Component
// ============================================================================

function TeamManagement({ authUser, onBack, initialMembers, teamLoading, onMembersChange, onNavigate, inline, onAddMemberRef }: { authUser?: AuthUser | null; onBack: () => void; initialMembers?: TeamMember[]; teamLoading?: boolean; onMembersChange?: (members: TeamMember[]) => void; onNavigate?: (view: 'home' | 'editor' | 'archive' | 'preview' | 'setlist' | 'team') => void; inline?: boolean; onAddMemberRef?: (fn: () => void) => void }) {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(initialMembers || []);
  const [loading, setLoading] = useState(teamLoading ?? false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showManagePositions, setShowManagePositions] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [customPositions, setCustomPositions] = useState<string[]>(COMMON_POSITIONS);
  useEffect(() => { getCommonPositions().then(setCustomPositions); }, []);
  const [newCustomPosition, setNewCustomPosition] = useState('');
  
  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formPositions, setFormPositions] = useState<string[]>([]);
  const [formNotes, setFormNotes] = useState('');
  const [formNotifPref, setFormNotifPref] = useState<'email' | 'none'>('email');

  // Sync from app-level pre-loaded data
  useEffect(() => { if (initialMembers) setTeamMembers(initialMembers); }, [initialMembers]);
  useEffect(() => { setLoading(teamLoading ?? false); }, [teamLoading]);

  const loadTeamMembers = async () => {
    if (!authUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('team_members').select('*').eq('user_id', authUser.id).order('name');
      if (error) throw error;
      const members = data || [];
      setTeamMembers(members);
      if (onMembersChange) onMembersChange(members);
    } catch (err) {
      console.error('Error loading team members:', err);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingMember(null);
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormPositions([]);
    setFormNotes('');
    setFormNotifPref('email');
    setShowAddModal(true);
  };
  useEffect(() => { if (onAddMemberRef) onAddMemberRef(openAddModal); }, []);

  const openEditModal = (member: TeamMember) => {
    setEditingMember(member);
    setFormName(member.name);
    setFormEmail(member.email || '');
    setFormPhone(member.phone || '');
    setFormPositions(member.positions || []);
    setFormNotes(member.notes || '');
    setFormNotifPref(member.notification_preference || 'email');
    setShowAddModal(true);
  };

  const saveMember = async () => {
    if (!authUser || !formName.trim()) return;

    try {
      if (editingMember) {
        // Update existing
        const { error } = await supabase
          .from('team_members')
          .update({
            name: formName.trim(),
            email: formEmail.trim() || null,
            phone: formPhone.trim() || null,
            positions: formPositions,
            notes: formNotes.trim() || null,
            notification_preference: formNotifPref,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingMember.id);
        
        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from('team_members')
          .insert({
            user_id: authUser.id,
            name: formName.trim(),
            email: formEmail.trim() || null,
            phone: formPhone.trim() || null,
            positions: formPositions,
            notes: formNotes.trim() || null,
            notification_preference: formNotifPref
          });
        
        if (error) throw error;
      }

      setShowAddModal(false);
      loadTeamMembers();
    } catch (err) {
      console.error('Error saving team member:', err);
      alert('Failed to save team member');
    }
  };

  const deleteMember = async (id: string) => {
    if (!window.confirm('Delete this team member? This will also remove them from any setlists.')) return;

    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      loadTeamMembers();
    } catch (err) {
      console.error('Error deleting team member:', err);
      alert('Failed to delete team member');
    }
  };

  const togglePosition = (position: string) => {
    setFormPositions(prev => 
      prev.includes(position)
        ? prev.filter(p => p !== position)
        : [...prev, position]
    );
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
        <AppBar onHome={onBack}
          backButton={<button onClick={onBack} style={APP_BAR_BTN} onMouseEnter={e => e.currentTarget.style.backgroundColor='#f1f5f9'} onMouseLeave={e => e.currentTarget.style.backgroundColor='#ffffff'}>← Back</button>}
          centerContent={<span style={{ fontWeight: 700, fontSize: '17px', color: '#0f172a', letterSpacing: '-0.02em' }}>Teams</span>}
        />
        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
          Loading team members…
        </div>
      </div>
    );
  }

  return (
    <div style={inline ? {} : { minHeight: '100vh', background: '#f8fafc', paddingTop: window.innerWidth < 768 ? 'env(safe-area-inset-top)' : 0, paddingBottom: window.innerWidth < 768 ? 'calc(52px + env(safe-area-inset-bottom))' : 0 }}>
      {!inline && window.innerWidth < 768 && <BottomTabBar activeTab="team" onTab={tab => { if (onNavigate) onNavigate(tab); else onBack(); }} authUser={authUser} actions={[]} />}
      {/* Header using AppBar pattern */}
      {!inline && <AppBar onHome={onBack}
        backButton={<button onClick={onBack} style={APP_BAR_BTN} onMouseEnter={e => e.currentTarget.style.backgroundColor='#f1f5f9'} onMouseLeave={e => e.currentTarget.style.backgroundColor='#ffffff'}>← Back</button>}
        centerContent={<span style={{ fontWeight: 700, fontSize: '17px', color: '#0f172a', letterSpacing: '-0.02em' }}>Teams</span>}>
        <button
          onClick={() => setShowManagePositions(true)}
          style={APP_BAR_BTN}
          onMouseEnter={e => e.currentTarget.style.backgroundColor='#f1f5f9'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor='#ffffff'}
        >
          ⚙️ Positions
        </button>
        <button
          onClick={openAddModal}
          style={APP_BAR_BTN_PRIMARY}
          onMouseEnter={e => e.currentTarget.style.backgroundColor='#1e293b'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor='#0f172a'}
        >
          + Add
        </button>
      </AppBar>}

      {/* Inline mode: just a simple row with Add button */}
      {inline && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button onClick={openAddModal} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>+ Add Member</button>
        </div>
      )}

      {/* Team Members List */}
      <div style={{ padding: window.innerWidth < 768 ? '16px 12px' : '24px', maxWidth: '1200px', margin: '0 auto', boxSizing: 'border-box', width: '100%', overflowX: 'hidden' }}>
        {teamMembers.length === 0 ? (
          <div style={{ 
            background: 'white', 
            borderRadius: '8px', 
            padding: '48px', 
            textAlign: 'center',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>👥</div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600 }}>No team members yet</h3>
            <p style={{ margin: '0 0 24px 0', color: '#64748b' }}>
              Add people to your team so you can assign them to setlists
            </p>
            <button
              onClick={openAddModal}
              style={{
                background: '#0f172a',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: '"Inter", system-ui, sans-serif',
              }}
            >
              Add Your First Person
            </button>
          </div>
        ) : (
          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            {teamMembers.map((member, idx) => (
              <div
                key={member.id}
                style={{
                  borderBottom: idx < teamMembers.length - 1 ? '1px solid #f1f5f9' : 'none',
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = 'white'}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px', color: '#0f172a', flexShrink: 0 }}>
                      {member.name}
                    </span>
                    {member.email && (
                      <span style={{ color: '#94a3b8', fontSize: '12px', flexShrink: 0 }}>{member.email}</span>
                    )}
                    {member.positions && member.positions.length > 0 && (
                      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                        {member.positions.map(pos => (
                          <span key={pos} style={{ background: '#f1f5f9', color: '#64748b', padding: '1px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 500 }}>
                            {pos}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {member.notes && (
                    <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {member.notes}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    onClick={() => openEditModal(member)}
                    style={{ background: '#f1f5f9', color: '#475569', border: 'none', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                    onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                  >Edit</button>
                  <button
                    onClick={() => deleteMember(member.id)}
                    style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '4px 6px', fontSize: '15px', lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                    onMouseLeave={e => e.currentTarget.style.color = '#cbd5e1'}
                  >×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 24px 0', fontSize: '20px', fontWeight: 600 }}>
              {editingMember ? 'Edit Team Member' : 'Add Team Member'}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Name */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="John Doe"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* Email */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="john@example.com"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* Phone */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>
                  Phone
                </label>
                <input
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* Positions */}
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
                  Positions
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {customPositions.map(position => (
                    <button
                      key={position}
                      onClick={() => togglePosition(position)}
                      style={{
                        background: formPositions.includes(position) ? '#0f172a' : '#f1f5f9',
                        color: formPositions.includes(position) ? 'white' : '#475569',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 500
                      }}
                    >
                      {position}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>
                  Notes
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Any additional notes..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* Notification Preference */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>
                  Notifications
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['email', 'none'] as const).map(pref => (
                    <button
                      key={pref}
                      onClick={() => setFormNotifPref(pref)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '6px',
                        border: '1px solid',
                        borderColor: formNotifPref === pref ? '#0f172a' : '#e2e8f0',
                        background: formNotifPref === pref ? '#0f172a' : 'white',
                        color: formNotifPref === pref ? 'white' : '#475569',
                        fontWeight: formNotifPref === pref ? 600 : 400,
                        fontSize: '13px',
                        cursor: 'pointer'
                      }}
                    >
                      {pref === 'email' ? '📧 Email' : '🔕 None'}
                    </button>
                  ))}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                  {formNotifPref === 'email'
                    ? 'Will receive an email when added to a plan'
                    : 'No notifications will be sent'}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveMember}
                disabled={!formName.trim()}
                style={{
                  background: formName.trim() ? '#0f172a' : '#cbd5e1',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: formName.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                {editingMember ? 'Save Changes' : 'Add Person'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Positions Modal */}
      {showManagePositions && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
          onClick={() => setShowManagePositions(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: 600 }}>
              Manage Position Templates
            </h2>
            <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#64748b' }}>
              These positions will be available when adding team to plans
            </p>

            {/* Add new position */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={newCustomPosition}
                  onChange={(e) => setNewCustomPosition(e.target.value)}
                  placeholder="Add new position..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newCustomPosition.trim()) {
                      const newPos = newCustomPosition.trim();
                      if (!customPositions.includes(newPos)) {
                        const updated = [...customPositions, newPos];
                        setCustomPositions(updated);
                        saveCommonPositions(updated);
                      }
                      setNewCustomPosition('');
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                />
                <button
                  onClick={() => {
                    const newPos = newCustomPosition.trim();
                    if (newPos && !customPositions.includes(newPos)) {
                      const updated = [...customPositions, newPos];
                      setCustomPositions(updated);
                      saveCommonPositions(updated);
                      setNewCustomPosition('');
                    }
                  }}
                  disabled={!newCustomPosition.trim() || customPositions.includes(newCustomPosition.trim())}
                  style={{
                    background: newCustomPosition.trim() && !customPositions.includes(newCustomPosition.trim()) ? '#0f172a' : '#cbd5e1',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    cursor: newCustomPosition.trim() && !customPositions.includes(newCustomPosition.trim()) ? 'pointer' : 'not-allowed',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            {/* List of positions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
              {customPositions.map((position, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px',
                    background: '#f8fafc',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0'
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>{position}</span>
                  <button
                    onClick={() => {
                      const updated = customPositions.filter((_, i) => i !== index);
                      setCustomPositions(updated);
                      saveCommonPositions(updated);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#dc2626',
                      cursor: 'pointer',
                      padding: '4px',
                      fontSize: '18px'
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e2e8f0' }}>
              <button
                onClick={() => {
                  const resetConfirm = window.confirm('Reset to default positions? This will remove all custom positions.');
                  if (resetConfirm) {
                    setCustomPositions(DEFAULT_POSITIONS);
                    saveCommonPositions(DEFAULT_POSITIONS);
                  }
                }}
                style={{
                  background: '#f1f5f9',
                  color: '#64748b',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                  marginRight: '12px'
                }}
              >
                Reset to Defaults
              </button>
              <button
                onClick={() => setShowManagePositions(false)}
                style={{
                  background: '#0f172a',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SetlistView({ songs, onBack, onHome, onOpenSong, authUser, selectedPlanId, setSelectedPlanId, respondAssignmentId, onRespondDone, initialPlans, initialGroups, plansLoading, onPlansChange, onNavigate }: {
  songs: SavedSong[];
  onBack: () => void;
  onHome: () => void;
  onOpenSong: (song: SavedSong, setlist: Setlist, index: number) => void;
  authUser?: AuthUser | null;
  selectedPlanId: string | null;
  setSelectedPlanId: (id: string | null) => void;
  respondAssignmentId?: string | null;
  onRespondDone?: () => void;
  initialPlans?: Setlist[];
  initialGroups?: PlanGroup[];
  plansLoading?: boolean;
  onPlansChange?: (plans: Setlist[]) => void;
  onNavigate?: (view: 'home' | 'editor' | 'archive' | 'preview' | 'setlist' | 'team') => void;
}) {
  const FONT_STACK = '"Inter", system-ui, -apple-system, sans-serif';
  const isMobile = window.innerWidth < 768;
  const [plansSubTab, setPlansSubTab] = useState<'plans' | 'team'>('plans');
  const addMemberFnRef = useRef<(() => void) | null>(null);
  const [plans, setPlans] = useState<Setlist[]>(initialPlans || []);
  const [groups, setGroups] = useState<PlanGroup[]>(initialGroups || []);
  const [loading, setLoading] = useState(plansLoading ?? false);

  // Create plan modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanDate, setNewPlanDate] = useState('');
  const [newPlanGroupId, setNewPlanGroupId] = useState<string>('');

  // Create group modal
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // Per-group "show past" toggle
  const [showPastFor, setShowPastFor] = useState<Record<string, boolean>>({});

  const selectedPlan = plans.find(p => p.id === selectedPlanId) || null;

  const formatDate = (date: string | number | undefined) => {
    if (!date) return '';
    const str = typeof date === 'number' ? new Date(date).toISOString() : String(date);
    const parts = str.slice(0, 10).split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m - 1]} ${d}, ${y}`;
  };

  const isPast = (plan: Setlist) => {
    if (!plan.date) return false;
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(plan.date); d.setHours(0,0,0,0);
    return d < today;
  };

  // Sync from app-level pre-loaded data
  useEffect(() => {
    if (initialPlans) setPlans(initialPlans);
  }, [initialPlans]);
  useEffect(() => {
    if (initialGroups) setGroups(initialGroups);
  }, [initialGroups]);
  useEffect(() => {
    setLoading(plansLoading ?? false);
  }, [plansLoading]);

  const createGroup = async () => {
    if (!authUser || !newGroupName.trim()) return;
    try {
      const { data, error } = await supabase.from('plan_groups').insert({
        user_id: authUser.id,
        name: newGroupName.trim(),
        sort_order: groups.length
      }).select().single();
      if (error) throw error;
      const g: PlanGroup = { id: data.id, name: data.name, sortOrder: data.sort_order };
      setGroups([...groups, g]);
      setNewGroupName('');
      setShowCreateGroup(false);
    } catch (err) {
      console.error('Error creating group:', err);
      alert('Failed to create group');
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (!window.confirm('Delete this section? Plans inside will become ungrouped.')) return;
    try {
      // Ungroup all plans in this group
      await supabase.from('setlists').update({ group_id: null }).eq('group_id', groupId);
      await supabase.from('plan_groups').delete().eq('id', groupId);
      setGroups(groups.filter(g => g.id !== groupId));
      setPlans(plans.map(p => p.groupId === groupId ? { ...p, groupId: null } : p));
    } catch (err) {
      console.error('Error deleting group:', err);
    }
  };

  const createPlan = async () => {
    if (!authUser || !newPlanName.trim()) return;
    try {
      const { data, error } = await supabase.from('setlists').insert({
        user_id: authUser.id,
        name: newPlanName.trim(),
        date: newPlanDate || null,
        group_id: newPlanGroupId || null
      }).select().single();
      if (error) throw error;
      const newPlan: Setlist = {
        id: data.id, name: data.name, entries: [],
        createdAt: new Date(data.created_at).getTime(),
        date: data.date || undefined,
        groupId: data.group_id || null
      };
      setPlans([newPlan, ...plans]);
      setShowCreateModal(false);
      setNewPlanName(''); setNewPlanDate(''); setNewPlanGroupId('');
      setSelectedPlanId(newPlan.id);
    } catch (err) {
      console.error('Error creating plan:', err);
      alert('Failed to create plan');
    }
  };

  // Plan detail view
  if (selectedPlanId) {
    if (!selectedPlan) {
      // Always wait while loading - plan will appear once loaded
      return <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontFamily: FONT_STACK }}>Loading…</div>;
    } else {
      return (
        <PlanDetailView
          plan={selectedPlan} songs={songs} groups={groups}
          onBack={() => setSelectedPlanId(null)}
          onHome={onHome} onOpenSong={onOpenSong} authUser={authUser}
          onUpdate={(updated) => setPlans(plans.map(p => p.id === updated.id ? updated : p))}
          onDelete={(id) => { setPlans(plans.filter(p => p.id !== id)); setSelectedPlanId(null); }}
          respondAssignmentId={respondAssignmentId}
          onRespondDone={onRespondDone}
        />
      );
    }
  }

  // Build sections: each named group + ungrouped bucket
  const today = new Date(); today.setHours(0,0,0,0);

  const renderGroup = (groupId: string | null, groupName: string, isUngrouped?: boolean) => {
    const groupPlans = plans.filter(p => (groupId === null ? !p.groupId : p.groupId === groupId));
    if (groupPlans.length === 0 && !isUngrouped) return null;

    const upcoming = groupPlans
      .filter(p => !isPast(p))
      .sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });

    const past = groupPlans
      .filter(p => isPast(p))
      .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime());

    const showPast = showPastFor[groupId ?? '__ungrouped'];

    if (groupPlans.length === 0 && isUngrouped) return null;

    return (
      <div key={groupId ?? 'ungrouped'} style={{ marginBottom: 32 }}>
        {/* Group header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{groupName}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {past.length > 0 && (
              <button
                onClick={() => setShowPastFor(prev => ({ ...prev, [groupId ?? '__ungrouped']: !showPast }))}
                style={{ fontSize: '13px', fontWeight: 500, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#0f172a'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#64748b'; }}
              >
                {showPast ? 'Hide past' : `${past.length} past`}
              </button>
            )}
            {!isUngrouped && groupId && (
              <button
                onClick={() => deleteGroup(groupId)}
                title="Delete section"
                style={{ fontSize: '16px', color: '#cbd5e1', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, lineHeight: 1, transition: 'color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={e => e.currentTarget.style.color = '#cbd5e1'}
              >×</button>
            )}
          </div>
        </div>

        {/* Plans */}
        {upcoming.length === 0 && !showPast ? (
          <div style={{ color: '#94a3b8', fontSize: '14px', padding: '16px 0', fontStyle: 'italic' }}>
            No upcoming plans
          </div>
        ) : (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: 'white' }}>
            {upcoming.map(plan => (
              <PlanCard key={plan.id} plan={plan} onClick={() => setSelectedPlanId(plan.id)} formatDate={formatDate} />
            ))}
            {showPast && past.map(plan => (
              <PlanCard key={plan.id} plan={plan} onClick={() => setSelectedPlanId(plan.id)} formatDate={formatDate} isPast />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: FONT_STACK, paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0, paddingBottom: isMobile ? 'calc(52px + env(safe-area-inset-bottom))' : 0 }}>
      {isMobile && <BottomTabBar activeTab="setlist" onTab={tab => { if (onNavigate) onNavigate(tab); else onHome(); }} authUser={authUser} actions={
        plansSubTab === 'plans' ? [
          { label: '📋  New Plan', onPress: () => setShowCreateModal(true), primary: true },
          { label: '📁  New Section', onPress: () => setShowCreateGroup(true) },
        ] : [
          { label: '👤  Add Member', onPress: () => addMemberFnRef.current?.(), primary: true },
        ]
      } />}
      <AppBar onHome={onHome}
        backButton={<button onClick={onBack} style={APP_BAR_BTN} onMouseEnter={e => e.currentTarget.style.backgroundColor='#f1f5f9'} onMouseLeave={e => e.currentTarget.style.backgroundColor='#ffffff'}>← Back</button>}
        centerContent={<span style={{ fontWeight: 700, fontSize: '17px', color: '#0f172a', letterSpacing: '-0.02em' }}>{plansSubTab === 'plans' ? 'Plans' : 'Team'}</span>}>
        {plansSubTab === 'plans' ? (<>
          <button onClick={() => setShowCreateGroup(true)}
            style={APP_BAR_BTN}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#ffffff'}
          >+ Section</button>
          <button onClick={() => setShowCreateModal(true)}
            style={APP_BAR_BTN_PRIMARY}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#1e293b'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#0f172a'}
          >+ New Plan</button>
        </>) : null}
      </AppBar>

      <div style={{ padding: isMobile ? '16px 12px' : '32px 24px', maxWidth: '900px', margin: '0 auto', boxSizing: 'border-box', width: '100%', overflowX: 'hidden' }}>

        {/* Sub-tab switcher */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, backgroundColor: '#f1f5f9', borderRadius: 10, padding: 3, maxWidth: isMobile ? '100%' : 240 }}>
          {(['plans', 'team'] as const).map(t => (
              <button key={t} onClick={() => setPlansSubTab(t)} style={{
                flex: 1, padding: '8px 0', fontSize: '14px', fontWeight: plansSubTab === t ? 700 : 500,
                border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: '-apple-system, system-ui, sans-serif',
                backgroundColor: plansSubTab === t ? 'white' : 'transparent',
                color: plansSubTab === t ? '#0f172a' : '#64748b',
                boxShadow: plansSubTab === t ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}>
                {t === 'plans' ? '🗓️  Plans' : '👤  Team'}
              </button>
            ))}
          </div>

        {/* Team tab — renders TeamManagement inline */}
        {plansSubTab === 'team' && authUser && (
          <TeamManagement authUser={authUser} onBack={() => setPlansSubTab('plans')} onNavigate={onNavigate} inline onAddMemberRef={fn => { addMemberFnRef.current = fn; }} />
        )}

        {/* Plans content — hidden when team tab active */}
        {plansSubTab === 'plans' && (
        <>
          {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>Loading…</div>
        ) : groups.length === 0 && plans.length === 0 ? (
          <div style={{ background: 'white', borderRadius: '12px', padding: '60px 48px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '40px', marginBottom: 16 }}>📋</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 700 }}>No plans yet</h3>
            <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: '15px' }}>Create a section like "Sunday Service" to get started, then add plans inside it.</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button onClick={() => setShowCreateGroup(true)}
                style={{ background: 'white', color: '#0f172a', border: '1px solid #cbd5e1', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}
              >+ Create Section</button>
              <button onClick={() => setShowCreateModal(true)}
                style={{ background: '#0f172a', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}
              >+ New Plan</button>
            </div>
          </div>
        ) : (
          <>
            {groups.map(g => renderGroup(g.id, g.name))}
            {renderGroup(null, 'Other', true)}
          </>
        )}
        </>
        )} {/* end plans tab */}
      </div> {/* end padding wrapper */}

      {/* Create Section Modal */}
      {showCreateGroup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={() => setShowCreateGroup(false)}>
          <div style={{ background: 'white', borderRadius: 12, padding: 28, maxWidth: 440, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 20px', fontSize: '20px', fontWeight: 700 }}>New Section</h2>
            <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '14px' }}>Sections let you group plans by service type, e.g. "Sunday Service", "Youth Group", "Album".</p>
            <input
              autoFocus type="text" value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createGroup()}
              placeholder="e.g. Sunday Service"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: '15px', fontFamily: FONT_STACK, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', marginBottom: 20 }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreateGroup(false)}
                style={{ padding: '9px 18px', fontSize: '14px', fontWeight: 600, background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer', color: '#334155' }}>
                Cancel
              </button>
              <button onClick={createGroup} disabled={!newGroupName.trim()}
                style={{ padding: '9px 18px', fontSize: '14px', fontWeight: 600, background: newGroupName.trim() ? '#0f172a' : '#cbd5e1', color: 'white', border: 'none', borderRadius: 8, cursor: newGroupName.trim() ? 'pointer' : 'not-allowed' }}>
                Create Section
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Plan Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={() => setShowCreateModal(false)}>
          <div style={{ background: 'white', borderRadius: 12, padding: 28, maxWidth: 480, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 24px', fontSize: '20px', fontWeight: 700 }}>New Plan</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '14px', fontWeight: 600, color: '#334155' }}>Plan Name *</label>
                <input autoFocus type="text" value={newPlanName} onChange={e => setNewPlanName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createPlan()}
                  placeholder="e.g. Mar 2 Service"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: '15px', fontFamily: FONT_STACK, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }} />
              </div>
              {groups.length > 0 && (
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: '14px', fontWeight: 600, color: '#334155' }}>Section</label>
                  <select value={newPlanGroupId} onChange={e => setNewPlanGroupId(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', fontSize: '15px', fontFamily: FONT_STACK, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: 'white' }}>
                    <option value="">No section</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '14px', fontWeight: 600, color: '#334155' }}>Date</label>
                <input type="date" value={newPlanDate} onChange={e => setNewPlanDate(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: '15px', fontFamily: FONT_STACK, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
              <button onClick={() => setShowCreateModal(false)}
                style={{ padding: '9px 18px', fontSize: '14px', fontWeight: 600, background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer', color: '#334155' }}>
                Cancel
              </button>
              <button onClick={createPlan} disabled={!newPlanName.trim()}
                style={{ padding: '9px 18px', fontSize: '14px', fontWeight: 600, background: newPlanName.trim() ? '#0f172a' : '#cbd5e1', color: 'white', border: 'none', borderRadius: 8, cursor: newPlanName.trim() ? 'pointer' : 'not-allowed' }}>
                Create Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Plan Card Component
function PlanCard({ plan, onClick, formatDate, isPast }: {
  plan: Setlist;
  onClick: () => void;
  formatDate: (date: string | number | undefined) => string;
  isPast?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'white',
        borderBottom: '1px solid #f1f5f9',
        padding: '12px 16px',
        cursor: 'pointer',
        transition: 'background 0.15s',
        opacity: isPast ? 0.55 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
    >
      <span style={{ fontWeight: 600, fontSize: '14px', color: '#0f172a', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{plan.name}</span>
      {plan.date && (
        <span style={{ color: '#64748b', fontSize: '13px', flexShrink: 0 }}>{formatDate(plan.date)}</span>
      )}
      <span style={{
        background: '#f1f5f9',
        color: '#64748b',
        padding: '2px 9px',
        borderRadius: '10px',
        fontSize: '12px',
        fontWeight: 500,
        flexShrink: 0
      }}>
        {plan.entries.length} {plan.entries.length === 1 ? 'song' : 'songs'}
      </span>
      <span style={{ color: '#cbd5e1', fontSize: '14px', flexShrink: 0 }}>›</span>
    </div>
  );
}

// AddSongsModal: full-screen archive-style multi-select song picker
function AddSongsModal({ allSongs, authUser, existingIds, onConfirm, onClose }: {
  allSongs: SavedSong[];
  authUser?: AuthUser | null;
  existingIds: Set<string>;
  onConfirm: (selections: { song: SavedSong; key: string }[]) => void;
  onClose: () => void;
}) {
  const FONT_STACK = '"Inter", system-ui, -apple-system, sans-serif';
  const KEY_LIST = ['A','Bb','B','C','Db','D','Eb','E','F','F#','G','Ab'];

  const [tab, setTab] = React.useState<'public' | 'mine'>('public');
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Map<string, string>>(new Map()); // songId -> key
  const [pendingKeys, setPendingKeys] = React.useState<Record<string, string>>({}); // songId -> chosen key before selection
  const [favoriteKeys, setFavoriteKeys] = React.useState<Record<string, string>>({});
  const [sortCol, setSortCol] = React.useState<'title' | 'key' | 'bpm' | 'writers'>('title');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  // Load all favorite keys for this user at once
  React.useEffect(() => {
    if (!authUser) return;
    supabase
      .from('favorite_keys')
      .select('song_id, favorite_key')
      .eq('user_id', authUser.id)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, string> = {};
          data.forEach((r: any) => { map[r.song_id] = r.favorite_key; });
          setFavoriteKeys(map);
        }
      });
  }, [authUser?.id]);

  // Keyboard: Enter to confirm
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && selected.size > 0) handleConfirm();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected]);

  const tabSongs = authUser && tab === 'mine'
    ? allSongs.filter(s => s.userId === authUser.id)
    : allSongs.filter(s => s.userId === null);

  const filteredSongs = search.trim()
    ? tabSongs.filter(s => {
        const q = search.toLowerCase();
        return (s.title || '').toLowerCase().includes(q) || (s.writers || '').toLowerCase().includes(q);
      })
    : tabSongs;

  const sortedSongs = [...filteredSongs].sort((a, b) => {
    if (sortCol === 'bpm') {
      const aNum = parseFloat(a.bpm) || 0;
      const bNum = parseFloat(b.bpm) || 0;
      return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
    }
    const aStr = (sortCol === 'key' ? a.key : sortCol === 'writers' ? a.writers : a.title) || '';
    const bStr = (sortCol === 'key' ? b.key : sortCol === 'writers' ? b.writers : b.title) || '';
    return sortDir === 'asc'
      ? aStr.toLowerCase().localeCompare(bStr.toLowerCase(), undefined, { sensitivity: 'base' })
      : bStr.toLowerCase().localeCompare(aStr.toLowerCase(), undefined, { sensitivity: 'base' });
  });

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const toggleSong = (song: SavedSong) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(song.id)) {
        next.delete(song.id);
      } else {
        // Use pending key if set, else original key (favorite key intentionally excluded in plan context)
        const key = pendingKeys[song.id] || normalizeDisplayKey(song.key);
        next.set(song.id, key);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selections = Array.from(selected.entries()).map(([id, key]) => ({
      song: allSongs.find(s => s.id === id)!,
      key
    })).filter(s => s.song);
    onConfirm(selections);
  };

  const getTempoStyle = (bpm: string): { bg: string; color: string } => {
    const val = parseFloat(bpm);
    if (!val) return { bg: '#f1f5f9', color: '#64748b' };
    const slow = 60, fast = 160;
    const t = Math.max(0, Math.min(1, (val - slow) / (fast - slow)));
    let r, g, b;
    if (t < 0.5) { r = 239; g = Math.round(68 + t * 2 * 130); b = 68; }
    else { r = Math.round(234 - (t - 0.5) * 2 * 160); g = 179; b = 8; }
    return { bg: `rgba(${r},${g},${b},0.15)`, color: `rgb(${Math.round(r*0.8)},${Math.round(g*0.8)},${Math.round(b*0.6)})` };
  };

  const SortHeader = ({ col, label }: { col: typeof sortCol; label: string }) => {
    const active = sortCol === col;
    return (
      <th onClick={() => handleSort(col)} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: '#475569', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
        {label}
        <span style={{ marginLeft: 6, opacity: active ? 1 : 0.25, fontSize: '10px', color: '#64748b' }}>
          {active && sortDir === 'desc' ? '▲' : '▼'}
        </span>
      </th>
    );
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'stretch', justifyContent: 'center', fontFamily: FONT_STACK }}
      onClick={onClose}
    >
      <div
        style={{ background: '#f8fafc', width: '100%', maxWidth: '900px', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '0 24px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748b', padding: '4px 8px', lineHeight: 1 }}>✕</button>
              <span style={{ fontWeight: 700, fontSize: '17px', color: '#0f172a', letterSpacing: '-0.02em' }}>Add Songs</span>
            </div>
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0}
              style={{
                background: selected.size > 0 ? '#0f172a' : '#cbd5e1',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 8,
                cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
                fontSize: '14px',
                fontWeight: 700,
                transition: 'all 0.2s',
                minWidth: 160
              }}
            >
              {selected.size > 0 ? `Add ${selected.size} Song${selected.size === 1 ? '' : 's'} ↵` : 'Select songs below'}
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, borderTop: '1px solid #f1f5f9' }}>
            {(['public', 'mine'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: 'none', border: 'none', padding: '10px 20px', cursor: 'pointer',
                fontSize: '14px', fontWeight: tab === t ? 700 : 500,
                color: tab === t ? '#0f172a' : '#64748b',
                borderBottom: tab === t ? '2px solid #0f172a' : '2px solid transparent',
                marginBottom: -1, transition: 'all 0.15s'
              }}>
                {t === 'public' ? 'Public Archive' : 'My Archive'}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '16px 24px', background: 'white', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '18px', pointerEvents: 'none' }}>⌕</span>
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search songs or writers…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px 12px 42px', fontSize: '15px', fontFamily: FONT_STACK, border: '1px solid #cbd5e1', borderRadius: 10, outline: 'none', backgroundColor: '#f8fafc', color: '#0f172a' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#0f172a'; e.currentTarget.style.background = 'white'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = '#f8fafc'; }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '16px', padding: 4 }}>✕</button>
            )}
          </div>
        </div>

        {/* Song table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sortedSongs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 24px', color: '#64748b' }}>
              <div style={{ fontSize: '36px', marginBottom: 12 }}>🎵</div>
              <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: 6, color: '#0f172a' }}>
                {search ? 'No songs found' : 'No songs yet'}
              </div>
              <div style={{ fontSize: '14px' }}>
                {search ? `No results for "${search}"` : 'This archive is empty.'}
              </div>
            </div>
          ) : (
            <div style={{ backgroundColor: 'white', borderTop: '1px solid #e2e8f0' }}>
              {/* Table header */}
              <div style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', position: 'sticky', top: 0, zIndex: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', fontFamily: FONT_STACK, tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '44px' }} />
                    <col style={{ width: '36%' }} />
                    <col style={{ width: '70px' }} />
                    <col style={{ width: '70px' }} />
                    <col />
                    <col style={{ width: '120px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ padding: '12px 8px 12px 16px' }}></th>
                      <SortHeader col="title" label="Title" />
                      <SortHeader col="key" label="Key" />
                      <SortHeader col="bpm" label="BPM" />
                      <SortHeader col="writers" label="Writers" />
                      <th style={{ padding: '12px 16px', fontWeight: 600, color: '#475569', fontSize: '13px', textAlign: 'left' }}>Add In Key</th>
                    </tr>
                  </thead>
                </table>
              </div>

              {/* Table body */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontFamily: FONT_STACK, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '44px' }} />
                  <col style={{ width: '36%' }} />
                  <col style={{ width: '70px' }} />
                  <col style={{ width: '70px' }} />
                  <col />
                  <col style={{ width: '120px' }} />
                </colgroup>
                <tbody>
                  {sortedSongs.map(song => {
                    const isSelected = selected.has(song.id);
                    const alreadyIn = existingIds.has(song.id);
                    const ts = getTempoStyle(song.bpm);
                    const selectedKey = selected.get(song.id) || pendingKeys[song.id] || normalizeDisplayKey(song.key);

                    return (
                      <tr
                        key={song.id}
                        onMouseDown={e => {
                          if (alreadyIn) return;
                          e.preventDefault();
                          toggleSong(song);
                        }}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          cursor: alreadyIn ? 'default' : 'pointer',
                          backgroundColor: isSelected ? '#f0fdf4' : alreadyIn ? '#fafafa' : 'transparent',
                          transition: 'background-color 0.15s',
                          opacity: alreadyIn ? 0.5 : 1
                        }}
                        onMouseEnter={e => { if (!alreadyIn && !isSelected) e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                        onMouseLeave={e => { if (!alreadyIn && !isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        {/* Checkbox */}
                        <td style={{ padding: '14px 8px 14px 16px', verticalAlign: 'middle' }}>
                          {alreadyIn ? (
                            <span style={{ fontSize: '16px', color: '#94a3b8' }} title="Already in plan">✓</span>
                          ) : (
                            <div style={{
                              width: 20, height: 20, borderRadius: 5,
                              border: isSelected ? 'none' : '2px solid #cbd5e1',
                              background: isSelected ? '#0f172a' : 'white',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0, transition: 'all 0.15s'
                            }}>
                              {isSelected && <span style={{ color: 'white', fontSize: '12px', fontWeight: 700, lineHeight: 1 }}>✓</span>}
                            </div>
                          )}
                        </td>

                        {/* Title */}
                        <td style={{ padding: '14px 8px', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {song.title}
                        </td>

                        {/* Key */}
                        <td style={{ padding: '14px 8px', color: '#334155', fontSize: '14px', fontWeight: 600 }}>
                          {song.key}
                        </td>

                        {/* BPM */}
                        <td style={{ padding: '14px 8px' }}>
                          {song.bpm ? (
                            <span style={{ display: 'inline-block', padding: '3px 7px', borderRadius: 5, fontSize: '12px', fontWeight: 600, backgroundColor: ts.bg, color: ts.color }}>
                              {song.bpm}
                            </span>
                          ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                        </td>

                        {/* Writers */}
                        <td style={{ padding: '14px 8px', color: '#64748b', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {song.writers || '—'}
                        </td>

                        {/* Key selector */}
                        <td style={{ padding: '14px 16px 14px 8px' }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                          {!alreadyIn && (
                            <select
                              value={selectedKey}
                              onChange={e => {
                                const newKey = e.target.value;
                                if (selected.has(song.id)) {
                                  setSelected(prev => { const next = new Map(prev); next.set(song.id, newKey); return next; });
                                }
                                setPendingKeys(prev => ({ ...prev, [song.id]: newKey }));
                              }}
                              style={{
                                border: '1px solid #cbd5e1',
                                borderRadius: 6,
                                padding: '4px 6px',
                                fontSize: '13px',
                                fontWeight: 600,
                                color: '#0f172a',
                                background: isSelected ? 'white' : '#f8fafc',
                                cursor: 'pointer',
                                width: '100%'
                              }}
                            >
                              {KEY_LIST.map(k => (
                                <option key={k} value={k}>
                                  {k}{k === song.key ? ' (orig)' : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sticky bottom confirm bar */}
        {selected.size > 0 && (
          <div style={{ background: '#0f172a', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px' }}>
              {selected.size} song{selected.size === 1 ? '' : 's'} selected
            </span>
            <button
              onClick={handleConfirm}
              style={{ background: 'white', color: '#0f172a', border: 'none', padding: '10px 28px', borderRadius: 8, cursor: 'pointer', fontSize: '14px', fontWeight: 700, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.2)' }}
            >
              Add {selected.size} Song{selected.size === 1 ? '' : 's'} ↵
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Plan Detail View Component
// Shared tempo color utility
function getTempoStyle(bpm: string): { bg: string; color: string } {
  const b = parseInt(bpm, 10);
  if (isNaN(b)) return { bg: '#f1f5f9', color: '#64748b' };
  if (b < 70)  return { bg: '#eff6ff', color: '#1d4ed8' };
  if (b < 100) return { bg: '#f0fdf4', color: '#15803d' };
  if (b < 130) return { bg: '#fefce8', color: '#a16207' };
  if (b < 160) return { bg: '#fff7ed', color: '#c2410c' };
  return { bg: '#fef2f2', color: '#b91c1c' };
}

// Inline add-element widget: a small text input that expands on focus
function AddElementInline({ onAdd }: { onAdd: (label: string) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const [value, setValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const FONT_STACK = '"Inter", system-ui, -apple-system, sans-serif';

  const commit = () => {
    if (value.trim()) { onAdd(value.trim()); setValue(''); }
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <button
        onClick={() => { setExpanded(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        style={{ ...APP_BAR_BTN }}
        onMouseEnter={e => e.currentTarget.style.backgroundColor='#f1f5f9'}
        onMouseLeave={e => e.currentTarget.style.backgroundColor='#ffffff'}
      >+ Item</button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setExpanded(false); setValue(''); } }}
        placeholder="e.g. Welcome, Offering…"
        style={{ padding: '6px 10px', fontSize: '13px', border: '1px solid #0f172a', borderRadius: 7, outline: 'none', fontFamily: FONT_STACK, width: 170 }}
      />
    </div>
  );
}

function PlanDetailView({ plan, songs, groups, onBack, onHome, onOpenSong, authUser, onUpdate, onDelete, respondAssignmentId, onRespondDone }: {
  plan: Setlist;
  songs: SavedSong[];
  groups: PlanGroup[];
  onBack: () => void;
  onHome: () => void;
  onOpenSong: (song: SavedSong, setlist: Setlist, index: number) => void;
  authUser?: AuthUser | null;
  onUpdate: (plan: Setlist) => void;
  onDelete: (id: string) => void;
  respondAssignmentId?: string | null;
  onRespondDone?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'team'>('overview');
  const [editingElementIdx, setEditingElementIdx] = useState<number | null>(null);
  const [editingNoteIdx, setEditingNoteIdx] = useState<number | null>(null);
  const [elementDraft, setElementDraft] = useState('');
  const [entryNotes, setEntryNotes] = useState<Record<number, string>>({});
  const [showAddSong, setShowAddSong] = useState(false);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [showAssignPerson, setShowAssignPerson] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState(plan.name);
  const [planNotes, setPlanNotes] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [assignments, setAssignments] = useState<SetlistAssignment[]>([]);
  const [emptyPositions, setEmptyPositions] = useState<string[]>([]); // Positions without people
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [newPositionName, setNewPositionName] = useState('');
  const [sendingNotifications, setSendingNotifications] = useState(false);
  const [respondStatus, setRespondStatus] = useState<'pending' | 'accepted' | 'declined' | null>(null);
  const [respondingPlan, setRespondingPlan] = useState(false);

  // Load current status of the respond assignment if we arrived via a link
  useEffect(() => {
    if (!respondAssignmentId) return;
    (async () => {
      const token = (await store.get('auth_token')) || '';
      fetch(`${SUPABASE_URL}/rest/v1/setlist_assignments?id=eq.${respondAssignmentId}&select=status`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(data => { if (data?.[0]?.status) setRespondStatus(data[0].status); })
        .catch(console.error);
    })();
  }, [respondAssignmentId]);

  const handleRespond = async (status: 'accepted' | 'declined') => {
    if (!respondAssignmentId) return;
    setRespondingPlan(true);
    try {
      const token = (await store.get('auth_token')) || '';
      const res = await fetch(`${SUPABASE_URL}/rest/v1/setlist_assignments?id=eq.${respondAssignmentId}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRespondStatus(status);
      if (onRespondDone) onRespondDone();
    } catch (err) {
      console.error(err);
      alert('Failed to save response. Please try again.');
    } finally {
      setRespondingPlan(false);
    }
  };

  const sendNotifications = async () => {
    if (!authUser) return;

    // Build list of assigned members who want email notifications
    const recipients: { name: string; email: string; position: string; assignmentId: string }[] = [];
    for (const assignment of assignments) {
      const member = assignment.team_member || teamMembers.find(m => m.id === assignment.team_member_id);
      if (!member) continue;
      if (member.notification_preference === 'none') continue;
      if (!member.email) continue;
      recipients.push({ name: member.name, email: member.email, position: assignment.position, assignmentId: assignment.id });
    }

    if (recipients.length === 0) {
      alert('No assigned team members have an email address and notifications enabled.');
      return;
    }

    setSendingNotifications(true);
    try {
      const songList = plan.entries.map((entry, i) => {
        const song = songs.find(s => s.id === entry.songId);
        return song ? `${i + 1}. ${song.title} — ${entry.displayKey}` : null;
      }).filter(Boolean).join('\n');

      const planDate = plan.date ? new Date(plan.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : null;

      let res: Response;
      try {
        res = await fetch(`${SUPABASE_URL}/functions/v1/notify-plan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
          },
          body: JSON.stringify({
            planName: plan.name,
            planDate,
            songList,
            recipients,
            appUrl: window.location.origin + window.location.pathname,
          }),
        });
      } catch (networkErr: any) {
        throw new Error(`Network error — is the edge function deployed? (${networkErr.message})`);
      }

      const rawText = await res.text();
      console.log('notify-plan response:', res.status, rawText);
      let result: any = {};
      try { result = JSON.parse(rawText); } catch { result = { error: rawText || `HTTP ${res.status} empty response` }; }
      if (!res.ok) throw new Error(result.error || result.errors?.join('\n') || `HTTP ${res.status}: ${rawText}`);

      const sent = result.sent ?? recipients.length;
      if (result.errors && result.errors.length > 0) {
        alert(`Sent ${sent} notification${sent === 1 ? '' : 's'}.\n\nFailed:\n${result.errors.join('\n')}`);
      } else {
        alert(`Notifications sent to ${sent} team member${sent === 1 ? '' : 's'}.`);
      }
    } catch (err: any) {
      console.error('Error sending notifications:', err);
      alert(`Failed to send notifications:\n\n${err.message}`);
    } finally {
      setSendingNotifications(false);
    }
  };

  const KEY_LIST = ['A','Bb','B','C','Db','D','Eb','E','F','F#','G','Ab'];
  const [availablePositions, setAvailablePositions] = useState<string[]>(COMMON_POSITIONS);
  useEffect(() => { getCommonPositions().then(setAvailablePositions); }, []);

  // Drag-and-drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragSaving, setDragSaving] = useState(false);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  // Leader per entry (index → name), saved to DB on blur
  const [leaders, setLeaders] = useState<Record<number, string>>({});

  const updatePlanGroup = async (newGroupId: string | null) => {
    if (!authUser) return;
    try {
      await supabase
        .from('setlists')
        .update({ group_id: newGroupId })
        .eq('id', plan.id);
      onUpdate({ ...plan, groupId: newGroupId });
    } catch (err) {
      console.error('Error updating plan section:', err);
    }
  };

  // Initialise leaders and notes from plan entries whenever plan changes
  useEffect(() => {
    const leaderMap: Record<number, string> = {};
    const noteMap: Record<number, string> = {};
    plan.entries.forEach((e, i) => {
      leaderMap[i] = e.leader || '';
      noteMap[i] = e.entryNote || '';
    });
    setLeaders(leaderMap);
    setEntryNotes(noteMap);
  }, [plan.id, plan.entries.length]);

  const updateLeader = async (index: number, value: string) => {
    if (!authUser) return;
    try {
      await supabase
        .from('setlist_entries')
        .update({ leader: value })
        .eq('setlist_id', plan.id)
        .eq('position', index);
      const newEntries = plan.entries.map((en, i) => i === index ? { ...en, leader: value } : en);
      onUpdate({ ...plan, entries: newEntries });
    } catch (err) {
      console.error('Error updating leader:', err);
    }
  };

  const updateEntryNote = async (index: number, value: string) => {
    if (!authUser) return;
    try {
      await supabase
        .from('setlist_entries')
        .update({ notes: value })
        .eq('setlist_id', plan.id)
        .eq('position', index);
      const newEntries = plan.entries.map((en, i) => i === index ? { ...en, entryNote: value } : en);
      onUpdate({ ...plan, entries: newEntries });
    } catch (err) {
      console.error('Error updating entry note:', err);
    }
  };

  // Load team members and assignments
  useEffect(() => {
    loadTeamData();
  }, [authUser, plan.id]);

  const loadTeamData = async () => {
    if (!authUser) return;
    setLoadingTeam(true);
    try {
      // Load team members
      const { data: membersData, error: membersError } = await supabase
        .from('team_members')
        .select('*')
        .eq('user_id', authUser.id);
      
      if (membersError) throw membersError;
      setTeamMembers(membersData || []);

      // Load assignments for this plan
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('setlist_assignments')
        .select('*, team_member:team_members(*)')
        .eq('setlist_id', plan.id);
      
      if (assignmentsError) throw assignmentsError;
      setAssignments(assignmentsData || []);
    } catch (err) {
      console.error('Error loading team data:', err);
    } finally {
      setLoadingTeam(false);
    }
  };

  const updatePlanName = async () => {
    if (!authUser || !editName.trim() || editName === plan.name) {
      setEditingName(false);
      return;
    }

    try {
      const { error } = await supabase
        .from('setlists')
        .update({ name: editName.trim() })
        .eq('id', plan.id);
      
      if (error) throw error;
      
      onUpdate({ ...plan, name: editName.trim() });
      setEditingName(false);
    } catch (err) {
      console.error('Error updating plan name:', err);
      alert('Failed to update plan name');
    }
  };

  const deletePlan = async () => {
    if (!window.confirm('Delete this plan? This cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('setlists')
        .delete()
        .eq('id', plan.id);
      
      if (error) throw error;
      onDelete(plan.id);
    } catch (err) {
      console.error('Error deleting plan:', err);
      alert('Failed to delete plan');
    }
  };

  const addSongsToPlan = async (selections: { song: SavedSong; key: string }[]) => {
    if (!authUser || selections.length === 0) return;

    try {
      const startPos = plan.entries.length;
      const inserts = selections.map((s, i) => ({
        setlist_id: plan.id,
        song_id: s.song.id,
        display_key: s.key,
        position: startPos + i
      }));

      const { error } = await supabase
        .from('setlist_entries')
        .insert(inserts);

      if (error) throw error;

      const newEntries = selections.map(s => ({ songId: s.song.id, displayKey: s.key }));
      const updated = { ...plan, entries: [...plan.entries, ...newEntries] };
      onUpdate(updated);
      setShowAddSong(false);
    } catch (err) {
      console.error('Error adding songs:', err);
      alert('Failed to add songs');
    }
  };

  const addSongToPlan = async (song: SavedSong, displayKey: string) => {
    return addSongsToPlan([{ song, key: displayKey }]);
  };

  // Add a custom plan element (heading, break, etc.)
  const addElement = async (label: string) => {
    if (!authUser || !label.trim()) return;
    try {
      const pos = plan.entries.length;
      const { error } = await supabase
        .from('setlist_entries')
        .insert({ setlist_id: plan.id, song_id: '__element__', display_key: label.trim(), position: pos });
      if (error) throw error;
      onUpdate({ ...plan, entries: [...plan.entries, { songId: '__element__', displayKey: label.trim() }] });
    } catch (err) {
      console.error('Error adding element:', err);
    }
  };

  const updateElementLabel = async (index: number, label: string) => {
    if (!authUser || !label.trim()) return;
    try {
      await supabase
        .from('setlist_entries')
        .update({ display_key: label.trim() })
        .eq('setlist_id', plan.id)
        .eq('position', index);
      const newEntries = plan.entries.map((e, i) => i === index ? { ...e, displayKey: label.trim() } : e);
      onUpdate({ ...plan, entries: newEntries });
    } catch (err) {
      console.error('Error updating element:', err);
    }
  };

  const removeEntry = async (index: number) => {
    if (!authUser) return;
    try {
      await supabase
        .from('setlist_entries')
        .delete()
        .eq('setlist_id', plan.id)
        .eq('position', index);
      const newEntries = plan.entries.filter((_, i) => i !== index);
      await Promise.all(newEntries.map((e, i) =>
        supabase.from('setlist_entries').update({ position: i })
          .eq('setlist_id', plan.id)
          .eq('song_id', e.songId)
          .eq('display_key', e.displayKey)
      ));
      onUpdate({ ...plan, entries: newEntries });
    } catch (err) {
      console.error('Error removing entry:', err);
      alert('Failed to remove item');
    }
  };

  const reorderEntries = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || !authUser) return;
    setDragSaving(true);
    try {
      const newEntries = [...plan.entries];
      const [moved] = newEntries.splice(fromIndex, 1);
      newEntries.splice(toIndex, 0, moved);
      onUpdate({ ...plan, entries: newEntries });
      await Promise.all(
        newEntries.map((entry, i) =>
          supabase.from('setlist_entries').update({ position: i })
            .eq('setlist_id', plan.id)
            .eq('song_id', entry.songId)
            .eq('display_key', entry.displayKey)
        )
      );
    } catch (err) {
      console.error('Error reordering:', err);
    } finally {
      setDragSaving(false);
    }
  };

  const addPosition = async () => {
    if (!newPositionName.trim()) return;

    // Add to local state - will be saved to DB when someone is assigned
    setEmptyPositions([...emptyPositions, newPositionName.trim()]);
    setNewPositionName('');
    setShowAddPosition(false);
  };

  const assignPersonToPosition = async (positionOrAssignmentId: string, memberId: string) => {
    try {
      // Check if this is an empty position (index as string) or existing assignment ID
      const emptyPosIndex = parseInt(positionOrAssignmentId);
      
      if (!isNaN(emptyPosIndex) && emptyPosIndex >= 0 && emptyPosIndex < emptyPositions.length) {
        // This is an empty position - create new assignment
        const position = emptyPositions[emptyPosIndex];
        
        const { data, error } = await supabase
          .from('setlist_assignments')
          .insert({
            setlist_id: plan.id,
            team_member_id: memberId,
            position: position,
            status: 'pending'
          })
          .select('*, team_member:team_members(*)')
          .single();
        
        if (error) throw error;
        
        // Remove from empty positions and add to assignments
        setEmptyPositions(emptyPositions.filter((_, i) => i !== emptyPosIndex));
        setAssignments([...assignments, data]);
      } else {
        // This is an existing assignment - update it
        const { data, error } = await supabase
          .from('setlist_assignments')
          .update({ team_member_id: memberId })
          .eq('id', positionOrAssignmentId)
          .select('*, team_member:team_members(*)')
          .single();
        
        if (error) throw error;
        
        setAssignments(assignments.map(a => a.id === positionOrAssignmentId ? data : a));
      }
      
      setShowAssignPerson(false);
      setSelectedPosition(null);
    } catch (err) {
      console.error('Error assigning person:', err);
      alert('Failed to assign person');
    }
  };

  const removeEmptyPosition = (index: number) => {
    setEmptyPositions(emptyPositions.filter((_, i) => i !== index));
  };

  const removeAssignment = async (assignmentId: string) => {
    try {
      const { error } = await supabase
        .from('setlist_assignments')
        .delete()
        .eq('id', assignmentId);
      
      if (error) throw error;
      
      setAssignments(assignments.filter(a => a.id !== assignmentId));
    } catch (err) {
      console.error('Error removing assignment:', err);
      alert('Failed to remove assignment');
    }
  };

  const clearPersonFromPosition = async (assignmentId: string) => {
    try {
      const { data, error } = await supabase
        .from('setlist_assignments')
        .update({ team_member_id: null })
        .eq('id', assignmentId)
        .select('*')
        .single();
      
      if (error) throw error;
      
      setAssignments(assignments.map(a => a.id === assignmentId ? data : a));
    } catch (err) {
      console.error('Error clearing assignment:', err);
      alert('Failed to clear assignment');
    }
  };

  // Get songs with their details
  const planSongs = plan.entries
    .map(entry => ({
      entry,
      song: songs.find(s => s.id === entry.songId)
    }))
    .filter(item => item.song);

  const FONT_STACK = '"Inter", system-ui, -apple-system, sans-serif';
  const isMobile = window.innerWidth < 768;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: FONT_STACK, paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0, paddingBottom: isMobile ? 'calc(52px + env(safe-area-inset-bottom))' : 0 }}>
      {isMobile && <BottomTabBar activeTab="setlist" onTab={tab => { if (tab === 'archive') onHome(); else onBack(); }} authUser={authUser} />}
      {/* Mobile top bar — back + plan name */}
      {isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 10px', borderBottom: '0.5px solid #e2e8f0', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 40 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', fontSize: '17px', color: '#0f172a', fontFamily: FONT_STACK, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: '20px', lineHeight: 1 }}>‹</span>
            <span style={{ fontSize: '15px', fontWeight: 500 }}>Plans</span>
          </button>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{plan.name}</span>
            {plan.date && (() => {
              const parts = plan.date.split('-');
              const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              return <span style={{ fontSize: '12px', color: '#94a3b8', fontFamily: FONT_STACK }}>{months[m-1]} {d}, {y}</span>;
            })()}
          </div>
          <button onClick={() => setShowAddSong(true)} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', padding: '5px 10px', fontSize: '13px', fontWeight: 600, color: '#0f172a', fontFamily: FONT_STACK, flexShrink: 0 }}>+ Add</button>
        </div>
      )}
      {/* Header */}
      <AppBar onHome={onHome}
        backButton={<button onClick={onBack} style={APP_BAR_BTN} onMouseEnter={e => e.currentTarget.style.backgroundColor='#f1f5f9'} onMouseLeave={e => e.currentTarget.style.backgroundColor='#ffffff'}>← Plans</button>}
        centerContent={
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '12px', minWidth: 0, overflow: 'hidden' }}>
          {editingName ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={updatePlanName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') updatePlanName();
                if (e.key === 'Escape') { setEditName(plan.name); setEditingName(false); }
              }}
              autoFocus
              style={{
                fontSize: '17px',
                fontWeight: 700,
                border: '2px solid #0f172a',
                borderRadius: '6px',
                padding: '2px 8px',
                letterSpacing: '-0.02em',
                maxWidth: '300px'
              }}
            />
          ) : (
            <span
              style={{ fontWeight: 700, fontSize: '17px', color: '#0f172a', letterSpacing: '-0.02em', cursor: 'pointer' }}
              onClick={() => setEditingName(true)}
              title="Click to rename"
            >
              {plan.name}
            </span>
          )}
          {plan.date && !isMobile && (
            <span style={{ color: '#64748b', fontSize: '13px' }}>
              {(() => {
                const parts = plan.date.split('-');
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                const d = parseInt(parts[2], 10);
                if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                return `${months[m - 1]} ${d}, ${y}`;
              })()}
            </span>
          )}
          {/* Section selector */}
          {groups.length > 0 && authUser && !isMobile && (
            <select
              value={plan.groupId ?? ''}
              onChange={e => updatePlanGroup(e.target.value || null)}
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: plan.groupId ? '#0f172a' : '#94a3b8',
                background: plan.groupId ? '#f1f5f9' : 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '3px 8px',
                cursor: 'pointer',
                outline: 'none',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#0f172a'}
              onBlur={e => e.currentTarget.style.borderColor = '#e2e8f0'}
            >
              <option value="">No section</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}
        </div>
      } subRow={
        <div style={{ display: 'flex', gap: '0' }}>
          {(['overview', 'team'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'none',
                border: 'none',
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 600,
                color: activeTab === tab ? '#0f172a' : '#64748b',
                borderBottom: activeTab === tab ? '2px solid #0f172a' : '2px solid transparent',
                marginBottom: '-8px',
                transition: 'all 0.2s ease',
                textTransform: 'capitalize',
              }}
            >{tab === 'overview' ? 'Overview' : 'Teams'}</button>
          ))}
        </div>
      }>
        <button
          onClick={sendNotifications}
          disabled={sendingNotifications}
          style={{ ...APP_BAR_BTN, ...(sendingNotifications ? { backgroundColor: '#e2e8f0', color: '#94a3b8', cursor: 'default' } : APP_BAR_BTN_PRIMARY) }}
        >{sendingNotifications ? '…' : '📧'}</button>
        <button
          onClick={deletePlan}
          style={APP_BAR_BTN_DANGER}
          onMouseEnter={e => e.currentTarget.style.backgroundColor='#fecaca'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor='#fee2e2'}
        >{isMobile ? '🗑' : 'Delete'}</button>
      </AppBar>

      {/* Content */}
      <div style={{ padding: isMobile ? '16px 12px' : '24px', maxWidth: '1000px', margin: '0 auto', boxSizing: 'border-box', width: '100%', overflowX: 'hidden' }}>

        {/* Respond Banner - shown when arrived via invitation link */}
        {respondAssignmentId && (
          <div style={{
            background: respondStatus === 'accepted' ? '#f0fdf4' : respondStatus === 'declined' ? '#fef2f2' : '#eff6ff',
            border: `1px solid ${respondStatus === 'accepted' ? '#86efac' : respondStatus === 'declined' ? '#fca5a5' : '#bfdbfe'}`,
            borderRadius: 12,
            padding: '20px 24px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap' as const,
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: respondStatus === 'accepted' ? '#15803d' : respondStatus === 'declined' ? '#dc2626' : '#1e40af' }}>
                {respondStatus === 'accepted' ? '✅ You accepted this plan' : respondStatus === 'declined' ? '❌ You declined this plan' : '📋 You have been invited to this plan'}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                {respondStatus === 'accepted' ? 'Your response has been recorded.' : respondStatus === 'declined' ? 'Your response has been recorded.' : 'Let the plan leader know if you can make it.'}
              </div>
            </div>
            {respondStatus !== 'accepted' && (
              <button onClick={() => handleRespond('accepted')} disabled={respondingPlan}
                style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#16a34a', color: 'white', fontWeight: 700, fontSize: 15, cursor: respondingPlan ? 'default' : 'pointer', whiteSpace: 'nowrap' as const }}>
                ✅ Accept
              </button>
            )}
            {respondStatus !== 'declined' && (
              <button onClick={() => handleRespond('declined')} disabled={respondingPlan}
                style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 600, fontSize: 15, cursor: respondingPlan ? 'default' : 'pointer', whiteSpace: 'nowrap' as const }}>
                ❌ Decline
              </button>
            )}
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div>
            {/* Section header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
                Plan Order <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '13px' }}>({plan.entries.length} items)</span>
              </h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <AddElementInline onAdd={addElement} />
                <button onClick={() => setShowAddSong(true)} style={APP_BAR_BTN_PRIMARY}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor='#1e293b'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor='#0f172a'}
                >+ Song</button>
              </div>
            </div>

            {plan.entries.length === 0 ? (
              <div style={{ background: 'white', borderRadius: '8px', padding: '48px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600 }}>Nothing here yet</h3>
                <p style={{ margin: '0 0 20px 0', color: '#64748b', fontSize: '14px' }}>Add songs or custom items like "Welcome", "Offering", or "Announcements"</p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <AddElementInline onAdd={addElement} />
                  <button onClick={() => setShowAddSong(true)} style={APP_BAR_BTN_PRIMARY}>+ Add Song</button>
                </div>
              </div>
            ) : (
              <div style={{ background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', position: 'relative' }}>
                {dragSaving && <div style={{ position: 'absolute', top: 8, right: 12, fontSize: '12px', color: '#94a3b8' }}>Saving…</div>}
                {plan.entries.map((entry, index) => {
                  const isElement = entry.songId === '__element__';
                  const song = isElement ? null : songs.find(s => s.id === entry.songId);
                  const isDragging = dragIndex === index;
                  const isDropTarget = dragOverIndex === index && dragIndex !== index;
                  const dropAbove = isDropTarget && dragIndex !== null && dragIndex > index;
                  const dropBelow = isDropTarget && dragIndex !== null && dragIndex < index;
                  const songNumber = plan.entries.slice(0, index + 1).filter(e => e.songId !== '__element__').length;
                  const ts = song?.bpm ? getTempoStyle(song.bpm) : null;
                  const noteVal = entryNotes[index] ?? '';

                  return (
                    <div
                      key={entry.songId + index + entry.displayKey}
                      ref={isDragging ? dragNodeRef : undefined}
                      draggable
                      onDragStart={(e) => {
                        setDragIndex(index);
                        e.dataTransfer.effectAllowed = 'move';
                        setTimeout(() => { if (dragNodeRef.current) dragNodeRef.current.style.opacity = '0.4'; }, 0);
                      }}
                      onDragEnd={() => {
                        if (dragNodeRef.current) dragNodeRef.current.style.opacity = '1';
                        if (dragIndex !== null && dragOverIndex !== null) reorderEntries(dragIndex, dragOverIndex);
                        setDragIndex(null); setDragOverIndex(null);
                      }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIndex(index); }}
                      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverIndex(null); }}
                      onDrop={(e) => e.preventDefault()}
                      style={{
                        borderBottom: index < plan.entries.length - 1 ? '1px solid #f1f5f9' : 'none',
                        cursor: isDragging ? 'grabbing' : isElement ? 'default' : 'grab',
                        background: isDragging ? '#f0f9ff' : isElement ? '#fafafa' : 'white',
                        borderTop: dropAbove ? '2px solid #0f172a' : undefined,
                        borderBottomWidth: dropBelow ? '2px' : (index < plan.entries.length - 1 ? '1px' : '0'),
                        borderBottomColor: dropBelow ? '#0f172a' : '#f1f5f9',
                        userSelect: 'none',
                        transition: 'background 0.1s',
                      }}
                    >
                      {isElement ? (
                        /* ── Custom element row ─────────────────────── */
                        <div style={{ padding: '0 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 9, paddingBottom: noteVal.trim() ? 5 : 9 }}>
                            <div style={{ color: '#d1d5db', fontSize: '14px', cursor: 'grab', flexShrink: 0, lineHeight: 1, letterSpacing: '-1px' }}>⠿</div>
                            {editingElementIdx === index ? (
                              <input
                                autoFocus
                                value={elementDraft}
                                onChange={e => setElementDraft(e.target.value)}
                                onBlur={() => { if (elementDraft.trim()) updateElementLabel(index, elementDraft); setEditingElementIdx(null); }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { if (elementDraft.trim()) updateElementLabel(index, elementDraft); setEditingElementIdx(null); }
                                  if (e.key === 'Escape') setEditingElementIdx(null);
                                }}
                                style={{ flex: 1, border: '1px solid #0f172a', borderRadius: 5, padding: '2px 8px', fontSize: '13px', fontWeight: 600, outline: 'none', color: '#0f172a', background: 'white' }}
                              />
                            ) : (
                              <span
                                onClick={() => { setEditingElementIdx(index); setElementDraft(entry.displayKey); }}
                                title="Click to rename"
                                style={{ fontWeight: 600, fontSize: '13px', color: '#475569', cursor: 'text', flex: 1 }}
                              >{entry.displayKey}</span>
                            )}
                            {/* + note button — only shown when no note and not editing */}
                            {!noteVal.trim() && editingNoteIdx !== index && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingNoteIdx(index); }}
                                title="Add note"
                                style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, color: '#94a3b8', cursor: 'pointer', padding: '1px 5px', fontSize: '13px', lineHeight: 1, flexShrink: 0 }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#94a3b8'; e.currentTarget.style.color = '#475569'; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#94a3b8'; }}
                              >+</button>
                            )}
                            <button onClick={() => removeEntry(index)}
                              style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', padding: '2px 4px', fontSize: '15px', lineHeight: 1, flexShrink: 0 }}
                              onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                              onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
                            >×</button>
                          </div>
                          {/* Note — shown when note exists OR actively editing */}
                          {(noteVal.trim() || editingNoteIdx === index) && (
                            <div style={{ paddingLeft: 24, paddingBottom: 8 }}>
                              <input
                                autoFocus={editingNoteIdx === index && !noteVal.trim()}
                                type="text"
                                value={noteVal}
                                onClick={e => { e.stopPropagation(); setEditingNoteIdx(index); }}
                                onChange={e => { e.stopPropagation(); setEntryNotes(prev => ({ ...prev, [index]: e.target.value })); }}
                                onBlur={e => {
                                  const val = e.target.value.trim();
                                  setEntryNotes(prev => ({ ...prev, [index]: val }));
                                  updateEntryNote(index, val);
                                  setEditingNoteIdx(null);
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  if (e.key === 'Escape') { setEntryNotes(prev => ({ ...prev, [index]: '' })); updateEntryNote(index, ''); setEditingNoteIdx(null); }
                                }}
                                style={{ width: '100%', border: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0, padding: '2px 0', fontSize: '12px', color: '#64748b', background: 'transparent', outline: 'none', fontFamily: FONT_STACK, boxSizing: 'border-box' }}
                                onFocus={e => { e.currentTarget.style.borderBottomColor = '#0f172a'; }}
                                onBlurCapture={e => { e.currentTarget.style.borderBottomColor = '#e2e8f0'; }}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        /* ── Song row ───────────────────────────────── */
                        <div style={{ padding: '0 14px' }}>
                          {isMobile ? (
                            /* Mobile: clean — number + title dominant + key pill + delete */
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 14, paddingBottom: noteVal ? 4 : 14 }}>
                              {/* Number */}
                              <span style={{ color: '#d1d5db', fontSize: '12px', fontWeight: 600, minWidth: 18, textAlign: 'right', flexShrink: 0, fontFamily: FONT_STACK }}>{songNumber}</span>
                              {/* Title + secondary line — taps to open */}
                              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => song && onOpenSong(song, plan, index)}>
                                <span style={{ fontWeight: 700, fontSize: '17px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', letterSpacing: '-0.01em' }}>{song?.title}</span>
                                {(song?.bpm || leaders[index]) && (
                                  <span style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginTop: 2, fontFamily: FONT_STACK }}>
                                    {[song?.bpm && `${song.bpm} bpm`, leaders[index]].filter(Boolean).join('  ·  ')}
                                  </span>
                                )}
                              </div>
                              {/* Key pill */}
                              <select
                                value={entry.displayKey}
                                onClick={e => e.stopPropagation()}
                                onChange={async (e) => {
                                  e.stopPropagation();
                                  const newKey = e.target.value;
                                  if (!authUser) return;
                                  try {
                                    await supabase.from('setlist_entries').update({ display_key: newKey }).eq('setlist_id', plan.id).eq('position', index);
                                    const newEntries = plan.entries.map((en, i) => i === index ? { ...en, displayKey: newKey } : en);
                                    onUpdate({ ...plan, entries: newEntries });
                                  } catch (err) { console.error('Error updating key:', err); }
                                }}
                                style={{ background: '#1a1a1a', color: 'white', border: 'none', padding: '5px 8px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', appearance: 'none' as const, flexShrink: 0, minWidth: 42, textAlign: 'center' as const, fontFamily: 'Helvetica, sans-serif' }}
                              >
                                {KEY_LIST.map(k => <option key={k} value={k}>{k}</option>)}
                              </select>
                              {/* Delete */}
                              <button
                                onClick={(e) => { e.stopPropagation(); removeEntry(index); }}
                                style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', padding: '4px', fontSize: '20px', lineHeight: 1, flexShrink: 0 }}
                                onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                                onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
                              >×</button>
                            </div>
                          ) : (
                            /* Desktop: full row */
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 13, paddingBottom: noteVal ? 6 : 13 }}>
                              <div style={{ color: '#d1d5db', fontSize: '14px', cursor: 'grab', flexShrink: 0, lineHeight: 1, letterSpacing: '-1px' }}>⠿</div>
                              <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600, minWidth: 16, textAlign: 'right', flexShrink: 0 }}>{songNumber}</span>
                              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => song && onOpenSong(song, plan, index)}>
                                <span style={{ fontWeight: 600, fontSize: '14px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{song?.title}</span>
                              </div>
                              {song?.bpm && ts ? (
                                <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 5, fontSize: '11px', fontWeight: 600, backgroundColor: ts.bg, color: ts.color, flexShrink: 0 }}>{song.bpm}</span>
                              ) : null}
                              <input
                                type="text"
                                placeholder="Leader"
                                value={leaders[index] ?? ''}
                                onClick={e => e.stopPropagation()}
                                onChange={e => { e.stopPropagation(); setLeaders(prev => ({ ...prev, [index]: e.target.value })); }}
                                onBlur={e => updateLeader(index, e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                style={{ width: 80, flexShrink: 0, border: 'none', borderBottom: (leaders[index] ?? '') ? '1px solid #e2e8f0' : '1px dashed #e2e8f0', borderRadius: 0, padding: '2px 4px', fontSize: '12px', color: '#64748b', background: 'transparent', outline: 'none', fontFamily: FONT_STACK, fontStyle: (leaders[index] ?? '') ? 'normal' : 'italic' }}
                                onFocus={e => { e.currentTarget.style.borderBottomColor = '#0f172a'; e.currentTarget.style.fontStyle = 'normal'; }}
                                onBlurCapture={e => { e.currentTarget.style.borderBottomColor = '#e2e8f0'; }}
                              />
                              <select
                                value={entry.displayKey}
                                onClick={e => e.stopPropagation()}
                                onChange={async (e) => {
                                  e.stopPropagation();
                                  const newKey = e.target.value;
                                  if (!authUser) return;
                                  try {
                                    await supabase.from('setlist_entries').update({ display_key: newKey }).eq('setlist_id', plan.id).eq('position', index);
                                    const newEntries = plan.entries.map((en, i) => i === index ? { ...en, displayKey: newKey } : en);
                                    onUpdate({ ...plan, entries: newEntries });
                                  } catch (err) { console.error('Error updating key:', err); }
                                }}
                                style={{ background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', padding: '3px 18px 3px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', appearance: 'none', backgroundImage: 'url(%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23475569%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E)', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 3px center', flexShrink: 0 }}
                              >
                                {KEY_LIST.map(k => <option key={k} value={k}>{k}</option>)}
                              </select>
                              {!noteVal.trim() && editingNoteIdx !== index && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditingNoteIdx(index); }}
                                  title="Add note"
                                  style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, color: '#94a3b8', cursor: 'pointer', padding: '1px 5px', fontSize: '13px', lineHeight: 1, flexShrink: 0 }}
                                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#94a3b8'; e.currentTarget.style.color = '#475569'; }}
                                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#94a3b8'; }}
                                >+</button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); removeEntry(index); }}
                                style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', padding: '2px 4px', fontSize: '16px', lineHeight: 1, flexShrink: 0 }}
                                onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                                onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
                              >×</button>
                            </div>
                          )}
                          {/* Note row — shown when note exists OR when actively editing */}
                          {(noteVal.trim() || editingNoteIdx === index) && (
                            <div style={{ paddingLeft: 46, paddingBottom: 10 }}>
                              <input
                                autoFocus={editingNoteIdx === index && !noteVal.trim()}
                                type="text"
                                value={noteVal}
                                onClick={e => { e.stopPropagation(); setEditingNoteIdx(index); }}
                                onChange={e => { e.stopPropagation(); setEntryNotes(prev => ({ ...prev, [index]: e.target.value })); }}
                                onBlur={e => {
                                  const val = e.target.value.trim();
                                  setEntryNotes(prev => ({ ...prev, [index]: val }));
                                  updateEntryNote(index, val);
                                  setEditingNoteIdx(null);
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  if (e.key === 'Escape') { setEntryNotes(prev => ({ ...prev, [index]: '' })); updateEntryNote(index, ''); setEditingNoteIdx(null); }
                                }}
                                style={{ width: '100%', border: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0, padding: '2px 0', fontSize: '12px', color: '#64748b', background: 'transparent', outline: 'none', fontFamily: FONT_STACK, boxSizing: 'border-box' }}
                                onFocus={e => { e.currentTarget.style.borderBottomColor = '#0f172a'; }}
                                onBlurCapture={e => { e.currentTarget.style.borderBottomColor = '#e2e8f0'; }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Team Tab */}
        {activeTab === 'team' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>Teams</h2>
              <button onClick={() => setShowAddPosition(true)} style={APP_BAR_BTN_PRIMARY}
                onMouseEnter={e => e.currentTarget.style.backgroundColor='#1e293b'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor='#0f172a'}
              >+ Position</button>
            </div>
            {assignments.length === 0 && emptyPositions.length === 0 ? (
              <div style={{ background: 'white', borderRadius: '8px', padding: '40px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>👥</div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 600 }}>No positions yet</h3>
                <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: '14px' }}>Add positions to build your team for this plan</p>
                <button onClick={() => setShowAddPosition(true)} style={APP_BAR_BTN_PRIMARY}>Add Position</button>
              </div>
            ) : (
              <div style={{ background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                {emptyPositions.map((position, index) => (
                  <div key={`empty-${index}`}
                    style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}
                    onClick={() => { setSelectedPosition(String(index)); setShowAssignPerson(true); }}
                  >
                    <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0, minWidth: 90 }}>{position}</span>
                    <span style={{ color: '#cbd5e1', fontSize: '13px', fontStyle: 'italic', flex: 1 }}>Unassigned</span>
                    <button onClick={(e) => { e.stopPropagation(); removeEmptyPosition(index); }}
                      style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '2px 4px', fontSize: '15px', lineHeight: 1, flexShrink: 0 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                      onMouseLeave={e => e.currentTarget.style.color = '#cbd5e1'}
                    >×</button>
                  </div>
                ))}
                {assignments.map((assignment, idx) => (
                  <div key={assignment.id}
                    style={{ background: 'white', borderBottom: idx < assignments.length - 1 ? '1px solid #f1f5f9' : 'none', padding: '10px 14px', cursor: assignment.team_member_id ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.12s' }}
                    onMouseEnter={e => { if (!assignment.team_member_id) e.currentTarget.style.background = '#f8fafc'; }}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}
                    onClick={() => { if (!assignment.team_member_id) { setSelectedPosition(assignment.id); setShowAssignPerson(true); } }}
                  >
                    <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0, minWidth: 90 }}>{assignment.position}</span>
                    <span style={{ flex: 1, fontSize: '13px', fontWeight: assignment.team_member_id ? 600 : 400, color: assignment.team_member_id ? '#0f172a' : '#cbd5e1', fontStyle: assignment.team_member_id ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {assignment.team_member_id && assignment.team_member ? assignment.team_member.name : 'Unassigned'}
                    </span>
                    {assignment.team_member_id && assignment.team_member && (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 20, flexShrink: 0, background: assignment.status === 'accepted' ? '#dcfce7' : assignment.status === 'declined' ? '#fee2e2' : '#f1f5f9', color: assignment.status === 'accepted' ? '#15803d' : assignment.status === 'declined' ? '#dc2626' : '#64748b' }}>
                        {assignment.status === 'accepted' ? '✓' : assignment.status === 'declined' ? '✕' : '…'}
                      </span>
                    )}
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {assignment.team_member_id && (
                        <button onClick={(e) => { e.stopPropagation(); clearPersonFromPosition(assignment.id); }}
                          style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '2px 4px', fontSize: '12px', fontWeight: 500 }}
                          onMouseEnter={e => e.currentTarget.style.color = '#64748b'}
                          onMouseLeave={e => e.currentTarget.style.color = '#cbd5e1'}
                        >Clear</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); removeAssignment(assignment.id); }}
                        style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '2px 4px', fontSize: '15px', lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                        onMouseLeave={e => e.currentTarget.style.color = '#cbd5e1'}
                      >×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}


      </div>

      {/* Add Songs Modal */}
      {showAddSong && (
        <AddSongsModal
          allSongs={songs}
          authUser={authUser}
          existingIds={new Set(plan.entries.map(e => e.songId))}
          onConfirm={addSongsToPlan}
          onClose={() => setShowAddSong(false)}
        />
      )}

      {/* Add Position Modal */}
      {showAddPosition && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
          onClick={() => setShowAddPosition(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 600 }}>
              Add Positions to Plan
            </h2>

            {/* Position checkboxes */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '12px', fontSize: '14px', fontWeight: 500, color: '#64748b' }}>
                Select positions to add
              </label>
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '8px',
                maxHeight: '300px',
                overflowY: 'auto',
                padding: '8px',
                border: '1px solid #e2e8f0',
                borderRadius: '6px'
              }}>
                {availablePositions.map(pos => {
                  const isAlreadyAdded = emptyPositions.includes(pos) || assignments.some(a => a.position === pos);
                  return (
                    <label
                      key={pos}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        cursor: isAlreadyAdded ? 'not-allowed' : 'pointer',
                        background: isAlreadyAdded ? '#f8fafc' : 'white',
                        opacity: isAlreadyAdded ? 0.5 : 1,
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => !isAlreadyAdded && (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={(e) => !isAlreadyAdded && (e.currentTarget.style.background = 'white')}
                    >
                      <input
                        type="checkbox"
                        checked={newPositionName.split(',').map(p => p.trim()).includes(pos)}
                        disabled={isAlreadyAdded}
                        onChange={(e) => {
                          const positions = newPositionName.split(',').map(p => p.trim()).filter(Boolean);
                          if (e.target.checked) {
                            setNewPositionName([...positions, pos].join(', '));
                          } else {
                            setNewPositionName(positions.filter(p => p !== pos).join(', '));
                          }
                        }}
                        style={{ cursor: isAlreadyAdded ? 'not-allowed' : 'pointer' }}
                      />
                      <span style={{ fontSize: '14px', fontWeight: 500 }}>
                        {pos}
                      </span>
                      {isAlreadyAdded && (
                        <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: 'auto' }}>
                          Already added
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Custom position input */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>
                Or add a custom position
              </label>
              <input
                type="text"
                placeholder="e.g., Violin, Cello, Mandolin..."
                value={newPositionName.split(',').filter(p => !availablePositions.includes(p.trim())).join(', ')}
                onChange={(e) => {
                  const selectedPresets = newPositionName.split(',').map(p => p.trim()).filter(p => availablePositions.includes(p));
                  const custom = e.target.value;
                  setNewPositionName([...selectedPresets, custom].filter(Boolean).join(', '));
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                Separate multiple positions with commas
              </div>
            </div>

            {/* Selected positions preview */}
            {newPositionName.trim() && (
              <div style={{ marginBottom: '20px', padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                  Positions to add:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {newPositionName.split(',').map(p => p.trim()).filter(Boolean).map((pos, idx) => (
                    <span
                      key={idx}
                      style={{
                        background: '#3b82f6',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 500
                      }}
                    >
                      {pos}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowAddPosition(false);
                  setNewPositionName('');
                }}
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const positions = newPositionName.split(',').map(p => p.trim()).filter(Boolean);
                  setEmptyPositions([...emptyPositions, ...positions]);
                  setNewPositionName('');
                  setShowAddPosition(false);
                }}
                disabled={!newPositionName.trim()}
                style={{
                  background: newPositionName.trim() ? '#3b82f6' : '#cbd5e1',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: newPositionName.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                Add {newPositionName.split(',').filter(p => p.trim()).length > 1 ? 'Positions' : 'Position'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Person Modal */}
      {showAssignPerson && selectedPosition && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
          onClick={() => {
            setShowAssignPerson(false);
            setSelectedPosition(null);
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '400px',
              width: '100%'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 600 }}>
              Assign Person
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {teamMembers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                  <p>No team members yet.</p>
                  <p style={{ fontSize: '13px' }}>Add people in the Team section first.</p>
                </div>
              ) : (
                teamMembers.map(member => (
                  <button
                    key={member.id}
                    onClick={() => assignPersonToPosition(selectedPosition, member.id)}
                    style={{
                      background: 'white',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.borderColor = '#3b82f6';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'white';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>
                      {member.name}
                    </div>
                    {member.positions && member.positions.length > 0 && (
                      <div style={{ fontSize: '12px', color: '#64748b' }}>
                        {member.positions.join(', ')}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Team Assignment Modal Component (not needed anymore but keeping for compatibility)
function TeamAssignmentModal({ teamMembers, onAssign, onClose }: {
  teamMembers: TeamMember[];
  onAssign: (memberId: string, position: string) => void;
  onClose: () => void;
}) {
  return null; // Not used anymore
}
// ============================================================================

function LoginModal({ onClose, onLogin, resetMode }: { onClose: () => void; onLogin: (user: AuthUser, token: string) => void; resetMode?: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset' | 'resetForm'>(resetMode ? 'resetForm' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const submit = async () => {
    if (mode === 'reset') {
      // Request password reset email
      if (!email.trim()) { setError('Please enter your email.'); return; }
      setLoading(true); setError('');
      try {
        await supaAuth('recover', { email: email.trim() });
        setResetSent(true);
      } catch (e: any) {
        setError(e.message || 'Failed to send reset email.');
      } finally { setLoading(false); }
      return;
    }

    if (mode === 'resetForm') {
      // Update password from reset link
      if (!password.trim()) { setError('Please enter a new password.'); return; }
      setLoading(true); setError('');
      try {
        const hash = window.location.hash;
        const params = new URLSearchParams(hash.slice(1));
        const accessToken = params.get('access_token');
        if (!accessToken) { setError('Invalid reset link.'); setLoading(false); return; }
        
        await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
          body: JSON.stringify({ password: password.trim() }),
        });
        setResetDone(true);
      } catch (e: any) {
        setError(e.message || 'Failed to reset password.');
      } finally { setLoading(false); }
      return;
    }

    if (!email.trim() || !password.trim()) { setError('Please enter email and password.'); return; }
    setLoading(true); setError('');
    try {
      if (mode === 'signup') {
        const signupData = await supaAuth('signup', { email: email.trim(), password });
        // Manually create the profile row since we removed the DB trigger
        if (signupData?.user?.id) {
          try {
            await supabase.from('profiles').insert({ id: signupData.user.id }).select().single();
          } catch { /* profile may already exist or email confirmation pending — ignore */ }
        }
        setSignupDone(true);
      } else {
        const data = await supaAuth('token?grant_type=password', { email: email.trim(), password });
        const user = await supaGetUser(data.access_token);
        if (user) {
          await store.set('auth_token', data.access_token);
          await store.set('auth_refresh', data.refresh_token);
          onLogin(user, data.access_token);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ backgroundColor: 'white', borderRadius: 8, padding: 32, width: '90%', maxWidth: 400, fontFamily: 'Helvetica, sans-serif' }}
        onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 20px', fontSize: '18pt', fontWeight: 800 }}>
          {mode === 'resetForm' ? 'Reset Password' : mode === 'reset' ? 'Reset Password' : mode === 'login' ? 'Log In' : 'Sign Up'}
        </h2>

        {resetDone ? (
          <div>
            <p style={{ color: '#22c55e', marginBottom: 16 }}>Password updated! You can now log in.</p>
            <button onClick={() => { setMode('login'); setResetDone(false); setPassword(''); }} style={{ padding: '8px 20px', fontSize: '11pt', cursor: 'pointer', backgroundColor: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, fontFamily: 'Helvetica, sans-serif' }}>Go to Login</button>
          </div>
        ) : resetSent ? (
          <div>
            <p style={{ color: '#22c55e', marginBottom: 16 }}>Reset link sent! Check your email and click the link to reset your password.</p>
            <button onClick={() => { setMode('login'); setResetSent(false); setEmail(''); }} style={{ padding: '8px 20px', fontSize: '11pt', cursor: 'pointer', backgroundColor: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, fontFamily: 'Helvetica, sans-serif' }}>Go to Login</button>
          </div>
        ) : signupDone ? (
          <div>
            <p style={{ color: '#22c55e', marginBottom: 16 }}>Account created! Check your email to confirm, then log in.</p>
            <button onClick={() => { setMode('login'); setSignupDone(false); }} style={{ padding: '8px 20px', fontSize: '11pt', cursor: 'pointer', backgroundColor: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, fontFamily: 'Helvetica, sans-serif' }}>Go to Login</button>
          </div>
        ) : (
          <>
            {mode === 'resetForm' ? (
              <>
                <p style={{ fontSize: '10pt', color: '#666', marginBottom: 16 }}>Enter your new password below.</p>
                <input type="password" placeholder="New Password" value={password} onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  style={{ width: '100%', padding: '10px 12px', fontSize: '16px', border: '1px solid #ccc', borderRadius: 4, marginBottom: 16, boxSizing: 'border-box', fontFamily: 'Helvetica, sans-serif', outline: 'none' }} autoFocus />
              </>
            ) : mode === 'reset' ? (
              <>
                <p style={{ fontSize: '10pt', color: '#666', marginBottom: 16 }}>Enter your email and we'll send you a reset link.</p>
                <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  style={{ width: '100%', padding: '10px 12px', fontSize: '16px', border: '1px solid #ccc', borderRadius: 4, marginBottom: 16, boxSizing: 'border-box', fontFamily: 'Helvetica, sans-serif', outline: 'none' }} autoFocus />
              </>
            ) : (
              <>
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              style={{ width: '100%', padding: '10px 12px', fontSize: '16px', border: '1px solid #ccc', borderRadius: 4, marginBottom: 10, boxSizing: 'border-box', fontFamily: 'Helvetica, sans-serif', outline: 'none' }} autoFocus />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              style={{ width: '100%', padding: '10px 12px', fontSize: '16px', border: '1px solid #ccc', borderRadius: 4, marginBottom: 16, boxSizing: 'border-box', fontFamily: 'Helvetica, sans-serif', outline: 'none' }} />
              </>
            )}
            {error && <p style={{ color: '#ef4444', fontSize: '10pt', marginBottom: 12 }}>{error}</p>}
            <button onClick={submit} disabled={loading}
              style={{ width: '100%', padding: '10px', fontSize: '12pt', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', backgroundColor: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, fontFamily: 'Helvetica, sans-serif', marginBottom: 12, opacity: loading ? 0.6 : 1 }}>
              {loading ? '...' : mode === 'resetForm' ? 'Update Password' : mode === 'reset' ? 'Send Reset Link' : mode === 'login' ? 'Log In' : 'Create Account'}
            </button>
            <div style={{ textAlign: 'center', fontSize: '10pt', color: '#666' }}>
              {mode === 'reset' ? (
                <>Remember it? <span onClick={() => { setMode('login'); setError(''); }} style={{ color: '#1a1a1a', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Log in</span></>
              ) : mode === 'resetForm' ? null : mode === 'login' ? (
                <>
                  No account? <span onClick={() => { setMode('signup'); setError(''); }} style={{ color: '#1a1a1a', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Sign up</span>
                  {' · '}
                  <span onClick={() => { setMode('reset'); setError(''); }} style={{ color: '#1a1a1a', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Forgot password?</span>
                </>
              ) : (
                <>Have an account? <span onClick={() => { setMode('login'); setError(''); }} style={{ color: '#1a1a1a', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Log in</span></>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsModal({ settings, onClose, onSave }: {
  settings: UserSettings;
  onClose: () => void;
  onSave: (settings: UserSettings) => void;
}) {
  const [localSettings, setLocalSettings] = useState(settings);
  
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: 'white', borderRadius: 8, padding: 30, maxWidth: 400, width: '90%', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
        <h2 style={{ margin: '0 0 20px 0', fontFamily: 'Helvetica, sans-serif', fontSize: '18pt', fontWeight: 700 }}>Settings</h2>
        
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'Helvetica, sans-serif', fontSize: '11pt', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={localSettings.showCapoSuggestions}
              onChange={(e) => setLocalSettings({ ...localSettings, showCapoSuggestions: e.target.checked })}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <span>Show capo suggestions when transposing</span>
          </label>
          <p style={{ margin: '8px 0 0 28px', fontSize: '9pt', color: '#666', fontFamily: 'Helvetica, sans-serif' }}>
            When changing the display key, show "Capo X (Play in Y)" hints
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 30 }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', fontSize: '11pt', cursor: 'pointer', backgroundColor: 'white', border: '1px solid #ccc', borderRadius: 4, fontFamily: 'Helvetica, sans-serif' }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(localSettings);
              onClose();
            }}
            style={{ padding: '8px 16px', fontSize: '11pt', fontWeight: 700, cursor: 'pointer', backgroundColor: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, fontFamily: 'Helvetica, sans-serif' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================
// Spotify Player Component
// ============================

// ============================================================================
// Spotify Player Component
// ============================================================================


function SpotifyPlayer({ trackId, spotifyToken, globalPlayer, globalDeviceId, globalReady, onTogglePlayRef, onPlaybackState, onTrackEnd, sectionMarkers, editingMarkers, onEditMarkersToggle, onMarkerDrag }: {
  trackId: string;
  spotifyToken: string;
  globalPlayer: React.MutableRefObject<any>;
  globalDeviceId: React.MutableRefObject<string | null>;
  globalReady: React.MutableRefObject<boolean>;
  onTogglePlayRef?: React.MutableRefObject<(() => void) | null>;
  onPlaybackState?: (state: { position: number; duration: number; isPlaying: boolean }) => void;
  onTrackEnd?: () => void;
  sectionMarkers?: { pct: number; color: string }[];
  editingMarkers?: boolean;
  onEditMarkersToggle?: () => void;
  onMarkerDrag?: (markerIdx: number, newPct: number) => void;
}) {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [position, setPosition] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [trackInfo, setTrackInfo] = React.useState<{ name: string; artist: string; albumArt: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(globalReady.current);
  const [loading, setLoading] = React.useState(false);
  const intervalRef = React.useRef<any>(null);
  const playQueuedRef = React.useRef(false);
  const trackIdRef = React.useRef(trackId);
  const startedRef = React.useRef(false); // true once startPlayback has been called for this track
  const progressBarRef = React.useRef<HTMLDivElement>(null);
  const draggingMarkerRef = React.useRef<number | null>(null);
  const onTrackEndRef = React.useRef(onTrackEnd);
  React.useEffect(() => { onTrackEndRef.current = onTrackEnd; }, [onTrackEnd]);
  // Track whether we've already fired onTrackEnd for this play-through
  const trackEndFiredRef = React.useRef(false);
  // Only consider track ended if we've seen position > 0 (i.e. it actually played)
  const hasProgressedRef = React.useRef(false);


  // When trackId changes, stop playback and reset all state
  React.useEffect(() => {
    trackIdRef.current = trackId;
    startedRef.current = false;
    trackEndFiredRef.current = false;
    hasProgressedRef.current = false;
    if (globalPlayer.current) {
      globalPlayer.current.pause().catch(() => {});
    }
    setIsPlaying(false);
    setPosition(0);
    setDuration(0);
    setTrackInfo(null);
    setLoading(false);
    playQueuedRef.current = false;
  }, [trackId]);

  // Pre-fetch track info immediately — guard against stale responses
  React.useEffect(() => {
    const thisTrackId = trackId;
    fetch(`https://api.spotify.com/v1/tracks/${thisTrackId}`, {
      headers: { Authorization: `Bearer ${spotifyToken}` }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || trackIdRef.current !== thisTrackId) return;
        setTrackInfo({
          name: data.name,
          artist: data.artists?.map((a: any) => a.name).join(', ') || '',
          albumArt: data.album?.images?.[0]?.url || '',
        });
        if (data.duration_ms) setDuration(data.duration_ms);
      })
      .catch(() => {});
  }, [trackId]);

  // Poll for global player readiness if not ready yet
  React.useEffect(() => {
    if (globalReady.current) { setReady(true); return; }
    const interval = setInterval(() => {
      if (globalReady.current) {
        setReady(true);
        clearInterval(interval);
        if (playQueuedRef.current) {
          playQueuedRef.current = false;
          startPlayback();
        }
      }
    }, 300);
    return () => clearInterval(interval);
  }, []);

  // Hook into player state changes
  React.useEffect(() => {
    const p = globalPlayer.current;
    if (!p) return;
    const handler = (state: any) => {
      if (!state) return;
      const currentTrack = state.track_window?.current_track;
      if (currentTrack && currentTrack.id !== trackIdRef.current) return;
      // Update state regardless of how playback was started
      setIsPlaying(!state.paused);
      setPosition(state.position);
      if (state.duration) setDuration(state.duration);
      // Mark as started if we see it actually playing — covers auto-advance case
      if (!state.paused) startedRef.current = true;
      if (currentTrack) setTrackInfo({
        name: currentTrack.name,
        artist: currentTrack.artists.map((a: any) => a.name).join(', '),
        albumArt: currentTrack.album.images[0]?.url || '',
      });
      // Track that the song has genuinely played
      if (!state.paused && state.position > 3000) hasProgressedRef.current = true;
      // Detect natural track end: paused within 2s of duration
      const nearEnd = state.duration > 0 && state.position >= state.duration - 2000;
      if (state.paused && nearEnd && hasProgressedRef.current && !trackEndFiredRef.current) {
        console.log('[AutoPlay] track end detected');
        trackEndFiredRef.current = true;
        onTrackEndRef.current?.();
      }
    };
    p.addListener('player_state_changed', handler);
    p.addListener('account_error', () => setError('Spotify Premium required for in-app playback'));
    p.addListener('authentication_error', () => setError('Spotify authentication error — try reconnecting'));
    return () => {
      p.removeListener('player_state_changed', handler);
    };
  }, [globalPlayer.current]);

  const startPlayback = async () => {
    const devId = globalDeviceId.current;
    if (!devId) return;
    setLoading(true);
    startedRef.current = true;
    try {
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${devId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${spotifyToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        startedRef.current = false;
        if (err?.error?.reason === 'PREMIUM_REQUIRED') setError('Spotify Premium required for in-app playback');
      }
    } catch (e) {
      startedRef.current = false;
      console.error('Playback error:', e);
    }
    setLoading(false);
  };

  const togglePlay = async () => {
    // On iOS/Capacitor the Web Playback SDK doesn't work in WKWebView.
    // Fall back to Spotify Connect API — plays on the user's active Spotify device.
    if (Capacitor.isNativePlatform()) {
      await startPlaybackOnActiveDevice();
      return;
    }
    if (!ready) {
      playQueuedRef.current = true;
      return;
    }
    // Always use startPlayback if we haven't started this track yet
    if (!startedRef.current) {
      await startPlayback();
    } else {
      globalPlayer.current?.togglePlay();
    }
  };

  // iOS-specific: play/pause via Spotify Connect on the user's active device
  const startPlaybackOnActiveDevice = async () => {
    try {
      // Get available devices
      const devRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { Authorization: `Bearer ${spotifyToken}` },
      });
      if (!devRes.ok) return;
      const devData = await devRes.json();
      const devices: any[] = devData.devices || [];
      // Prefer active device, then any available device
      const target = devices.find((d: any) => d.is_active) || devices[0];

      // Check current playback state
      const stateRes = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${spotifyToken}` },
      });
      const state = stateRes.ok && stateRes.status !== 204 ? await stateRes.json() : null;
      const currentTrack = state?.item?.id;
      const isCurrentlyPlaying = state?.is_playing;

      if (currentTrack === trackId && isCurrentlyPlaying) {
        // Same track is playing — pause it
        await fetch('https://api.spotify.com/v1/me/player/pause', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${spotifyToken}` },
        });
        setIsPlaying(false);
        return;
      }
      if (currentTrack === trackId && !isCurrentlyPlaying) {
        // Same track is paused — resume
        await fetch('https://api.spotify.com/v1/me/player/play', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${spotifyToken}` },
          ...(target ? { body: JSON.stringify({ device_id: target.id }) } : {}),
        });
        setIsPlaying(true);
        startedRef.current = true;
        return;
      }
      // Different track — start it
      const url = target
        ? `https://api.spotify.com/v1/me/player/play?device_id=${target.id}`
        : 'https://api.spotify.com/v1/me/player/play';
      await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${spotifyToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      });
      setIsPlaying(true);
      startedRef.current = true;
      // Start polling playback state so progress updates
      const pollState = async () => {
        const r = await fetch('https://api.spotify.com/v1/me/player', {
          headers: { Authorization: `Bearer ${spotifyToken}` },
        });
        if (r.ok && r.status !== 204) {
          const s = await r.json();
          if (s.item?.id === trackId) {
            setPosition(s.progress_ms || 0);
            setDuration(s.item.duration_ms || 0);
            setIsPlaying(!s.paused && s.is_playing);
            if (onPlaybackState) onPlaybackState({ position: s.progress_ms || 0, duration: s.item.duration_ms || 0, isPlaying: s.is_playing });
          }
        }
      };
      setTimeout(pollState, 1000);
    } catch (e) {
      console.error('Spotify Connect error:', e);
    }
  };



  // Register togglePlay so the keyboard shortcut can call the same function
  React.useEffect(() => {
    if (onTogglePlayRef) onTogglePlayRef.current = togglePlay;
    return () => { if (onTogglePlayRef) onTogglePlayRef.current = null; };
  }, [togglePlay]);

  // Position progress ticker — also detects natural track end
  React.useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setPosition(p => {
          const next = p + 1000;
          if (next > 3000) hasProgressedRef.current = true;
          if (duration > 0 && next >= duration && hasProgressedRef.current && !trackEndFiredRef.current) {
            console.log('[AutoPlay] track end detected via position ticker');
            trackEndFiredRef.current = true;
            onTrackEndRef.current?.();
          }
          return next;
        });
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, duration]);

  // On iOS: poll Spotify Connect API every 2s to sync playback state
  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const poll = setInterval(async () => {
      try {
        const r = await fetch('https://api.spotify.com/v1/me/player', {
          headers: { Authorization: `Bearer ${spotifyToken}` },
        });
        if (r.ok && r.status !== 204) {
          const s = await r.json();
          if (s.item?.id === trackIdRef.current) {
            const pos = s.progress_ms || 0;
            const dur = s.item.duration_ms || 0;
            setPosition(pos);
            setDuration(dur);
            setIsPlaying(s.is_playing);
            if (onPlaybackState) onPlaybackState({ position: pos, duration: dur, isPlaying: s.is_playing });
            if (pos > 3000) hasProgressedRef.current = true;
            // Detect end: not playing and position is within last 5s of duration
            const nearEnd = dur > 0 && pos >= dur - 5000;
            if (!s.is_playing && nearEnd && hasProgressedRef.current && !trackEndFiredRef.current) {
              trackEndFiredRef.current = true;
              onTrackEndRef.current?.();
            }
          } else if (s.item && s.item.id !== trackIdRef.current && hasProgressedRef.current && !trackEndFiredRef.current) {
            // Spotify moved to a different track naturally — treat as end
            trackEndFiredRef.current = true;
            onTrackEndRef.current?.();
          }
        }
      } catch (_) {}
    }, 2000);
    return () => clearInterval(poll);
  }, [spotifyToken]);

  // Notify parent of playback state changes for auto-scroll
  const onPlaybackStateRef = React.useRef(onPlaybackState);
  React.useEffect(() => { onPlaybackStateRef.current = onPlaybackState; }, [onPlaybackState]);
  React.useEffect(() => {
    onPlaybackStateRef.current?.({ position, duration, isPlaying });
  }, [position, duration, isPlaying]);

  const seek = (pct: number) => {
    if (!globalPlayer.current || !duration || !startedRef.current) return;
    const pos = Math.floor(pct * duration);
    globalPlayer.current.seek(pos);
    setPosition(pos);
  };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  if (error) return (
    <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: '10pt', color: '#dc2626', fontFamily: 'Helvetica, sans-serif' }}>
      {error}
    </div>
  );

  return (
    <div style={{ backgroundColor: '#1a1a1a', borderRadius: 6, padding: '6px 12px', fontFamily: 'Helvetica, sans-serif', color: 'white', display: 'flex', alignItems: 'center', gap: 10 }}>
      <button
        onClick={togglePlay}
        disabled={loading}
        style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: loading ? '#555' : '#1db954', border: 'none', cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '11pt', color: 'white', transition: 'background 0.2s' }}
      >{loading ? '⏳' : isPlaying ? '⏸' : '▶'}</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '9pt', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'white', marginBottom: 3 }}>
          {trackInfo?.name || (ready ? 'Ready' : 'Connecting...')}
          {trackInfo?.artist && <span style={{ fontWeight: 400, color: '#aaa', marginLeft: 6 }}>{trackInfo.artist}</span>}
        </div>
        {duration > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '7pt', color: '#888', flexShrink: 0 }}>{formatTime(position)}</span>
            <div
              ref={progressBarRef}
              style={{ flex: 1, height: 8, backgroundColor: '#333', borderRadius: 4, cursor: editingMarkers ? 'default' : 'pointer', position: 'relative', userSelect: 'none' }}
              onClick={e => {
                if (editingMarkers) return;
                if (draggingMarkerRef.current !== null) return;
                const rect = e.currentTarget.getBoundingClientRect();
                seek((e.clientX - rect.left) / rect.width);
              }}
            >
              {/* Playback fill */}
              <div style={{ height: '100%', backgroundColor: '#1db954', borderRadius: 4, width: `${Math.min(100, (position / duration) * 100)}%`, transition: draggingMarkerRef.current === -1 ? 'none' : 'width 0.5s linear', pointerEvents: 'none' }} />
              {/* Draggable playhead thumb — visible and draggable in edit mode */}
              {editingMarkers && (
                <div
                  title="Drag to scrub playback position"
                  style={{
                    position: 'absolute',
                    top: '50%', transform: 'translate(-50%, -50%)',
                    left: `${Math.min(100, (position / duration) * 100)}%`,
                    width: 14, height: 14,
                    borderRadius: '50%',
                    backgroundColor: 'white',
                    border: '2px solid #1db954',
                    boxShadow: '0 0 0 2px rgba(29,185,84,0.35)',
                    cursor: 'ew-resize',
                    zIndex: 10,
                    touchAction: 'none',
                  }}
                  onMouseDown={e => {
                    e.stopPropagation(); e.preventDefault();
                    draggingMarkerRef.current = -1; // -1 = playhead
                    const bar = progressBarRef.current;
                    if (!bar) return;
                    const rect = bar.getBoundingClientRect();
                    const onMove = (me: MouseEvent) => {
                      const pct = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
                      seek(pct);
                    };
                    const onUp = () => {
                      setTimeout(() => { draggingMarkerRef.current = null; }, 50);
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                  onTouchStart={e => {
                    e.stopPropagation();
                    draggingMarkerRef.current = -1;
                    const bar = progressBarRef.current;
                    if (!bar) return;
                    const rect = bar.getBoundingClientRect();
                    const onMove = (te: TouchEvent) => {
                      const pct = Math.max(0, Math.min(1, (te.touches[0].clientX - rect.left) / rect.width));
                      seek(pct);
                    };
                    const onEnd = () => {
                      setTimeout(() => { draggingMarkerRef.current = null; }, 50);
                      window.removeEventListener('touchmove', onMove);
                      window.removeEventListener('touchend', onEnd);
                    };
                    window.addEventListener('touchmove', onMove, { passive: true });
                    window.addEventListener('touchend', onEnd);
                  }}
                />
              )}
              {/* Section marker ticks */}
              {sectionMarkers?.map((m, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute', top: -4, bottom: -4,
                    left: `${Math.min(99, m.pct * 100)}%`,
                    width: editingMarkers ? 6 : 3,
                    backgroundColor: m.color,
                    borderRadius: 2, zIndex: 2,
                    cursor: editingMarkers ? 'ew-resize' : 'default',
                    transform: 'translateX(-50%)',
                    boxShadow: editingMarkers ? `0 0 0 2px white, 0 0 0 3px ${m.color}` : '0 0 0 1px rgba(255,255,255,0.4)',
                    touchAction: 'none',
                    transition: 'width 0.15s, box-shadow 0.15s',
                  }}
                  onMouseDown={editingMarkers ? e => {
                    e.stopPropagation(); e.preventDefault();
                    draggingMarkerRef.current = i;
                    const bar = progressBarRef.current;
                    if (!bar) return;
                    const rect = bar.getBoundingClientRect();
                    const onMove = (me: MouseEvent) => {
                      const newPct = Math.max(0.01, Math.min(0.99, (me.clientX - rect.left) / rect.width));
                      onMarkerDrag?.(i, newPct);
                    };
                    const onUp = () => {
                      setTimeout(() => { draggingMarkerRef.current = null; }, 50);
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  } : undefined}
                  onTouchStart={editingMarkers ? e => {
                    e.stopPropagation();
                    draggingMarkerRef.current = i;
                    const bar = progressBarRef.current;
                    if (!bar) return;
                    const rect = bar.getBoundingClientRect();
                    const onMove = (te: TouchEvent) => {
                      const newPct = Math.max(0.01, Math.min(0.99, (te.touches[0].clientX - rect.left) / rect.width));
                      onMarkerDrag?.(i, newPct);
                    };
                    const onEnd = () => {
                      setTimeout(() => { draggingMarkerRef.current = null; }, 50);
                      window.removeEventListener('touchmove', onMove);
                      window.removeEventListener('touchend', onEnd);
                    };
                    window.addEventListener('touchmove', onMove, { passive: true });
                    window.addEventListener('touchend', onEnd);
                  } : undefined}
                />
              ))}
            </div>
            <span style={{ fontSize: '7pt', color: '#888', flexShrink: 0 }}>{formatTime(duration)}</span>
            {/* Edit markers button */}
            {onEditMarkersToggle && (
              <button
                onClick={onEditMarkersToggle}
                title={editingMarkers ? 'Done editing markers' : 'Edit section markers'}
                style={{
                  flexShrink: 0, padding: '1px 6px', fontSize: '8pt', fontWeight: 600,
                  border: `1.5px solid ${editingMarkers ? '#f59e0b' : '#555'}`,
                  borderRadius: 3,
                  backgroundColor: editingMarkers ? '#f59e0b' : 'transparent',
                  color: editingMarkers ? 'white' : '#aaa',
                  cursor: 'pointer', fontFamily: 'Helvetica, sans-serif',
                  transition: 'all 0.15s',
                }}
              >{editingMarkers ? 'Done' : '⠿'}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


export default function App() {
  type HistoryEntry = {
    view: 'home' | 'editor' | 'archive' | 'preview' | 'setlist' | 'team';
    previewSong?: SavedSong | null;
    previewSetlist?: Setlist | null;
    previewSetlistIdx?: number;
    previewSourceTab?: 'public' | 'mine';
    selectedPlanId?: string | null;
  };

  const [view, setView] = useState<'home' | 'editor' | 'archive' | 'preview' | 'setlist' | 'team'>('archive');
  const [backStack, setBackStack] = useState<HistoryEntry[]>([]);
  const [forwardStack, setForwardStack] = useState<HistoryEntry[]>([]);
  const [songs, setSongs] = useState<SavedSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSong, setEditingSong] = useState<SavedSong | null>(null);
  const [previewSong, setPreviewSong] = useState<(SavedSong) | null>(null);
  const [previewSetlist, setPreviewSetlist] = useState<Setlist | null>(null);
  const [previewSetlistIdx, setPreviewSetlistIdx] = useState<number>(0);
  const [previewSourceTab, setPreviewSourceTab] = useState<'public' | 'mine'>('public');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [archiveTab, setArchiveTab] = useState<'public' | 'mine'>('public');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingRespondId, setPendingRespondId] = useState<string | null>(null);
  const [respondAssignmentId, setRespondAssignmentId] = useState<string | null>(null);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  useEffect(() => { store.get('spotify_token').then(v => { if (v) setSpotifyToken(v); }); }, []);
  const [showSpotifyConnect, setShowSpotifyConnect] = useState(false);
  const spotifyPlayerRef = React.useRef<any>(null);
  const spotifyDeviceIdRef = React.useRef<string | null>(null);
  const spotifyReadyRef = React.useRef(false);
  const spotifyTogglePlayRef = React.useRef<(() => void) | null>(null);

  // Initialize Spotify SDK as soon as we have a token — so it's warm by the time user opens a song
  React.useEffect(() => {
    if (!spotifyToken) return;
    const initGlobalPlayer = () => {
      if (spotifyPlayerRef.current) return;
      const p = new (window as any).Spotify.Player({
        name: 'Worship Archive',
        getOAuthToken: async (cb: any) => cb((await store.get('spotify_token')) || ''),
        volume: 0.8,
      });
      p.addListener('ready', ({ device_id }: any) => {
        spotifyDeviceIdRef.current = device_id;
        spotifyReadyRef.current = true;
      });
      p.addListener('not_ready', () => { spotifyReadyRef.current = false; });
      p.connect();
      spotifyPlayerRef.current = p;
    };
    if ((window as any).Spotify?.Player) {
      initGlobalPlayer();
    } else {
      (window as any).onSpotifyWebPlaybackSDKReady = initGlobalPlayer;
      if (!document.querySelector('script[src*="spotify-player"]')) {
        const script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      }
    }
  }, [spotifyToken]);

  const applyEntry = (entry: HistoryEntry) => {
    setView(entry.view);
    setPreviewSong(entry.previewSong ?? null);
    setPreviewSetlist(entry.previewSetlist ?? null);
    setPreviewSetlistIdx(entry.previewSetlistIdx ?? 0);
    setPreviewSourceTab(entry.previewSourceTab ?? 'public');
    setSelectedPlanId(entry.selectedPlanId ?? null);
  };

  // Use refs so navigate/navigateBack/navigateForward always see current values
  const viewRef = useRef(view);
  const previewSongRef = useRef(previewSong);
  const previewSetlistRef = useRef(previewSetlist);
  const previewSetlistIdxRef = useRef(previewSetlistIdx);
  const previewSourceTabRef = useRef(previewSourceTab);
  const backStackRef = useRef(backStack);
  const forwardStackRef = useRef(forwardStack);
  const selectedPlanIdRef = useRef(selectedPlanId);
  const deepLinkHandled = useRef(false);
  const [deepLinkNotFound, setDeepLinkNotFound] = useState(false);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { previewSongRef.current = previewSong; }, [previewSong]);
  useEffect(() => { previewSetlistRef.current = previewSetlist; }, [previewSetlist]);
  useEffect(() => { previewSetlistIdxRef.current = previewSetlistIdx; }, [previewSetlistIdx]);
  useEffect(() => { previewSourceTabRef.current = previewSourceTab; }, [previewSourceTab]);
  useEffect(() => { backStackRef.current = backStack; }, [backStack]);
  useEffect(() => { forwardStackRef.current = forwardStack; }, [forwardStack]);
  useEffect(() => { selectedPlanIdRef.current = selectedPlanId; }, [selectedPlanId]);

  const currentSnapshot = (): HistoryEntry => ({
    view: viewRef.current,
    previewSong: previewSongRef.current,
    previewSetlist: previewSetlistRef.current,
    previewSetlistIdx: previewSetlistIdxRef.current,
    previewSourceTab: previewSourceTabRef.current,
    selectedPlanId: selectedPlanIdRef.current,
  });

  const confirmLeaveEditor = () => {
    if (viewRef.current === 'editor') {
      return window.confirm('You have unsaved changes. Leave without saving?');
    }
    return true;
  };

  const navigate = useCallback((
    nextView: 'home' | 'editor' | 'archive' | 'preview' | 'setlist' | 'team',
    opts?: { song?: SavedSong; setlist?: Setlist | null; setlistIdx?: number; sourceTab?: 'public' | 'mine' }
  ) => {
    if (viewRef.current === 'editor' && nextView !== 'editor' && !confirmLeaveEditor()) return;
    setBackStack(b => [...b, currentSnapshot()]);
    setForwardStack([]);
    setView(nextView);
    if (opts?.song !== undefined) {
      setPreviewSong(opts.song);
      if (nextView === 'preview') {
        const key = (opts.song as any).openKey || opts.song.key;
        window.history.replaceState({}, '', `?song=${opts.song.id}&key=${encodeURIComponent(key)}`);
      }
    }
    if (nextView !== 'preview') {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (opts?.setlist !== undefined) setPreviewSetlist(opts.setlist);
    if (opts?.setlistIdx !== undefined) setPreviewSetlistIdx(opts.setlistIdx);
    if (opts?.sourceTab !== undefined) setPreviewSourceTab(opts.sourceTab);
  }, []);

  const navigateBack = useCallback(() => {
    if (!confirmLeaveEditor()) return;
    const b = backStackRef.current;
    if (b.length === 0) return;
    const prev = b[b.length - 1];
    setForwardStack(f => [...f, currentSnapshot()]);
    setBackStack(b.slice(0, -1));
    applyEntry(prev);
  }, []);

  const navigateForward = useCallback(() => {
    if (!confirmLeaveEditor()) return;
    const f = forwardStackRef.current;
    if (f.length === 0) return;
    const next = f[f.length - 1];
    setBackStack(b => [...b, currentSnapshot()]);
    setForwardStack(f.slice(0, -1));
    applyEntry(next);
  }, []);

  // Navigate without the unsaved-changes guard — use after a successful save
  const navigateDirect = useCallback((
    nextView: 'home' | 'editor' | 'archive' | 'preview' | 'setlist',
    opts?: { song?: SavedSong; setlist?: Setlist | null; setlistIdx?: number; sourceTab?: 'public' | 'mine' }
  ) => {
    setBackStack(b => [...b, currentSnapshot()]);
    setForwardStack([]);
    setView(nextView);
    if (opts?.song !== undefined) {
      setPreviewSong(opts.song);
      if (nextView === 'preview') {
        const key = (opts.song as any).openKey || opts.song.key;
        window.history.replaceState({}, '', `?song=${opts.song.id}&key=${encodeURIComponent(key)}`);
      }
    }
    if (nextView !== 'preview') {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (opts?.setlist !== undefined) setPreviewSetlist(opts.setlist);
    if (opts?.setlistIdx !== undefined) setPreviewSetlistIdx(opts.setlistIdx);
    if (opts?.sourceTab !== undefined) setPreviewSourceTab(opts.sourceTab);
  }, []);
  const [settings, setSettings] = useState<UserSettings>({ showCapoSuggestions: true });
  useEffect(() => {
    store.get('userSettings').then(saved => {
      try { if (saved) setSettings(JSON.parse(saved)); } catch {}
    });
  }, []);
  
  // Save settings to Preferences whenever they change
  useEffect(() => {
    store.set('userSettings', JSON.stringify(settings));
  }, [settings]);

  // Check for password reset link on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('type=recovery') || hash.includes('type=invite')) {
      setResetMode(true);
      setShowLogin(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
    // Save ?respond= to localStorage so it survives login
    const searchParams = new URLSearchParams(window.location.search);
    const respondId = searchParams.get('respond');
    if (respondId) {
      store.set('pending_respond_id', respondId);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Deep link: if ?song=<id> is in the URL, open that song once songs have loaded
  useEffect(() => {
    if (deepLinkHandled.current) return;
    if (loading) return;
    const searchParams = new URLSearchParams(window.location.search);
    const songId = searchParams.get('song');
    if (songId) {
      const song = songs.find(s => s.id === songId);
      if (song) {
        deepLinkHandled.current = true;
        const keyParam = searchParams.get('key');
        const songWithKey = keyParam ? { ...song, openKey: normalizeDisplayKey(keyParam) } : song;
        navigate('preview', { song: songWithKey, setlist: null });
      } else {
        deepLinkHandled.current = true;
        setDeepLinkNotFound(true);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [loading, songs]);

  // Restore session on mount, refreshing token if expired
  useEffect(() => {
    (async () => {
      const token = await store.get('auth_token');
      const refreshToken = await store.get('auth_refresh');
      if (token) {
        supaGetUser(token).then(async user => {
          if (user) {
            setAuthUser(user); 
            setAuthToken(token);
            // Set supabase auth session
            if (refreshToken) {
              supabase.auth.setSession({
                access_token: token,
                refresh_token: refreshToken
              });
            }
          } else {
            // Try refreshing
            const newToken = await supaRefreshToken();
            if (newToken) {
              const refreshedUser = await supaGetUser(newToken);
              if (refreshedUser) { 
                setAuthUser(refreshedUser); 
                setAuthToken(newToken);
                // Set supabase auth session
                const newRefreshToken = await store.get('auth_refresh');
                if (newRefreshToken) {
                  supabase.auth.setSession({
                    access_token: newToken,
                    refresh_token: newRefreshToken
                  });
                }
                return; 
              }
            }
            await store.remove('auth_token'); await store.remove('auth_refresh');
          }
        });
      }
    })();

    // Supabase's background auto-refresh timer relies on browser tab
    // visibility events, which don't fire reliably in a Capacitor WebView
    // when the app is backgrounded/foregrounded — so on native we drive it
    // explicitly off app state instead, and re-validate the session (with
    // a manual refresh fallback) every time the app comes back to the
    // foreground, so a token that expired while backgrounded gets renewed
    // immediately rather than surfacing as a logout later.
    let appStateHandle: any = null;
    if (Capacitor.isNativePlatform()) {
      supabase.auth.startAutoRefresh();
      import('@capacitor/app').then(({ App: CapApp }: any) => {
        CapApp.addListener('appStateChange', async ({ isActive }: { isActive: boolean }) => {
          if (isActive) {
            supabase.auth.startAutoRefresh();
            const token = await store.get('auth_token');
            if (token) {
              const user = await supaGetUser(token);
              if (!user) {
                const newToken = await supaRefreshToken();
                if (newToken) {
                  const refreshedUser = await supaGetUser(newToken);
                  if (refreshedUser) { setAuthUser(refreshedUser); setAuthToken(newToken); }
                }
              }
            }
          } else {
            supabase.auth.stopAutoRefresh();
          }
        }).then((h: any) => { appStateHandle = h; });
      }).catch(() => { /* not available on web */ });
    }

    return () => { if (appStateHandle) appStateHandle.remove(); };
  }, []);

  const handleLogin = (user: AuthUser, token: string) => {
    setAuthUser(user); 
    setAuthToken(token); 
    setShowLogin(false);
    
    // Set the auth session for supabase client
    store.get('auth_refresh').then(refresh => {
      supabase.auth.setSession({
        access_token: token,
        refresh_token: refresh || ''
      });
    });
  };

  const handleLogout = async () => {
    setAuthUser(null); 
    setAuthToken(null);
    await store.remove('auth_token'); 
    await store.remove('auth_refresh');
    // Clear supabase session
    supabase.auth.signOut();
  };

  // Load songs: public archive (all songs) always; logged-in user sees all
  const loadSongs = (token?: string | null) => {
    setLoading(true);
    supaFetch('songs?order=saved_at.desc', {}, token || undefined)
      .then(rows => setSongs((rows || []).map(fromRow)))
      .catch(e => console.error('Load error:', e))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSongs(authToken); }, [authToken]);

  // App-level plans + groups data (loaded eagerly so SetlistView renders instantly)
  const [appPlans, setAppPlans] = useState<Setlist[]>([]);
  const [appGroups, setAppGroups] = useState<PlanGroup[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const loadPlans = async (user: AuthUser) => {
    setPlansLoading(true);
    try {
      const [groupsRes, setlistsRes] = await Promise.all([
        supabase.from('plan_groups').select('*').eq('user_id', user.id).order('sort_order'),
        supabase.from('setlists').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ]);
      setAppGroups((groupsRes.data || []).map((g: any) => ({ id: g.id, name: g.name, sortOrder: g.sort_order })));
      const ids = (setlistsRes.data || []).map((s: any) => s.id);
      if (ids.length === 0) { setAppPlans([]); return; }
      const { data: entriesData } = await supabase
        .from('setlist_entries').select('*').in('setlist_id', ids).order('position');
      const entriesBySetlist: Record<string, any[]> = {};
      (entriesData || []).forEach((e: any) => {
        if (!entriesBySetlist[e.setlist_id]) entriesBySetlist[e.setlist_id] = [];
        entriesBySetlist[e.setlist_id].push({ songId: e.song_id, displayKey: e.display_key, leader: e.leader || '', entryNote: e.notes || '', position: e.position });
      });
      setAppPlans((setlistsRes.data || []).map((row: any) => ({
        id: row.id, name: row.name,
        entries: entriesBySetlist[row.id] || [],
        createdAt: new Date(row.created_at).getTime(),
        date: row.date || undefined,
        groupId: row.group_id || null,
      })));
    } catch (err) {
      console.error('Error loading plans:', err);
    } finally {
      setPlansLoading(false);
    }
  };

  // App-level team members (loaded eagerly)
  const [appTeamMembers, setAppTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  const loadTeam = async (user: AuthUser) => {
    setTeamLoading(true);
    try {
      const { data, error } = await supabase.from('team_members').select('*').eq('user_id', user.id).order('name');
      if (!error) setAppTeamMembers(data || []);
    } catch (err) {
      console.error('Error loading team:', err);
    } finally {
      setTeamLoading(false);
    }
  };

  // Kick off plans + team loads as soon as authUser is known
  useEffect(() => {
    if (authUser) {
      loadPlans(authUser);
      loadTeam(authUser);
    } else {
      setAppPlans([]);
      setAppGroups([]);
      setAppTeamMembers([]);
    }
  }, [authUser?.id]);

  // Once authToken is available, check for a pending respond link
  useEffect(() => {
    if (!authToken) return;
    (async () => {
      const respondId = await store.get('pending_respond_id');
      if (!respondId) return;
      await store.remove('pending_respond_id');
      // Fetch the assignment to find which plan it belongs to, then navigate there
      fetch(`${SUPABASE_URL}/rest/v1/setlist_assignments?id=eq.${respondId}&select=setlist_id`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${authToken}` }
      })
        .then(r => r.json())
        .then(data => {
          const planId = data?.[0]?.setlist_id;
          if (!planId) { alert('This invitation link is invalid or has expired.'); return; }
          setRespondAssignmentId(respondId);
          setSelectedPlanId(planId);
          navigate('setlist');
        })
        .catch(err => { console.error(err); alert('Failed to load invitation.'); });
    })();
  }, [authToken]);

  // Handle Spotify OAuth callback
  // Web: code comes back in window.location.search
  // Native: SFSafariViewController loads the redirect URL, we listen for browserPageLoaded
  useEffect(() => {
    const processCode = async (code: string) => {
      await Browser.close().catch(() => {});
      const token = await exchangeSpotifyCode(code);
      if (token) {
        await store.set('spotify_token', token);
        setSpotifyToken(token);
      } else {
        alert('Spotify login failed — could not exchange code for token.');
      }
    };

    // Web: check URL on mount
    const webParams = new URLSearchParams(window.location.search);
    const webCode = webParams.get('code');
    const webError = webParams.get('error');
    if (webError) {
      alert(`Spotify error: ${webError}`);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (webCode) {
      window.history.replaceState({}, '', window.location.pathname);
      processCode(webCode);
    }

    // Native: listen for the SFSafariViewController navigating to our redirect URL
    let listenerHandle: any = null;
    if (Capacitor.isNativePlatform()) {
      Browser.addListener('browserPageLoaded', async () => {
        // The browser loaded a page — check if it's our redirect with a code
        // We can't read the URL directly, but the redirect will trigger appUrlOpen
      }).then(h => { listenerHandle = h; });

      // Listen via App plugin for deep link / redirect URL (native only)
      // @ts-ignore
      import('@capacitor/app').then(({ App: CapApp }: any) => {
        CapApp.addListener('appUrlOpen', async (event: { url: string }) => {
          const url = event.url;
          if (url.includes('code=')) {
            const params = new URLSearchParams(url.split('?')[1] || '');
            const code = params.get('code');
            if (code) processCode(code);
          }
        });
      }).catch(() => { /* not available on web */ });
    }

    return () => {
      if (listenerHandle) listenerHandle.remove();
    };
  }, []);

  // Save spotify token to profile once authUser is available
  useEffect(() => {
    store.get('spotify_token').then(token => {
      if (!token || !authUser) return;
      supabase.from('profiles').upsert({ id: authUser.id, music_service: 'spotify', spotify_access_token: token });
    });
  }, [authUser]);

  // Validate stored Spotify token on load, refresh if expired
  useEffect(() => {
    store.get('spotify_token').then(token => {
      if (!token) return;
      // Small delay to avoid race with token just being saved from callback
      setTimeout(() => {
        fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${token}` } })
          .then(async r => {
            if (r.status === 401) {
              const newToken = await refreshSpotifyToken();
              if (newToken) {
                await store.set('spotify_token', newToken);
                setSpotifyToken(newToken);
              } else {
                await store.remove('spotify_token');
                setSpotifyToken(null);
              }
            }
          })
          .catch(() => {
            // Network error - keep the token
          });
      }, 1000);
    });
  }, []);

  const handleSave = async (song: SavedSong) => {
    if (!authUser || !authToken) { setShowLogin(true); return; }
    const mySongs = songs.filter(s => s.userId === authUser.id || (!s.userId && authUser.id === ADMIN_USER_ID));
    // Check for same title (any key) — offer to make a version
    const sameTitle = mySongs.filter(s => s.id !== song.id && !s.parentSongId && s.title.toLowerCase() === song.title.toLowerCase());
    if (sameTitle.length > 0 && !song.parentSongId) {
      const match = sameTitle[0];
      const choice = window.confirm(
        `A song called "${match.title}" already exists in your archive.\n\nClick OK to save this as a new version of "${match.title}".\nClick Cancel to save it as a separate song.`
      );
      if (choice) {
        song = { ...song, parentSongId: match.id };
      }
    } else {
      const exactMatch = mySongs.findIndex(s => s.id !== song.id && s.title.toLowerCase() === song.title.toLowerCase() && s.key === song.key && !s.parentSongId && !song.parentSongId);
      if (exactMatch >= 0) {
        if (!window.confirm(`"${song.title}" in ${song.key} already exists. Save anyway?`)) return;
      }
    }
    try {
      const tok1 = authToken!;
      const row = toRow(song, authUser.id);
      let saveError = null;
      try {
        await supaFetchWithRefresh('songs', {
          method: 'POST',
          body: JSON.stringify(row),
          headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' } as any,
        }, tok1);
        saveError = null;
      } catch (e: any) {
        // If save failed, try again without columns that might not exist yet
        const { tags: _tags, ghost_source_by_label: _gsl, ghost_source_by_blank: _gsb, ...rowWithoutNewCols } = row;
        await supaFetchWithRefresh('songs', {
          method: 'POST',
          body: JSON.stringify(rowWithoutNewCols),
          headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' } as any,
        }, tok1);
        saveError = 'tags_column_missing';
      }
      const newToken = authToken!;
      const rows = await supaFetch('songs?order=saved_at.desc', {}, newToken);
      const freshSongs = (rows || []).map(fromRow);
      setSongs(freshSongs);
      if (saveError === 'tags_column_missing') {
        alert(`"${song.title}" saved! Note: tags could not be saved — ask your admin to run:\nALTER TABLE songs ADD COLUMN tags text[];`);
      } else {
        alert(`"${song.title}" saved!`);
      }
      if (editingSong) {
        const updatedSong = { ...song, savedAt: Date.now() };
        setPreviewSong(updatedSong);
        navigateDirect('preview');
      } else {
        // If this song is currently being previewed, refresh it in place (e.g. rekeying from preview menu)
        if (view === 'preview') {
          setPreviewSong({ ...song, savedAt: Date.now() });
        } else {
          navigateDirect('archive');
        }
      }
    } catch (e) { alert('Save failed. Check your connection.'); console.error(e); }
  };

  // Add new version of an existing song
  const handleAddVersion = (parentId: string) => {
    const parent = songs.find(s => s.id === parentId);
    if (!parent) return;
    // Pre-fill editor with parent song content, mark it as a version
    const versionSeed: SavedSong = {
      ...parent,
      id: Date.now().toString(),
      parentSongId: parentId,
      artistName: '',
      savedAt: Date.now(),
    };
    setEditingSong(versionSeed);
    navigate('editor');
  };

  // Set preferred version on the parent song
  const handleSetPreferredVersion = async (parentId: string, versionId: string) => {
    if (!authUser) return;
    try {
      const tok = authToken!;
      await supaFetchWithRefresh(`songs?id=eq.${parentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ preferred_version_id: versionId }),
        headers: { 'Prefer': 'return=minimal' } as any,
      }, tok);
      setSongs(songs.map(s => s.id === parentId ? { ...s, preferredVersionId: versionId } : s));
    } catch (e) { console.error('Failed to set preferred version', e); }
  };

  // Bookmarks: stored in Supabase database
  const [bookmarks, setBookmarks] = React.useState<string[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = React.useState(true);

  // Load bookmarks from database when user logs in
  React.useEffect(() => {
    const loadBookmarks = async () => {
      if (!authUser) {
        setBookmarks([]);
        setBookmarksLoading(false);
        return;
      }
      
      setBookmarksLoading(true);
      try {
        const { data, error } = await supabase
          .from('bookmarks')
          .select('song_id')
          .eq('user_id', authUser.id);
        
        if (error) throw error;
        setBookmarks(data?.map((b: any) => b.song_id) || []);
      } catch (error) {
        console.error('Error loading bookmarks:', error);
        setBookmarks([]);
      } finally {
        setBookmarksLoading(false);
      }
    };
    
    loadBookmarks();
  }, [authUser?.id]);

  const handleBookmark = async (song: SavedSong) => {
    if (!authUser) { setShowLogin(true); return; }
    if (bookmarks.includes(song.id)) return; // already bookmarked
    
    try {
      const { error } = await supabase
        .from('bookmarks')
        .insert({ user_id: authUser.id, song_id: song.id });
      
      if (error) throw error;
      setBookmarks([...bookmarks, song.id]);
    } catch (error) {
      console.error('Error adding bookmark:', error);
      alert('Failed to save bookmark');
    }
  };

  const handleUnbookmark = async (songId: string) => {
    if (!authUser) return;
    
    try {
      const { error } = await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id', authUser.id)
        .eq('song_id', songId);
      
      if (error) throw error;
      setBookmarks(bookmarks.filter(id => id !== songId));
    } catch (error) {
      console.error('Error removing bookmark:', error);
      alert('Failed to remove bookmark');
    }
  };

  const handleDelete = async (id: string) => {
    if (!authToken) return;
    try {
      const tok = authToken!;
      await supaFetchWithRefresh(`songs?id=eq.${id}`, { method: 'DELETE' }, tok);
      setSongs(prev => prev.filter(s => s.id !== id));
    } catch (e) { alert('Delete failed.'); console.error(e); }
  };

  const handlePreview = (song: SavedSong, sourceTab?: 'public' | 'mine') => {
    // If this is a parent song with a preferred version, open that instead
    let resolved = song;
    if (!song.parentSongId && song.preferredVersionId) {
      const preferred = songs.find(s => s.id === song.preferredVersionId);
      if (preferred) resolved = preferred;
    }
    navigate('preview', { song: resolved, setlist: null, sourceTab: sourceTab || previewSourceTab });
  };

  const handleSetlistOpenSong = (song: SavedSong, setlist: Setlist, index: number) => {
    setSelectedPlanId(setlist.id);
    const entry = setlist.entries[index];
    // Resolve preferred version if available
    let resolved = song;
    if (!song.parentSongId && song.preferredVersionId) {
      const preferred = songs.find(s => s.id === song.preferredVersionId);
      if (preferred) resolved = preferred;
    }
    const songWithKey = entry?.displayKey ? { ...resolved, openKey: normalizeDisplayKey(entry.displayKey) } : resolved;
    navigate('preview', { song: songWithKey, setlist, setlistIdx: index });
  };

  const handleSetlistNav = async (dir: number) => {
    if (!previewSetlist || !authUser) return;

    // Skip over __element__ entries (Communion, Message, etc.) to find the next real song
    let newIdx = previewSetlistIdx + dir;
    while (newIdx >= 0 && newIdx < previewSetlist.entries.length) {
      const entry = previewSetlist.entries[newIdx];
      if (entry && entry.songId !== '__element__' && songs.find(s => s.id === entry.songId)) break;
      newIdx += dir;
    }
    if (newIdx < 0 || newIdx >= previewSetlist.entries.length) return;

    // Navigate immediately with cached data
    const entry = previewSetlist.entries[newIdx];
    if (!entry) return;
    const song = songs.find(s => s.id === entry.songId);
    if (!song) return;
    setPreviewSong({ ...song, openKey: normalizeDisplayKey(entry.displayKey) });
    setPreviewSetlistIdx(newIdx);

    // Refresh setlist in background so key changes stay up to date
    try {
      const { data: setlistData, error } = await supabase
        .from('setlists')
        .select(`
          id,
          name,
          date,
          created_at,
          entries:setlist_entries(song_id, display_key, position)
        `)
        .eq('id', previewSetlist.id)
        .eq('user_id', authUser.id)
        .single();
      
      if (!error && setlistData) {
        const freshSetlist = {
          id: setlistData.id,
          name: setlistData.name,
          createdAt: new Date(setlistData.created_at).getTime(),
          entries: (setlistData.entries as any[])
            .sort((a, b) => a.position - b.position)
            .map(e => ({ songId: e.song_id, displayKey: e.display_key }))
        };
        setPreviewSetlist(freshSetlist);
        // Update the song's key in case it changed
        const freshEntry = freshSetlist.entries[newIdx];
        if (freshEntry) setPreviewSong(s => s ? { ...s, openKey: normalizeDisplayKey(freshEntry.displayKey) } : s);
      }
    } catch (error) {
      console.error('Error refreshing setlist:', error);
    }
  };

  const handleEditFromPreview = () => {
    if (previewSong) { setEditingSong({ ...previewSong } as any); navigate('editor'); }
  };

  const handleNew = () => { setEditingSong(null); navigate('editor'); };

  const handleSpotifyDisconnect = async () => {
    await store.remove('spotify_token');
    setSpotifyToken(null);
    if (authUser) {
      supabase.from('profiles').upsert({ id: authUser.id, music_service: null, spotify_access_token: null });
    }
  };

  useGlobalSwipe(navigateBack, navigateForward, view === 'editor' ? 'low' : 'normal', view === 'preview' && !!previewSetlist && window.innerWidth < 768 && previewSetlistIdx > 0);

  // Prevent horizontal scroll globally on mobile
  React.useEffect(() => {
    document.body.style.overflowX = 'hidden';
    document.documentElement.style.overflowX = 'hidden';
    document.documentElement.style.maxWidth = '100vw';
    return () => {
      document.body.style.overflowX = '';
      document.documentElement.style.overflowX = '';
      document.documentElement.style.maxWidth = '';
    };
  }, []);

  if (deepLinkNotFound) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', fontFamily: '"Inter", system-ui, sans-serif', padding: 24 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🎵</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Song not found</div>
      <div style={{ fontSize: 15, color: '#64748b', marginBottom: 32, textAlign: 'center', maxWidth: 360 }}>
        This link may be broken, or the song may have been removed. Try asking the sender for an updated link.
      </div>
      <button
        onClick={() => { setDeepLinkNotFound(false); navigate('archive'); }}
        style={{ padding: '12px 24px', fontSize: 15, fontWeight: 600, backgroundColor: '#0f172a', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer' }}
      >Go to Archive</button>
    </div>
  );

  if (view === 'archive' || view === 'home') return (
    <>
      <ArchiveView songs={songs} loading={loading} onNew={handleNew} onPreview={handlePreview} onDelete={handleDelete} onSetlist={() => navigate('setlist')} onTeam={() => navigate('team')} authUser={authUser} onLogin={() => setShowLogin(true)} onLogout={handleLogout} onBookmark={handleBookmark} onUnbookmark={handleUnbookmark} bookmarks={bookmarks} archiveTab={archiveTab} setArchiveTab={setArchiveTab} spotifyToken={spotifyToken} onSpotifyDisconnect={handleSpotifyDisconnect} onSpotifyConnect={connectSpotifyNative} />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLogin={handleLogin} resetMode={resetMode} />}
    </>
  );
  if (view === 'team') { navigate('setlist'); return null; }
  if (view === 'setlist') return (
    <SetlistView songs={songs} onBack={() => navigate('archive')} onHome={() => navigate('archive')} onOpenSong={handleSetlistOpenSong} authUser={authUser} selectedPlanId={selectedPlanId} setSelectedPlanId={setSelectedPlanId} respondAssignmentId={respondAssignmentId} onRespondDone={() => setRespondAssignmentId(null)} initialPlans={appPlans} initialGroups={appGroups} plansLoading={plansLoading} onPlansChange={setAppPlans} onNavigate={navigate} />
  );
  if (view === 'preview' && previewSong) return (
    <>
      <SongPreview
        key={previewSong.id + '|' + (previewSong.savedAt || 0)}
        song={previewSong}
        onEdit={handleEditFromPreview}
        onBack={navigateBack}
        onForward={navigateForward}
        onHome={() => navigate('archive')}
        setlist={previewSetlist}
        setlistIdx={previewSetlistIdx}
        onSetlistNav={handleSetlistNav}
        authUser={authUser}
        onBookmark={handleBookmark}
        isBookmarked={previewSong ? bookmarks.includes(previewSong.id) : false}
        sourceTab={previewSourceTab}
        onDuplicate={(duplicatedSong) => {
          handleSave(duplicatedSong);
          setEditingSong(duplicatedSong);
          navigate('editor');
        }}
        onCopyToPublic={(publicSong) => {
          handleSave(publicSong);
          alert(`"${publicSong.title}" has been copied to the Public Archive.`);
        }}
        settings={settings}
        onSettingsChange={setSettings}
        spotifyToken={spotifyToken}
        spotifyPlayer={spotifyPlayerRef}
        spotifyDeviceId={spotifyDeviceIdRef}
        spotifyReady={spotifyReadyRef}
        spotifyTogglePlay={spotifyTogglePlayRef}
        onSave={handleSave}
        allSongs={songs}
        onAddVersion={handleAddVersion}
        onSetPreferredVersion={handleSetPreferredVersion}
        onSwitchVersion={(s) => { 
          setPreviewSong({ ...s, savedAt: Date.now() });
          const key = (s as any).openKey || s.key;
          window.history.replaceState({}, '', `?song=${s.id}&key=${encodeURIComponent(key)}`);
        }}
        onDisplayKeyChange={(k) => {
          if (previewSong) {
            window.history.replaceState({}, '', `?song=${previewSong.id}&key=${encodeURIComponent(k)}`);
          }
        }}
      />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLogin={handleLogin} resetMode={resetMode} />}

    </>
  );
  return (
    <div>
      <AppBar onHome={() => navigate('archive')}
        backButton={
          <button onClick={navigateBack} style={{ ...APP_BAR_BTN, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor='#f1f5f9'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor='#ffffff'}
          >
            {editingSong && previewSong ? `← ${editingSong.title}` : '← Archive'}
          </button>
        }
      >
        <span style={{ fontSize: '13px', color: '#94a3b8', fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 500 }}>
          {editingSong ? `Editing: ${editingSong.title}` : 'New Song'}
        </span>
        {editingSong && (
          <button
            onClick={() => {
              if (window.confirm(`Are you sure you want to delete "${editingSong.title}"? This cannot be undone.`)) {
                handleDelete(editingSong.id);
                navigate('archive');
              }
            }}
            style={APP_BAR_BTN_DANGER}
            onMouseEnter={e => e.currentTarget.style.backgroundColor='#fecaca'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor='#fee2e2'}
          >Delete Song</button>
        )}
      </AppBar>
      <ChartEditor onSave={handleSave} onDelete={handleDelete} initialSong={editingSong} authUser={authUser} spotifyToken={spotifyToken} />
    </div>
  );
}