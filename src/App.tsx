// src/App.tsx
import React, { useState, useEffect } from "react";
import jsPDF from "jspdf";

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
  // Editor state
  sectionLabels?: string[];
  sectionRepeats?: number[];
  blankSections?: { afterIdx: number; label: string; repeat: number }[];
  manualSplits?: { sectionIdx: number; lineIdx: number }[];
  manualMerges?: number[];
  lineOverrides?: { [key: string]: string };
}


// ============================
// Section colors (shared across all views)
// ============================
// ============================
// Supabase client
// ============================
const SUPABASE_URL = 'https://bmilrzahvfvaojzovszf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JIsdCuXs4Gbqy_DtPuwD2A_7OQdDN0X';

const supaFetch = async (path: string, options: RequestInit = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...((options as any).headers || {}),
    },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

// Convert camelCase SavedSong ↔ snake_case DB row
const toRow = (s: SavedSong) => ({
  id: s.id, title: s.title, bpm: s.bpm, writers: s.writers,
  key: s.key, input: s.input, saved_at: s.savedAt,
  section_labels: s.sectionLabels ?? null,
  section_repeats: s.sectionRepeats ?? null,
  blank_sections: s.blankSections ?? null,
  manual_splits: s.manualSplits ?? null,
  manual_merges: s.manualMerges ?? null,
  line_overrides: s.lineOverrides ?? null,
});

const fromRow = (r: any): SavedSong => ({
  id: r.id, title: r.title, bpm: r.bpm || '', writers: r.writers || '',
  key: r.key, input: r.input, savedAt: r.saved_at,
  sectionLabels: r.section_labels ?? undefined,
  sectionRepeats: r.section_repeats ?? undefined,
  blankSections: r.blank_sections ?? undefined,
  manualSplits: r.manual_splits ?? undefined,
  manualMerges: r.manual_merges ?? undefined,
  lineOverrides: r.line_overrides ?? undefined,
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
// Section Type Detection
// ============================
const detectSectionType = (sectionLines: string[], allSections: string[][], sectionIndex: number): string => {
  const allText = sectionLines.join(' ').toLowerCase();
  
  // Count slashes, bars, and actual words
  const slashCount = allText.split('/').length - 1;
  const barCount = allText.split('|').length - 1;
  const wordCount = allText.split(/\s+/).filter(word => /[a-z]{3,}/.test(word)).length;
  
  // Check for instrumental intro/interlude (lots of slashes/bars, few words)
  if ((slashCount > 10 || barCount > 3) && wordCount < 5) {
    // If it's the first section, it's likely an intro
    if (sectionIndex === 0) return 'Intro';
    // If it's near the end, could be outro
    if (sectionIndex >= allSections.length - 2) return 'Outro';
    return 'Instrumental';
  }
  
  // Check for explicit section indicators in text
  if (/chorus|refrain/i.test(allText)) return 'Chorus';
  if (/verse|stanza/i.test(allText)) return 'Verse';
  if (/bridge/i.test(allText)) return 'Bridge';
  if (/intro/i.test(allText)) return 'Intro';
  if (/outro|ending/i.test(allText)) return 'Outro';
  if (/pre.*chorus|prechorus/i.test(allText)) return 'Pre-Chorus';
  if (/interlude|instrumental/i.test(allText)) return 'Instrumental';
  if (/tag|coda/i.test(allText)) return 'Tag';
  
  // Last section is often an outro, especially if it's short or repeating
  const isLastSection = sectionIndex === allSections.length - 1;
  
  // Extract chords from this section
  const getChords = (lines: string[]): string => {
    return lines
      .filter(line => {
        const normalized = line.replace(/\u00A0/g, " ").replace(/\t/g, " ").trim();
        const tokens = normalized.split(" ").filter(Boolean);
        return tokens.some(t => /^[A-G][#b]?/.test(t.replace(/[()]/g, '')));
      })
      .join(' ')
      .toLowerCase();
  };
  
  const thisChords = getChords(sectionLines);
  
  // Very short sections are likely tags - check this BEFORE repetition check
  // Tags are typically 1-3 lines with minimal lyrics (not full verses/choruses)
  const nonEmptyLines = sectionLines.filter(line => line.trim().length > 0);
  const linesWithLyrics = sectionLines.filter(line => {
    const normalized = line.replace(/\u00A0/g, " ").trim();
    // Count lines that have actual words (not just chords/slashes/bars)
    return /[a-z]{3,}/i.test(normalized);
  });
  
  // If 3 or fewer lines total AND 2 or fewer lines with actual lyrics = Tag
  // BUT if it's the last section, it's likely an Outro
  if (nonEmptyLines.length <= 3 && linesWithLyrics.length <= 2 && wordCount > 0) {
    // Last section is usually outro, not tag
    if (sectionIndex === allSections.length - 1) {
      return 'Outro';
    }
    return 'Tag';
  }
  
  // Check if this section's chords/lyrics repeat elsewhere (likely chorus)
  const thisContent = sectionLines.join('||').toLowerCase();
  let repetitionCount = 0;
  
  allSections.forEach((otherSection, idx) => {
    if (idx !== sectionIndex) {
      const otherContent = otherSection.join('||').toLowerCase();
      // Check for exact or very similar matches
      if (thisContent === otherContent || 
          (thisContent.length > 20 && otherContent.includes(thisContent.substring(0, Math.min(50, thisContent.length))))) {
        repetitionCount++;
      }
    }
  });
  
  // If this section repeats 2+ times, likely a chorus
  if (repetitionCount >= 2) return 'Chorus';
  
  // First section with lyrics is usually verse
  if (sectionIndex === 0 || (sectionIndex === 1 && allSections[0].join('').split(/[a-z]{3,}/).length < 3)) {
    return 'Verse';
  }
  
  // Compare chord progression to previous sections
  let matchesPreviousVerse = false;
  
  for (let i = 0; i < sectionIndex; i++) {
    const prevChords = getChords(allSections[i]);
    
    // If chords are very similar to a previous verse, this is probably another verse
    if (prevChords.length > 10 && thisChords.length > 10) {
      const similarity = calculateSimilarity(prevChords, thisChords);
      if (similarity > 0.7) {
        matchesPreviousVerse = true;
        break;
      }
    }
  }
  
  if (matchesPreviousVerse) return 'Verse';
  
  // Bridge usually appears in the latter half of the song
  const positionRatio = sectionIndex / Math.max(allSections.length - 1, 1);
  if (positionRatio > 0.5 && wordCount > 5) {
    // Check if chords are different from earlier sections
    let isDifferent = true;
    for (let i = 0; i < Math.min(sectionIndex, 3); i++) {
      const earlyChords = getChords(allSections[i]);
      const similarity = calculateSimilarity(thisChords, earlyChords);
      if (similarity > 0.6) {
        isDifferent = false;
        break;
      }
    }
    if (isDifferent) return 'Bridge';
  }
  
  // If repeats once, might be chorus
  if (repetitionCount >= 1) return 'Chorus';
  
  // If it's the last section, it's likely an outro
  if (isLastSection) return 'Outro';
  
  // Default to verse
  return 'Verse';
};

// Helper function to calculate similarity between two chord progressions
const calculateSimilarity = (chords1: string, chords2: string): number => {
  const tokens1 = chords1.split(/\s+/).filter(t => /[a-g][#b]?/.test(t));
  const tokens2 = chords2.split(/\s+/).filter(t => /[a-g][#b]?/.test(t));
  
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  
  let matches = 0;
  const maxLen = Math.max(tokens1.length, tokens2.length);
  const minLen = Math.min(tokens1.length, tokens2.length);
  
  for (let i = 0; i < minLen; i++) {
    if (tokens1[i] === tokens2[i]) matches++;
  }
  
  return matches / maxLen;
};

// ============================
// Chord conversion functions
// ============================
const nashvilleToChord = (token: string, key: string) => {
  const scale = KEYS[key];
  if (!scale) return token;
  const degree = parseInt(token[0]) - 1;
  if (isNaN(degree) || degree < 0 || degree >= scale.length) return token;
  return scale[degree] + token.slice(1);
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
    if (!scale) return token;
    let baseMatch = chordCore.match(/[A-G][#b]?/);
    if (!baseMatch) return token;

    let baseNote = baseMatch[0];
    let degree = scale.indexOf(baseNote);
    if (degree === -1 && ENHARMONICS[baseNote]) {
      baseNote = ENHARMONICS[baseNote];
      degree = scale.indexOf(baseNote);
    }
    if (degree === -1) return token;

    const modifier = chordCore.slice(baseNote.length);
    chordCore = nashvilleToChord((degree + 1).toString() + modifier, outputKey);
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
  const tokens = normalizeLine(line).split(" ").filter(Boolean);
  if (!tokens.length) return false;
  return (
    tokens.filter((t) => {
      const cleaned = t.replace(/[()]/g, '');
      return /^[A-G][#b]?((m|7|dim|aug|sus2|sus4)?[0-9]*)?(\/[A-G][#b]?)?\.?$/.test(cleaned);
    }).length > 0
  );
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
  displaySections: { lines: string[]; baseSectionIdx: number; lineOffset: number }[];
  blankSections: { afterIdx: number; label: string; repeat: number }[];
  sectionLabels: string[]; sectionRepeats: number[];
  lineOverrides: { [key: string]: string };
}

function exportSongPDF(params: ExportParams) {
  const doc = new jsPDF();
  // Override to US Letter (215.9 x 279.4 mm)
  (doc.internal.pageSize as any).width = 215.9;
  (doc.internal.pageSize as any).height = 279.4;

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
  const leftText = (params.bpm ? `${params.bpm} bpm  ` : '') + `[${params.displayKey}]`;
  doc.text(leftText, margin, headerY, { baseline: "top" } as any);

  doc.setFontSize(17);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  doc.text(params.title || "Untitled", pageWidth / 2, headerY, { align: "center", baseline: "top" } as any);

  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(grayColor, grayColor, grayColor);
  if (params.writers) {
    doc.text(params.writers, pageWidth - margin, headerY, { align: "right", baseline: "top" } as any);
  }
  doc.setTextColor(0, 0, 0);

  let yPos = headerY + 10;
  const sectionCounts: { [key: string]: number } = {};

  // ---- PROCESS SECTIONS ----
  // Build same combined row order as UI
  const pdfRows: Array<{type: 'section', sectionIdx: number, baseSectionIdx: number, lineOffset: number, lines: string[]} | {type: 'blank', label: string, repeat: number}> = [];
  params.displaySections.forEach(({ lines, baseSectionIdx, lineOffset }, sectionIdx) => {
    pdfRows.push({ type: 'section', sectionIdx, baseSectionIdx, lineOffset, lines });
    params.blankSections
      .filter(b => b.afterIdx === sectionIdx)
      .forEach(b => pdfRows.push({ type: 'blank', label: b.label, repeat: b.repeat ?? 1 }));
  });
  params.blankSections
    .filter(b => b.afterIdx >= params.displaySections.length)
    .forEach(b => pdfRows.push({ type: 'blank', label: b.label, repeat: b.repeat ?? 1 }));

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
      const blankRowHeight = usePill ? blankRepeat * (PILL_H + 2) : (blankRepeat > 1 ? 9 : 5);
      if (yPos + blankRowHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
      const blankBgVal = pdfRowIdx % 2 === 0 ? 255 : 243;
      doc.setFillColor(blankBgVal, blankBgVal, blankBgVal);
      doc.rect(margin - 1, yPos - 1, pageWidth - (margin * 2) + 2, blankRowHeight + 1, 'F');
      if (usePill) {
        for (let rep = 0; rep < blankRepeat; rep++) {
          const repLabel = blankBase + (sectionCounts[blankBase] - blankRepeat + 1 + rep);
          const pillY = yPos + rep * (PILL_H + 2);
          doc.setDrawColor(br, bg2, bb); doc.setLineWidth(0.5);
          (doc as any).roundedRect(bpX - PILL_W/2, pillY, PILL_W, PILL_H, PILL_R, PILL_R, 'S');
          doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(br, bg2, bb);
          doc.text(repLabel, bpX, pillY + PILL_H/2, { align: "center", baseline: "middle" } as any);
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
      if (fl.length === 0) rowHeight += 2.5;
      else if (isChordLine(fl)) rowHeight += 5.5;
      else rowHeight += 6.5;
    });
    rowHeight += 2; // minimal buffer for descenders (g, y, p etc)
    // Only expand row if pill stack is taller than content
    const repeatsForHeight = params.sectionRepeats[sectionIdx] ?? 1;
    const sectionTypeForHeight = params.sectionLabels[sectionIdx] || 'Verse';
    const usesPillStack = ['Verse','Chorus','Bridge'].includes(sectionTypeForHeight);
    const pillStackHeight = usesPillStack ? repeatsForHeight * (PILL_H + 2) - 2 + 2 : PILL_H + 2;
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
      // Apply chord nudge overrides
      const pdfLineKey = `${baseSectionIdx}-${lineOffset + lineIdx}`;
      if (params.lineOverrides[pdfLineKey]) processedLine = params.lineOverrides[pdfLineKey];
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
          doc.setFontSize(13);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(0, 0, 0);
          const converted = finalLine
            .split(/(\s+)/)
            .map(t => /^\s*$/.test(t) ? t : convertChord(t, params.originalKey, params.displayKey, params.inputType === "letters"))
            .join('');
          doc.text(converted, contentStart, yPos, { baseline: "top" } as any);
          yPos += 5.5;
        } else {
          doc.setFontSize(16);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(0, 0, 0);
          doc.text(finalLine, contentStart, yPos, { baseline: "top" } as any);
          yPos += 6.5;
        }
      } else {
        yPos += 2.5;
      }
    });

    // Advance by full rowHeight so pill stacks never overlap next section
    // If section was entirely empty, still draw the label
    if (!pillDrawn) {
      const base = labelText.replace(/[0-9]/g, '');
      const usePill = SHORT_LABELS.includes(base);
      if (usePill) {
        const x = pillX - PILL_W / 2;
        doc.setDrawColor(r, g, b);
        doc.setLineWidth(0.5);
        (doc as any).roundedRect(x, sectionStartY, PILL_W, PILL_H, PILL_R, PILL_R, 'S');
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(r, g, b);
        doc.text(labelText, pillX, sectionStartY + PILL_H / 2, { align: "center", baseline: "middle" } as any);
        doc.setTextColor(0, 0, 0);
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

  doc.save(`${params.title || 'chart'}.pdf`);
}

function ChartEditor({ onSave, initialSong }: { onSave: (song: SavedSong) => void, initialSong?: SavedSong | null }) {
  const [songInput, setSongInput] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [songBPM, setSongBPM] = useState("");
  const [songWriters, setSongWriters] = useState("");
  const [originalKey, setOriginalKey] = useState("G");
  const [key, setKey] = useState("G");
  const [sectionLabels, setSectionLabels] = useState<string[]>([]);
  const [sectionRepeats, setSectionRepeats] = useState<number[]>([]);
  const loadedLabelsRef = React.useRef(false);

  // Load from saved song if provided
  useEffect(() => {
    if (initialSong) {
      setSongTitle(initialSong.title);
      setSongBPM(initialSong.bpm);
      setSongWriters(initialSong.writers);
      setOriginalKey(initialSong.key);
      setKey((initialSong as any).openKey || initialSong.key);
      setSongInput(initialSong.input);
      if (initialSong.sectionLabels) { setSectionLabels(initialSong.sectionLabels); loadedLabelsRef.current = true; }
      if (initialSong.sectionRepeats) setSectionRepeats(initialSong.sectionRepeats);
      if (initialSong.blankSections) setBlankSections(initialSong.blankSections);
      if (initialSong.manualSplits) setManualSplits(initialSong.manualSplits);
      if (initialSong.manualMerges) setManualMerges(initialSong.manualMerges);
      if (initialSong.lineOverrides) setLineOverrides(initialSong.lineOverrides);
    }
  }, []);
  // Manual splits: array of {sectionIdx, lineIdx} break points inserted by user
  const [manualSplits, setManualSplits] = useState<{sectionIdx: number, lineIdx: number}[]>([]);
  // Chord offsets: key = "sectionIdx-lineIdx-tokenIdx", value = spaces added/removed
  // lineOverrides: store modified chord line strings keyed "baseSectionIdx-absoluteLineIdx"
  const [lineOverrides, setLineOverrides] = useState<{[key: string]: string}>({});
  const [selectedChord, setSelectedChord] = useState<string | null>(null); // "lineKey-tokenIdx"
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
      const tokens = normalized.split(" ").filter(Boolean);
      
      for (const token of tokens) {
        if (/^[1-7]/.test(token)) {
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
    }
  }, [songInput, inputType]);

  // Process sections from lines
  const sections: string[][] = React.useMemo(() => {
    const result: string[][] = [];
    let currentSection: string[] = [];
    
    lines.forEach((line) => {
      if (line.startsWith('"')) {
        if (currentSection.length > 0) {
          result.push(currentSection);
          currentSection = [];
        }
        let content = line.slice(1);
        if (content.endsWith('"')) content = content.slice(0, -1);
        if (content.trimStart().startsWith('.')) {
          const leadingSpaces = content.match(/^\s*/)?.[0] || '';
          const afterSpaces = content.slice(leadingSpaces.length);
          if (afterSpaces.startsWith('.')) {
            content = leadingSpaces + afterSpaces.slice(1);
          }
        }
        currentSection.push(content);
      } else if (line.startsWith('(')) {
        if (currentSection.length > 0) {
          result.push(currentSection);
          currentSection = [];
        }
        currentSection.push(line);
      } else {
        currentSection.push(line.endsWith('"') ? line.slice(0, -1) : line);
      }
    });
    
    if (currentSection.length > 0) {
      result.push(currentSection);
    }
    
    return result;
  }, [songInput]);

  // Initialize section labels and repeats when sections change
  useEffect(() => {
    if (sections.length > 0 && sections.length !== sectionLabels.length) {
      // Skip auto-detection if we loaded labels from a saved song
      if (loadedLabelsRef.current) { loadedLabelsRef.current = false; return; }
      const newLabels = sections.map((section, idx) => detectSectionType(section, sections, idx));
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
  const [blankSections, setBlankSections] = useState<{afterIdx: number, label: string, repeat: number}[]>([]);

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
    setBlankSections(prev => [...prev, { afterIdx, label: 'Chorus', repeat: 1 }]);
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

  // Nudge a chord: modify the actual whitespace in the line string
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
    exportSongPDF({
      title: songTitle, bpm: songBPM, writers: songWriters,
      originalKey, displayKey: key,
      inputType,
      displaySections, blankSections, sectionLabels, sectionRepeats, lineOverrides,
    });
  };

  return (
    <div style={{ fontFamily: "Helvetica, sans-serif", padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center", fontFamily: "Helvetica, sans-serif", fontSize: "24pt" }}>ChartApp</h1>

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

      {/* BPM and Writers */}
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
          <label style={{ display: "block", marginBottom: 4, fontFamily: "Helvetica, sans-serif", fontSize: "12pt", fontWeight: "bold" }}>Writers:</label>
          <input
            type="text"
            value={songWriters}
            onChange={(e) => setSongWriters(e.target.value)}
            placeholder="e.g., John Doe, Jane Smith"
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
      </div>

      {/* Original Key */}
      {inputType === "letters" && renderPicker("Original Key", originalKey, setOriginalKey)}

      {/* Song Input */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", marginBottom: 4, fontFamily: "Helvetica, sans-serif", fontSize: "12pt" }}>Chords + Lyrics:</label>
        <textarea
          value={songInput}
          onChange={(e) => setSongInput(e.target.value)}
          rows={10}
          style={{ width: "100%", fontFamily: "Helvetica, sans-serif", fontSize: "12pt", padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
          placeholder='Paste your chart here. Use " to start a new section.'
        />
      </div>

      {/* Output Key */}
      {renderPicker("Output Key", key, setKey)}

      {/* Buttons */}
      <div style={{ marginBottom: 10, display: 'flex', gap: '10px' }}>
        <button 
          onClick={() => {
            const outputDiv = document.getElementById('chord-output');
            if (!outputDiv) return;
            
            const temp = document.createElement('div');
            temp.style.position = 'absolute';
            temp.style.left = '-9999px';
            temp.innerHTML = outputDiv.innerHTML;
            
            const dividers = temp.querySelectorAll('div[style*="borderBottom"]');
            dividers.forEach(divider => divider.remove());
            
            const selects = temp.querySelectorAll('select');
            selects.forEach(select => select.remove());
            
            document.body.appendChild(temp);
            
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(temp);
            selection?.removeAllRanges();
            selection?.addRange(range);
            
            try {
              document.execCommand('copy');
              selection?.removeAllRanges();
              document.body.removeChild(temp);
              
              alert('Copied!');
            } catch (err) {
              document.body.removeChild(temp);
              console.error('Copy failed');
            }
          }}
          style={{ 
            padding: '6px 12px', 
            fontSize: '12pt', 
            cursor: 'pointer',
            backgroundColor: 'white',
            color: 'black',
            border: '1px solid black',
            borderRadius: '4px',
            fontFamily: "Helvetica, sans-serif"
          }}
        >
          Copy
        </button>

        <button 
          onClick={exportToPDF}
          style={{ 
            padding: '6px 12px', 
            fontSize: '12pt', 
            cursor: 'pointer',
            backgroundColor: 'white',
            color: 'black',
            border: '1px solid black',
            borderRadius: '4px',
            fontFamily: "Helvetica, sans-serif"
          }}
        >
          Export to PDF
        </button>

        <button
          onClick={() => {
            if (!songTitle.trim()) { alert('Please enter a song title before saving.'); return; }
            onSave({
              id: initialSong?.id || Date.now().toString(),
              title: songTitle,
              bpm: songBPM,
              writers: songWriters,
              key: originalKey,
              input: songInput,
              savedAt: Date.now(),
              sectionLabels: [...sectionLabels],
              sectionRepeats: [...sectionRepeats],
              blankSections: [...blankSections],
              manualSplits: [...manualSplits],
              manualMerges: [...manualMerges],
              lineOverrides: {...lineOverrides},
            });
          }}
          style={{
            padding: '6px 12px',
            fontSize: '12pt',
            cursor: 'pointer',
            backgroundColor: '#1a1a1a',
            color: 'white',
            border: '1px solid #1a1a1a',
            borderRadius: '4px',
            fontFamily: "Helvetica, sans-serif"
          }}
        >
          {initialSong ? 'Update in Archive' : 'Save to Archive'}
        </button>


      </div>

      {/* Render Chords */}
      <div id="chord-output" onClick={() => setSelectedChord(null)} style={{ border: "1px solid #ccc", borderRadius: 4, padding: 6, whiteSpace: "pre-wrap", backgroundColor: "transparent" }}>
        {(() => {
          // Build a combined ordered list of all rows: display sections + blank rows interleaved
          type DisplayRow = { type: 'section'; sectionIdx: number; baseSectionIdx: number; lineOffset: number; lines: string[] };
          type BlankRow   = { type: 'blank'; blankIdx: number; label: string };
          type AnyRow = DisplayRow | BlankRow;

          const rows: AnyRow[] = [];
          displaySections.forEach(({ lines, baseSectionIdx, lineOffset }, sectionIdx) => {
            rows.push({ type: 'section', sectionIdx, baseSectionIdx, lineOffset, lines });
            // Insert any blank rows that go after this sectionIdx
            blankSections
              .map((b, i) => ({ ...b, blankIdx: i }))
              .filter(b => b.afterIdx === sectionIdx)
              .forEach(b => rows.push({ type: 'blank', blankIdx: b.blankIdx, label: b.label }));
          });
          // Blank rows with afterIdx beyond displaySections go at the end
          blankSections
            .map((b, i) => ({ ...b, blankIdx: i }))
            .filter(b => b.afterIdx >= displaySections.length)
            .forEach(b => rows.push({ type: 'blank', blankIdx: b.blankIdx, label: b.label }));

          // Compute pill start-count for each row (v1, v2, c1, etc.)
          const pillStartCount: Record<number, number> = {};
          const runningCounts: Record<string, number> = {};
          rows.forEach((row, idx) => {
            const labelType = row.type === 'section'
              ? (sectionLabels[row.sectionIdx] || 'Verse')
              : (blankSections[row.blankIdx]?.label || 'Verse');
            const base = labelType === 'Verse' ? 'v' : labelType === 'Chorus' ? 'c' : labelType === 'Bridge' ? 'b' : null;
            if (base) {
              if (!runningCounts[base]) runningCounts[base] = 0;
              pillStartCount[idx] = runningCounts[base] + 1;
              const rep = row.type === 'section' ? (sectionRepeats[row.sectionIdx] ?? 1) : (blankSections[row.blankIdx]?.repeat ?? 1);
              runningCounts[base] += rep;
            }
          });

          return (
        <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "Helvetica, sans-serif", backgroundColor: "transparent", border: "0pt", borderColor: "white" }}>
          <tbody>
            {rows.map((row, rowRenderIdx) => {
              const rowBg = rowRenderIdx % 2 === 0 ? "#ffffff" : "#f3f3f3";

              if (row.type === 'blank') {
                const { blankIdx, label } = row;
                return (
                  <React.Fragment key={`blank-${blankIdx}`}>
                    <tr style={{ backgroundColor: rowBg }}>
                      <td style={{ padding: "6px 8px 6px 6px", verticalAlign: "top", backgroundColor: rowBg, width: "120px" }}>
                        {/* Pill preview */}
                        {(() => {
                          const color = SECTION_COLORS_HEX[label] || '#6b7280';
                          const base = label === 'Verse' ? 'v' : label === 'Chorus' ? 'c' : label === 'Bridge' ? 'b' : null;
                          const rep = blankSections[blankIdx]?.repeat ?? 1;
                          if (base) {
                            const startNum = pillStartCount[rowRenderIdx] || 1;
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
                                {Array.from({ length: rep }).map((_, r) => (
                                  <span key={r} style={{ display: 'inline-block', border: `1.5px solid ${color}`, borderRadius: 1, padding: '2px 7px', fontSize: '10pt', fontWeight: 700, color, width: 'fit-content', fontFamily: 'Helvetica, sans-serif' }}>
                                    {base}{startNum + r}
                                  </span>
                                ))}
                              </div>
                            );
                          }
                          const shortLabel = label === 'Pre-Chorus' ? 'pre ch' : label === 'Instrumental' ? 'inst' : label.toLowerCase();
                          return (
                            <div style={{ marginBottom: 6 }}>
                              <span style={{ fontSize: '10pt', fontWeight: 700, color: '#666', fontFamily: 'Helvetica, sans-serif' }}>
                                {shortLabel}{rep > 1 ? <span style={{ display: 'block', fontSize: '7pt' }}>x{rep}</span> : null}
                              </span>
                            </div>
                          );
                        })()}
                        <select
                          value={label}
                          onChange={(e) => setBlankSections(prev => prev.map((s,i) => i === blankIdx ? {...s, label: e.target.value} : s))}
                          style={{ fontFamily: "Helvetica, sans-serif", fontSize: "10pt", width: "100%", padding: "4px", border: "1px solid #ccc", borderRadius: "4px", backgroundColor: rowBg }}
                        >
                          <option value="Intro">Intro</option>
                          <option value="Verse">Verse</option>
                          <option value="Pre-Chorus">Pre-Chorus</option>
                          <option value="Chorus">Chorus</option>
                          <option value="Bridge">Bridge</option>
                          <option value="Instrumental">Instrumental</option>
                          <option value="Outro">Outro</option>
                          <option value="Tag">Tag</option>
                        </select>
                        <div style={{ display: "flex", alignItems: "center", marginTop: 4, gap: 4 }}>
                          <label style={{ fontFamily: "Helvetica, sans-serif", fontSize: "9pt", color: "#666" }}>Repeat:</label>
                          <input
                            type="number" min={1} max={8}
                            value={(blankSections[blankIdx]?.repeat) ?? 1}
                            onChange={(e) => setBlankSections(prev => prev.map((s,i) => i === blankIdx ? {...s, repeat: Math.max(1, Math.min(8, parseInt(e.target.value) || 1))} : s))}
                            style={{ fontFamily: "Helvetica, sans-serif", fontSize: "9pt", width: "40px", padding: "2px 4px", border: "1px solid #ccc", borderRadius: "4px", backgroundColor: rowBg }}
                          />
                        </div>
                        <button
                          onClick={() => setBlankSections(prev => prev.filter((_, i) => i !== blankIdx))}
                          style={{ marginTop: 4, width: "100%", fontSize: "8pt", padding: "2px 4px", border: "1px solid #fca5a5", borderRadius: "4px", backgroundColor: rowBg, cursor: "pointer", color: "#ef4444", fontFamily: "Helvetica, sans-serif" }}
                        >✕ remove</button>
                      </td>
                      <td style={{ padding: "6px 6px 6px 0", verticalAlign: "top", backgroundColor: rowBg }}>
                        <div style={{ height: "1.2em" }} />
                      </td>
                    </tr>
                    <tr style={{ height: '8px' }}>
                      <td colSpan={2}
                        onMouseEnter={() => setHoveredBlankInsert(-(blankIdx + 1))}
                        onMouseLeave={() => setHoveredBlankInsert(null)}
                        onClick={() => { setBlankSections(prev => [...prev, { afterIdx: -(blankIdx+1), label: 'Chorus', repeat: 1 }]); setHoveredBlankInsert(null); }}
                        style={{ padding: 0, cursor: 'pointer', height: '8px' }}
                      >
                        {hoveredBlankInsert === -(blankIdx + 1) && (
                          <div style={{ width: '100%', height: '2px', backgroundColor: '#22c55e', borderRadius: '1px', opacity: 0.7 }} />
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              }

              // Section row
              const { sectionIdx, baseSectionIdx, lineOffset, lines: section } = row;
              return (
              <React.Fragment key={`section-${sectionIdx}`}>
                <tr style={{ border: "0pt", borderColor: "white", backgroundColor: rowBg }}>
                  {/* Section Label Column */}
                  <td style={{ padding: "6px 8px 6px 6px", margin: 0, border: "0pt", borderColor: "white", verticalAlign: "top", backgroundColor: rowBg, width: "120px" }}>
                    {/* Pill preview */}
                    {(() => {
                      const labelType = sectionLabels[sectionIdx] || 'Verse';
                      const color = SECTION_COLORS_HEX[labelType] || '#6b7280';
                      const base = labelType === 'Verse' ? 'v' : labelType === 'Chorus' ? 'c' : labelType === 'Bridge' ? 'b' : null;
                      const repeats = sectionRepeats[sectionIdx] ?? 1;
                      if (base) {
                        const startNum = pillStartCount[rowRenderIdx] || 1;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
                            {Array.from({ length: repeats }).map((_, r) => (
                              <span key={r} style={{ display: 'inline-block', border: `1.5px solid ${color}`, borderRadius: 1, padding: '2px 7px', fontSize: '10pt', fontWeight: 700, color, width: 'fit-content', fontFamily: 'Helvetica, sans-serif' }}>
                                {base}{startNum + r}
                              </span>
                            ))}
                          </div>
                        );
                      }
                      const shortLabel = labelType === 'Pre-Chorus' ? 'pre ch' : labelType === 'Instrumental' ? 'inst' : labelType.toLowerCase();
                      return (
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ fontSize: '10pt', fontWeight: 700, color: '#666', fontFamily: 'Helvetica, sans-serif' }}>
                            {shortLabel}{repeats > 1 ? <span style={{ display: 'block', fontSize: '7pt' }}>x{repeats}</span> : null}
                          </span>
                        </div>
                      );
                    })()}
                    <select 
                      value={sectionLabels[sectionIdx] || 'Verse'} 
                      onChange={(e) => {
                        const newLabels = [...sectionLabels];
                        newLabels[sectionIdx] = e.target.value;
                        setSectionLabels(newLabels);
                      }}
                      style={{ 
                        fontFamily: "Helvetica, sans-serif", 
                        fontSize: "10pt", 
                        width: "100%",
                        padding: "4px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        backgroundColor: rowBg
                      }}
                    >
                      <option value="Intro">Intro</option>
                      <option value="Verse">Verse</option>
                      <option value="Pre-Chorus">Pre-Chorus</option>
                      <option value="Chorus">Chorus</option>
                      <option value="Bridge">Bridge</option>
                      <option value="Instrumental">Instrumental</option>
                      <option value="Outro">Outro</option>
                      <option value="Tag">Tag</option>
                    </select>
                    <div style={{ display: "flex", alignItems: "center", marginTop: 4, gap: 4 }}>
                      <label style={{ fontFamily: "Helvetica, sans-serif", fontSize: "9pt", color: "#666" }}>Repeat:</label>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={sectionRepeats[sectionIdx] ?? 1}
                        onChange={(e) => {
                          const newRepeats = [...sectionRepeats];
                          newRepeats[sectionIdx] = Math.max(1, Math.min(8, parseInt(e.target.value) || 1));
                          setSectionRepeats(newRepeats);
                        }}
                        style={{
                          fontFamily: "Helvetica, sans-serif",
                          fontSize: "9pt",
                          width: "40px",
                          padding: "2px 4px",
                          border: "1px solid #ccc",
                          borderRadius: "4px",
                          backgroundColor: rowBg
                        }}
                      />
                    </div>
                    {sectionIdx > 0 && (
                      <button
                        onClick={() => mergeWithAbove(sectionIdx)}
                        title="Merge with section above"
                        style={{
                          marginTop: 4,
                          width: "100%",
                          fontSize: "8pt",
                          padding: "2px 4px",
                          border: "1px solid #ccc",
                          borderRadius: "4px",
                          backgroundColor: rowBg,
                          cursor: "pointer",
                          color: "#666",
                          fontFamily: "Helvetica, sans-serif",
                        }}
                      >↑ merge up</button>
                    )}
                  </td>
                  
                  {/* Content Column */}
                  <td style={{ padding: "6px 6px 6px 0", margin: 0, border: "0pt", borderColor: "white", verticalAlign: "top", backgroundColor: rowBg }}>
                    {section.map((line, idx) => {
                      let processedLine = line;
                      if (processedLine.endsWith('"')) {
                        processedLine = processedLine.slice(0, -1);
                      }
                      // Apply any line overrides from chord nudging
                      const lineKey = `${baseSectionIdx}-${lineOffset + idx}`;
                      if (lineOverrides[lineKey]) processedLine = lineOverrides[lineKey];
                      const trimmedLine = processedLine.trimEnd();
                      const finalLine = trimmedLine.replace(/ /g, '\u00A0');
                      
                      const isFirstLine = idx === 0;
                      const needsAnchor = isFirstLine && finalLine.length > 0 && finalLine[0] === '\u00A0';
                      // Split lines reference the base section and absolute line index
                      const baseLineIdx = lineOffset + idx;
                      const splitExists = hasSplit(baseSectionIdx, baseLineIdx);
                      const isHovered = hoveredSplit?.sectionIdx === baseSectionIdx && hoveredSplit?.lineIdx === baseLineIdx;
                      const showSplitLine = idx < section.length - 1; // don't show after last line in display section

                      return (
                        <div key={idx} style={{ position: 'relative' }}>
                          {finalLine.length > 0 ? (
                            isChordLine(finalLine) ? (
                              (() => {
                                const nextLine = idx + 1 < section.length ? section[idx + 1] : '';
                                const cleanNextLine = nextLine.endsWith('"') ? nextLine.slice(0, -1).trimEnd() : nextLine.trimEnd();
                                const hasLyricsBelow = cleanNextLine.length > 0 && !isChordLine(cleanNextLine);
                                let chordTokenIdx = 0;
                                
                                return (
                                  <pre style={{ fontFamily: "Helvetica, sans-serif", fontSize: "9.75pt", fontWeight: "700", margin: "0", padding: "0", lineHeight: "1", backgroundColor: "transparent" }}>{needsAnchor && <span style={{ color: 'transparent', fontSize: '1px' }}>.</span>}{finalLine
                                      .split(/(\s+)/)
                                      .map((t, i, arr) => {
                                        if (/^\s*$/.test(t)) {
                                          const prevToken = i > 0 ? arr[i - 1] : '';
                                          const nextToken = i < arr.length - 1 ? arr[i + 1] : '';
                                          
                                          let spacingAdjustment = 0;
                                          let hasException = false;
                                          
                                          if (nextToken && (nextToken === '/' || nextToken === '|' || nextToken.startsWith('.'))) {
                                            hasException = true;
                                          } else if (prevToken && prevToken.endsWith('.')) {
                                            hasException = true;
                                          }
                                          
                                          if (hasLyricsBelow && !hasException && prevToken) {
                                            if (prevToken && !/^\s*$/.test(prevToken)) {
                                              if (prevToken.includes('/')) {
                                                const parts = prevToken.split('/');
                                                const convertedParts = convertChord(prevToken, originalKey, key, inputType === "letters").split('/');
                                                
                                                parts.forEach((part, partIdx) => {
                                                  const originalHasAccidental = /[#b]/.test(part);
                                                  const newHasAccidental = convertedParts[partIdx] ? /[#b]/.test(convertedParts[partIdx]) : false;
                                                  
                                                  if (!originalHasAccidental && newHasAccidental) {
                                                    spacingAdjustment -= 2;
                                                  } else if (originalHasAccidental && !newHasAccidental) {
                                                    spacingAdjustment += 2;
                                                  }
                                                });
                                              } else {
                                                const originalHasAccidental = /[#b]/.test(prevToken);
                                                const converted = convertChord(prevToken, originalKey, key, inputType === "letters");
                                                const newHasAccidental = /[#b]/.test(converted);
                                                
                                                if (!originalHasAccidental && newHasAccidental) {
                                                  spacingAdjustment = -2;
                                                } else if (originalHasAccidental && !newHasAccidental) {
                                                  spacingAdjustment = 2;
                                                }
                                              }
                                            }
                                          }
                                          
                                          let spaces = t;
                                          if (spacingAdjustment < 0) {
                                            spaces = spaces.slice(0, Math.max(0, spaces.length + spacingAdjustment));
                                          } else if (spacingAdjustment > 0) {
                                            spaces = spaces + ' '.repeat(spacingAdjustment);
                                          }
                                          
                                          return spaces;
                                        } else {
                                          const cIdx = chordTokenIdx++;
                                          const converted = convertChord(t, originalKey, key, inputType === "letters");
                                          const chordSelectKey = `${lineKey}-${cIdx}`;
                                          const isSelected = selectedChord === chordSelectKey;
                                          return (
                                            <span
                                              key={chordSelectKey}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (isSelected) {
                                                  setSelectedChord(null);
                                                  selectedChordRef.current = null;
                                                } else {
                                                  setSelectedChord(chordSelectKey);
                                                  selectedChordRef.current = { key: lineKey, tokenIdx: cIdx };
                                                  // Seed lineOverride with current line if not already set
                                                  setLineOverrides(prev => prev[lineKey] ? prev : { ...prev, [lineKey]: trimmedLine });
                                                }
                                              }}
                                              style={{
                                                cursor: 'pointer',
                                                borderBottom: isSelected ? '2px solid #3b82f6' : 'none',
                                                color: isSelected ? '#3b82f6' : 'inherit',
                                              }}
                                            >{converted}</span>
                                          );
                                        }
                                      })}</pre>
                                );
                              })()
                            ) : (
                              (() => {
                                const prevLine = idx > 0 ? section[idx - 1] : '';
                                const cleanPrevLine = prevLine.endsWith('"') ? prevLine.slice(0, -1).trimEnd() : prevLine.trimEnd();
                                const hasChordsAbove = cleanPrevLine.length > 0 && isChordLine(cleanPrevLine);
                                
                                if (hasChordsAbove) {
                                  const chordTokens = cleanPrevLine.split(/(\s+)/);
                                  let currentPos = 0;
                                  const adjustments: { position: number; adjustment: number }[] = [];
                                  
                                  for (let i = 0; i < chordTokens.length; i++) {
                                    const t = chordTokens[i];
                                    if (/^\s*$/.test(t)) {
                                      const prevToken = i > 0 ? chordTokens[i - 1] : '';
                                      const nextToken = i < chordTokens.length - 1 ? chordTokens[i + 1] : '';
                                      
                                      let spacingAdjustment = 0;
                                      let hasException = false;
                                      
                                      if (nextToken && (nextToken === '/' || nextToken === '|' || nextToken.startsWith('.'))) {
                                        hasException = true;
                                      } else if (prevToken && prevToken.endsWith('.')) {
                                        hasException = true;
                                      }
                                      
                                      if (hasException && prevToken && !/^\s*$/.test(prevToken)) {
                                        if (prevToken.includes('/')) {
                                          const parts = prevToken.split('/');
                                          const convertedParts = convertChord(prevToken, originalKey, key, inputType === "letters").split('/');
                                          
                                          parts.forEach((part, partIdx) => {
                                            const originalHasAccidental = /[#b]/.test(part);
                                            const newHasAccidental = convertedParts[partIdx] ? /[#b]/.test(convertedParts[partIdx]) : false;
                                            
                                            if (!originalHasAccidental && newHasAccidental) {
                                              spacingAdjustment += 2;
                                            } else if (originalHasAccidental && !newHasAccidental) {
                                              spacingAdjustment -= 2;
                                            }
                                          });
                                        } else {
                                          const originalHasAccidental = /[#b]/.test(prevToken);
                                          const converted = convertChord(prevToken, originalKey, key, inputType === "letters");
                                          const newHasAccidental = /[#b]/.test(converted);
                                          
                                          if (!originalHasAccidental && newHasAccidental) {
                                            spacingAdjustment += 2;
                                          } else if (originalHasAccidental && !newHasAccidental) {
                                            spacingAdjustment -= 2;
                                          }
                                        }
                                      }
                                      
                                      if (spacingAdjustment !== 0) {
                                        adjustments.push({ position: currentPos, adjustment: spacingAdjustment });
                                      }
                                      currentPos += t.length;
                                    } else {
                                      currentPos += t.length;
                                    }
                                  }
                                  
                                  let adjustedLyrics = finalLine;
                                  let offset = 0;
                                  
                                  adjustments.forEach(({ position, adjustment }) => {
                                    const actualPos = position + offset;
                                    
                                    if (adjustment < 0) {
                                      const charsToRemove = Math.abs(adjustment);
                                      let removed = 0;
                                      
                                      for (let i = actualPos; i < adjustedLyrics.length && removed < charsToRemove; i++) {
                                        if (adjustedLyrics[i] === ' ') {
                                          adjustedLyrics = adjustedLyrics.slice(0, i) + adjustedLyrics.slice(i + 1);
                                          removed++;
                                          i--;
                                        } else {
                                          break;
                                        }
                                      }
                                      offset -= removed;
                                      
                                    } else if (adjustment > 0) {
                                      let insertPos = actualPos;
                                      
                                      while (insertPos < adjustedLyrics.length && adjustedLyrics[insertPos] !== ' ') {
                                        insertPos++;
                                      }
                                      
                                      adjustedLyrics = adjustedLyrics.slice(0, insertPos) + ' '.repeat(adjustment) + adjustedLyrics.slice(insertPos);
                                      offset += adjustment;
                                    }
                                  });
                                  
                                  return <pre style={{ fontFamily: "Helvetica, sans-serif", fontSize: "12pt", fontWeight: "400", margin: "0", padding: "0", lineHeight: "1", backgroundColor: "transparent" }}>{adjustedLyrics}</pre>;
                                }
                                
                                return <pre style={{ fontFamily: "Helvetica, sans-serif", fontSize: "12pt", fontWeight: "400", margin: "0", padding: "0", lineHeight: "1", backgroundColor: "transparent" }}>{finalLine}</pre>;
                              })()
                            )
                          ) : <div style={{ height: "1.2em" }}></div>}
                          {/* Split line - hover to preview, click to add/remove */}
                          {showSplitLine && (
                            <div
                              onMouseEnter={() => setHoveredSplit({sectionIdx: baseSectionIdx, lineIdx: baseLineIdx})}
                              onMouseLeave={() => setHoveredSplit(null)}
                              onClick={() => splitExists ? removeSplit(baseSectionIdx, baseLineIdx) : addSplit(baseSectionIdx, baseLineIdx)}
                              style={{
                                height: '8px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                margin: '0 -6px',
                              }}
                            >
                              {(isHovered || splitExists) && (
                                <div style={{
                                  width: '100%',
                                  height: '2px',
                                  backgroundColor: splitExists ? '#3b82f6' : '#94a3b8',
                                  opacity: splitExists ? 1 : 0.6,
                                  borderRadius: '1px',
                                }} />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </td>
                </tr>
                {/* Blank row insert zone - appears at bottom of each section */}
                <tr style={{ height: '8px', backgroundColor: 'transparent' }}>
                  <td colSpan={2}
                    onMouseEnter={() => setHoveredBlankInsert(sectionIdx)}
                    onMouseLeave={() => setHoveredBlankInsert(null)}
                    onClick={() => { insertBlankAfter(sectionIdx); setHoveredBlankInsert(null); }}
                    style={{ padding: 0, cursor: 'pointer', height: '8px' }}
                  >
                    {hoveredBlankInsert === sectionIdx && (
                      <div style={{ width: '100%', height: '2px', backgroundColor: '#22c55e', borderRadius: '1px', opacity: 0.7 }} />
                    )}
                  </td>
                </tr>
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
          );
        })()}
      </div>
    </div>
  );
}

// ============================
// Song Archive View
// ============================
// ============================
// Song Preview (read-only chart view)
// ============================
// Build exportSongPDF params from a SavedSong, using saved editor state when available
function buildExportParams(song: SavedSong, displayKey: string): ExportParams {
  const inputType: "letters" | "numbers" = (() => {
    for (const line of song.input.split("\n")) {
      for (const t of line.split(" ").filter(Boolean)) {
        if (/^[1-7]/.test(t)) return "numbers";
        if (/^[A-G]/.test(t)) return "letters";
      }
    }
    return "letters";
  })();

  // Parse raw sections from input
  const rawLines = song.input.split("\n").map((l: string) =>
    l.startsWith(". ") ? l.slice(2) : l.startsWith(".") ? l.slice(1) : l
  );
  const baseSections: string[][] = [];
  let cur: string[] = [];
  rawLines.forEach((line: string) => {
    if (line.startsWith('"') || line.startsWith("(")) {
      if (cur.length > 0) baseSections.push(cur);
      let first = line.startsWith('"') ? line.slice(1) : line;
      if (first.endsWith('"')) first = first.slice(0, -1);
      cur = [first];
    } else {
      cur.push(line.endsWith('"') ? line.slice(0, -1) : line);
    }
  });
  if (cur.length > 0) baseSections.push(cur);

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
    originalKey: song.key,
    displayKey,
    inputType,
    displaySections,
    blankSections: song.blankSections || [],
    sectionLabels: song.sectionLabels || displaySections.map(() => "Verse"),
    sectionRepeats: song.sectionRepeats || displaySections.map(() => 1),
    lineOverrides: song.lineOverrides || {},
  };
}

function SongPreview({ song, onEdit, onBack }: {
  song: SavedSong & { openKey?: string };
  onEdit: () => void;
  onBack: () => void;
}) {
  const KEY_LIST = ['Ab','A','Bb','B','C','Db','D','Eb','E','F','F#','G'];
  const [displayKey, setDisplayKey] = useState<string>((song as any).openKey || song.key);
  const params = buildExportParams(song, displayKey);

  const sectionColors = SECTION_COLORS_HEX;

  const isChordLine = (line: string) => {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    const chordCount = tokens.filter(t =>
      /^[A-G][#b]?(m|maj|min|dim|aug|sus|add)?[0-9]?(\/[A-G][#b]?)?$|^[1-7](b|#)?(m|maj|min|dim|aug|sus|add)?[0-9]?(\/[1-7])?$/.test(t) || t === "/" || t === "|" || t.startsWith(".")
    ).length;
    return chordCount / tokens.length > 0.5;
  };

  // Build same combined row order as PDF: display sections + blank rows interleaved
  type PreviewRow =
    | { type: "section"; sectionIdx: number; lines: string[]; label: string; repeat: number }
    | { type: "blank"; label: string; repeat: number };

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
    .forEach(b => rows.push({ type: "blank", label: b.label, repeat: b.repeat }));

  // Running lookup of most recent lines per label — updated during render for position-aware ghost content
  const lastLinesByLabel: Record<string, string[]> = {};

  // Section label counter for pill text (v1, v2, c1, etc.)
  const sectionCounts: Record<string, number> = {};
  const getLabelText = (labelType: string) => {
    const base = labelType === "Verse" ? "v" : labelType === "Chorus" ? "c" : labelType === "Bridge" ? "b"
      : labelType === "Pre-Chorus" ? "pre ch" : labelType === "Instrumental" ? "inst"
      : labelType === "Intro" ? "intro" : labelType === "Outro" ? "outro" : labelType === "Tag" ? "tag"
      : labelType.toLowerCase();
    const isPill = ["v","c","b"].includes(base);
    if (!sectionCounts[base]) sectionCounts[base] = 0;
    sectionCounts[base]++;
    return isPill ? `${base}${sectionCounts[base]}` : base;
  };

  return (
    <div style={{ fontFamily: "Helvetica, sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      {/* Top bar */}
      <div style={{ padding: "10px 20px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 12, backgroundColor: "#fafafa", position: "sticky", top: 0, zIndex: 10 }}>
        <button onClick={onBack} style={{ padding: "4px 12px", fontSize: "10pt", cursor: "pointer", backgroundColor: "white", border: "1px solid #ccc", borderRadius: 4, fontFamily: "Helvetica, sans-serif" }}>← Worship Archive</button>
        <button onClick={onEdit} style={{ padding: "4px 14px", fontSize: "10pt", fontWeight: 700, cursor: "pointer", backgroundColor: "#1a1a1a", color: "white", border: "none", borderRadius: 4, fontFamily: "Helvetica, sans-serif" }}>Edit</button>
        <button onClick={() => exportSongPDF(params)} style={{ padding: "4px 14px", fontSize: "10pt", cursor: "pointer", backgroundColor: "white", border: "1px solid #ccc", borderRadius: 4, fontFamily: "Helvetica, sans-serif" }}>Export PDF</button>
        <span style={{ marginLeft: 8, fontSize: "13pt", fontWeight: 700 }}>{song.title}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 0, border: "1px solid #ccc", borderRadius: 4, overflow: "hidden" }}>
            {KEY_LIST.map(k => (
              <button
                key={k}
                onClick={() => setDisplayKey(k)}
                style={{
                  padding: "3px 7px 5px",
                  fontSize: "9pt",
                  cursor: "pointer",
                  border: "none",
                  borderRight: "1px solid #ccc",
                  backgroundColor: k === displayKey ? "#1a1a1a" : "white",
                  color: k === displayKey ? "white" : "#333",
                  fontFamily: "Helvetica, sans-serif",
                  fontWeight: k === displayKey ? 700 : 400,
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                {k}
                {k === song.key && (
                  <span style={{
                    width: 3, height: 3, borderRadius: "50%",
                    backgroundColor: k === displayKey ? "white" : "#1a1a1a",
                    display: "block",
                  }} />
                )}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ padding: "20px 20px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16, padding: "0 4px" }}>
          <span style={{ color: "#888", fontSize: "9pt", fontStyle: "italic" }}>{song.bpm ? `${song.bpm} BPM` : ""}{song.bpm && displayKey ? " · " : ""}{displayKey}</span>
          <span style={{ fontSize: "17pt", fontWeight: 400, fontFamily: "Helvetica, sans-serif" }}>{song.title}</span>
          <span style={{ color: "#888", fontSize: "9pt", fontStyle: "italic" }}>{song.writers}</span>
        </div>

        <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "Helvetica, sans-serif" }}>
          <tbody>
            {rows.map((row, rowIdx) => {
              const rowBg = rowIdx % 2 === 0 ? "#ffffff" : "#f3f3f3";
              // Update running last-seen lines for ghost content
              if (row.type === "section") lastLinesByLabel[row.label] = row.lines;

              if (row.type === "blank") {
                const color = sectionColors[row.label] || "#6b7280";
                const labelTexts: string[] = [];
                for (let r = 0; r < row.repeat; r++) labelTexts.push(getLabelText(row.label));
                const ghostLines = lastLinesByLabel[row.label] || [];
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
                      {ghostLines.length > 0 ? (
                        <div style={{ opacity: 0.75 }}>
                          {ghostLines.map((line, lIdx) => {
                            const normalized = line.replace(/\u00A0/g, ' ').trimEnd();
                            if (!normalized) return <div key={lIdx} style={{ height: "1em" }} />;
                            const isChord = isChordLine(normalized);
                            const displayed = normalized.split(/(\s+)/).map(t =>
                              /^\s+$/.test(t) ? t : (isChord ? convertChord(t, song.key, displayKey, params.inputType === "letters") : t)
                            ).join("").replace(/ /g, "\u00A0");
                            return (
                              <pre key={lIdx} style={{
                                margin: 0, padding: 0, lineHeight: 1.3,
                                fontFamily: "Helvetica, sans-serif",
                                fontSize: isChord ? "13pt" : "16pt",
                                fontWeight: isChord ? 700 : 400,
                                backgroundColor: "transparent",
                              }}>{displayed}</pre>
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
              const labelText = getLabelText(label);
              const isPill = /^[vcb]\d+$/.test(labelText);

              return (
                <tr key={`section-${row.sectionIdx}`} style={{ backgroundColor: rowBg }}>
                  <td style={{ width: 64, padding: "8px 8px", verticalAlign: "top" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {Array.from({ length: repeat }).map((_, r) => {
                        const repText = repeat > 1 ? (isPill ? `${labelText.replace(/\d+$/, '')}${parseInt(labelText.match(/\d+$/)?.[0] || "1") + r - (r === 0 ? 0 : 0)}` : labelText) : labelText;
                        // For stacked repeats, recalculate properly
                        const stackText = (() => {
                          if (!isPill) return r === 0 ? labelText : null;
                          const base = labelText.replace(/\d+$/, '');
                          const num = parseInt(labelText.match(/\d+$/)?.[0] || "1");
                          return `${base}${num + r}`;
                        })();
                        if (stackText === null) return null;
                        return isPill ? (
                          <span key={r} style={{ display: "inline-block", border: `1.5px solid ${color}`, borderRadius: 1, padding: "2px 6px", fontSize: "10pt", fontWeight: 700, color, width: "fit-content" }}>{stackText}</span>
                        ) : (
                          <span key={r} style={{ fontSize: "10pt", fontWeight: 700, color: "#666" }}>
                            {labelText}{repeat > 1 && <span style={{ display: "block", fontSize: "7pt" }}>x{repeat}</span>}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td style={{ padding: "8px 6px", verticalAlign: "top", backgroundColor: rowBg }}>
                    {lines.map((line, lIdx) => {
                      const overrideKey = `${params.displaySections[row.sectionIdx]?.baseSectionIdx ?? row.sectionIdx}-${lIdx}`;
                      const finalLine = params.lineOverrides[overrideKey] || line;
                      const trimmed = finalLine.replace(/\u00A0/g, ' ').trimEnd();
                      if (!trimmed) return <div key={lIdx} style={{ height: "1em" }} />;
                      const isChord = isChordLine(trimmed);
                      const displayed = trimmed.split(/(\s+)/).map(t =>
                        /^\s+$/.test(t) ? t : (isChord ? convertChord(t, song.key, displayKey, params.inputType === "letters") : t)
                      ).join("").replace(/ /g, "\u00A0");
                      return (
                        <pre key={lIdx} style={{
                          margin: 0, padding: 0, lineHeight: 1.3,
                          fontFamily: "Helvetica, sans-serif",
                          fontSize: isChord ? "13pt" : "16pt",
                          fontWeight: isChord ? 700 : 400,
                          backgroundColor: "transparent",
                        }}>{displayed}</pre>
                      );
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArchiveView({ songs, loading, onNew, onPreview, onDelete }: {
  songs: SavedSong[];
  loading?: boolean;
  onNew: () => void;
  onPreview: (song: SavedSong & { openKey?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<Record<string, string>>({});
  const [sortCol, setSortCol] = useState<'title' | 'key' | 'bpm' | 'writers'>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const KEY_LIST = ['Ab','A','Bb','B','C','Db','D','Eb','E','F','F#','G'];

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortedSongs = [...songs].sort((a, b) => {
    if (sortCol === 'bpm') {
      const aNum = parseFloat(a.bpm) || 0;
      const bNum = parseFloat(b.bpm) || 0;
      return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
    }
    const aStr = (sortCol === 'key' ? a.key : sortCol === 'writers' ? a.writers : a.title) || '';
    const bStr = (sortCol === 'key' ? b.key : sortCol === 'writers' ? b.writers : b.title) || '';
    return sortDir === 'asc'
      ? aStr.toLowerCase().localeCompare(bStr.toLowerCase())
      : bStr.toLowerCase().localeCompare(aStr.toLowerCase());
  });

  const SortHeader = ({ col, label }: { col: typeof sortCol; label: string }) => {
    const active = sortCol === col;
    return (
      <th
        onClick={() => handleSort(col)}
        style={{ textAlign: "left", padding: "8px 12px", fontWeight: 700, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      >
        {label}
        <span style={{ marginLeft: 5, opacity: active ? 1 : 0.25, fontSize: "9pt" }}>
          {active && sortDir === 'desc' ? '▲' : '▼'}
        </span>
      </th>
    );
  };

  const handleExportPDF = (song: SavedSong, openKey: string) => {
    exportSongPDF(buildExportParams(song, openKey));
  };

  return (
    <div style={{ fontFamily: "Helvetica, sans-serif", padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: "22pt", fontFamily: "Helvetica, sans-serif", fontWeight: 800 }}>Worship Archive</h1>
        <button
          onClick={onNew}
          style={{ marginLeft: "auto", padding: "8px 20px", fontSize: "11pt", fontWeight: 700, cursor: "pointer", backgroundColor: "#1a1a1a", color: "white", border: "none", borderRadius: 4, fontFamily: "Helvetica, sans-serif" }}
        >+ New Song</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#999", fontSize: "13pt", marginTop: 80 }}>
          Loading…
        </div>
      ) : songs.length === 0 ? (
        <div style={{ textAlign: "center", color: "#999", fontSize: "13pt", marginTop: 80 }}>
          No songs saved yet. Click "+ New Song" to create your first chart.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11pt", fontFamily: "Helvetica, sans-serif" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #1a1a1a" }}>
              <SortHeader col="title" label="Title" />
              <SortHeader col="key" label="Key" />
              <SortHeader col="bpm" label="Tempo" />
              <SortHeader col="writers" label="Writers" />
              <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 700 }}>Open in Key</th>
              <th style={{ padding: "8px 12px" }}></th>
            </tr>
          </thead>
          <tbody>
            {sortedSongs.map((song, i) => {
              const openKey = selectedKey[song.id] || song.key;
              const rowBg = i % 2 === 0 ? "#fff" : "#f7f7f7";
              return (
                <tr key={song.id} style={{ borderBottom: "1px solid #eee", backgroundColor: rowBg }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{song.title}</td>
                  <td style={{ padding: "10px 12px", color: "#555" }}>{song.key}</td>
                  <td style={{ padding: "10px 12px", color: "#555" }}>{song.bpm || "—"}</td>
                  <td style={{ padding: "10px 12px", color: "#555" }}>{song.writers || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <select
                      value={openKey}
                      onChange={(e) => setSelectedKey(prev => ({ ...prev, [song.id]: e.target.value }))}
                      style={{ padding: "3px 6px", fontSize: "10pt", border: "1px solid #ccc", borderRadius: 4, fontFamily: "Helvetica, sans-serif" }}
                    >
                      {KEY_LIST.map(k => (
                        <option key={k} value={k}>{k}{k === song.key ? " (original)" : ""}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => onPreview({ ...song, openKey })}
                        style={{ padding: "4px 12px", fontSize: "10pt", cursor: "pointer", backgroundColor: "#1a1a1a", color: "white", border: "none", borderRadius: 4, fontFamily: "Helvetica, sans-serif" }}
                      >Open</button>
                      <button
                        onClick={() => handleExportPDF(song, openKey)}
                        style={{ padding: "4px 10px", fontSize: "10pt", cursor: "pointer", backgroundColor: "white", color: "#1a1a1a", border: "1px solid #ccc", borderRadius: 4, fontFamily: "Helvetica, sans-serif" }}
                      >PDF</button>
                      <button
                        onClick={() => { if (window.confirm(`Delete "${song.title}"?`)) onDelete(song.id); }}
                        style={{ padding: "4px 10px", fontSize: "10pt", cursor: "pointer", backgroundColor: "white", color: "#ef4444", border: "1px solid #fca5a5", borderRadius: 4, fontFamily: "Helvetica, sans-serif" }}
                      >✕</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<'home' | 'editor' | 'archive' | 'preview'>('archive');
  const [songs, setSongs] = useState<SavedSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSong, setEditingSong] = useState<SavedSong | null>(null);
  const [previewSong, setPreviewSong] = useState<(SavedSong & { openKey?: string }) | null>(null);

  // Load all songs from Supabase on mount
  useEffect(() => {
    supaFetch('songs?order=saved_at.desc')
      .then(rows => setSongs((rows || []).map(fromRow)))
      .catch(e => console.error('Load error:', e))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (song: SavedSong) => {
    const existing = songs.findIndex(s => s.id === song.id || (s.title.toLowerCase() === song.title.toLowerCase() && s.key === song.key));
    if (existing >= 0) {
      if (!window.confirm(`"${song.title}" is already in your archive. Replace it?`)) return;
    }
    try {
      await supaFetch('songs', {
        method: 'POST',
        body: JSON.stringify(toRow(song)),
        headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' } as any,
      });
      const rows = await supaFetch('songs?order=saved_at.desc');
      setSongs((rows || []).map(fromRow));
      alert(`"${song.title}" saved!`);
    } catch (e) { alert('Save failed. Check your connection.'); console.error(e); }
  };

  const handleDelete = async (id: string) => {
    try {
      await supaFetch(`songs?id=eq.${id}`, { method: 'DELETE' });
      setSongs(prev => prev.filter(s => s.id !== id));
    } catch (e) { alert('Delete failed.'); console.error(e); }
  };

  const handlePreview = (song: SavedSong & { openKey?: string }) => {
    setPreviewSong(song);
    setView('preview');
  };

  const handleEditFromPreview = () => {
    if (previewSong) { setEditingSong({ ...previewSong } as any); setView('editor'); }
  };

  const handleNew = () => { setEditingSong(null); setView('editor'); };

  if (view === 'archive' || view === 'home') return (
    <ArchiveView songs={songs} loading={loading} onNew={handleNew} onPreview={handlePreview} onDelete={handleDelete} />
  );
  if (view === 'preview' && previewSong) return (
    <SongPreview song={previewSong} onEdit={handleEditFromPreview} onBack={() => setView('archive')} />
  );
  return (
    <div>
      <div style={{ padding: '8px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 16, backgroundColor: '#fafafa' }}>
        <button onClick={() => setView('archive')} style={{ padding: '4px 12px', fontSize: '10pt', cursor: 'pointer', backgroundColor: 'white', border: '1px solid #ccc', borderRadius: 4, fontFamily: 'Helvetica, sans-serif' }}>
          ← Worship Archive
        </button>
        <span style={{ fontSize: '11pt', color: '#999', fontFamily: 'Helvetica, sans-serif' }}>
          {editingSong ? `Editing: ${editingSong.title}` : 'New Song'}
        </span>
      </div>
      <ChartEditor onSave={handleSave} initialSong={editingSong} />
    </div>
  );
}