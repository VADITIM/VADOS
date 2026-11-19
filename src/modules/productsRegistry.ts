export type ProductDemonstration =
  | { kind: 'screenshots'; images: string[] }
  | { kind: 'recording'; video: string }
  | { kind: 'liquid' }
  | { kind: 'live'; source: string; size: string; hint: string }
  | { kind: 'stack' }
  | { kind: 'ink' }
  | { kind: 'none' };

export interface Product {
  id: string;
  name: string;
  icon: string;
  platform: string;
  stack: string;
  accent: string;
  headline: string;
  strengths: string[];
  repositoryUrl: string | null;
  version: string;
  availability: string;
  demonstration: ProductDemonstration;
}

const GITHUB = 'https://github.com/VADITIM';

export const products: Product[] = [
  {
    id: 'shell',
    name: 'Shell',
    icon: 'icons/shell.svg',
    platform: 'Linux (Arch) · any wlr-layer-shell compositor',
    stack: 'Quickshell · Qt 6 · QML',
    accent: '#0040ff',
    headline: 'A Linux desktop environment.',
    strengths: [
      'Tactile UI. A sidebar that morphs and mutates into desktop menus.',
    ],
    repositoryUrl: `${GITHUB}/VADOS-SHELL`,
    version: '0.1.1',
    availability: 'Public',
    demonstration: {
      kind: 'live',
      source: 'shell-live/play.html',
      size: '19 MB',
      hint: 'G search · D dashboard · Ctrl+P settings',
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    icon: 'icons/terminal.svg',
    platform: 'Windows · Linux',
    stack: 'Tauri v2 · SvelteKit · Rust',
    accent: '#8a2be2',
    headline: 'GUI & CLI combined as one & .MD support.',
    strengths: [
      'Component based terminal.',
      'Improved readability by containers & animations.',
    ],
    repositoryUrl: `${GITHUB}/VADOS-TERMINAL`,
    version: '0.4.0',
    availability: 'Public',
    demonstration: {
      kind: 'screenshots',
      images: ['media/terminal-3.png', 'media/terminal-1.png', 'media/terminal-4.png', 'media/terminal-5.png'],
    },
  },
  {
    id: 'bubble',
    name: 'Bubble',
    icon: 'icons/bubble.svg',
    platform: 'Android · One UI 8+',
    stack: 'Kotlin · WebView · Shizuku',
    accent: '#FFDD1B',
    headline: 'Status Bar overhaul for One UI.',
    strengths: [
      'A Dynamic Island with deep system integration.',
      'Replaces boring Samsung UI with animated VAD/OS UI.',
    ],
    repositoryUrl: `${GITHUB}/VADOS-BUBBLE`,
    version: '0.6.7',
    availability: 'Public',
    demonstration: {
      kind: 'recording',
      video: 'media/bubble-latest.mp4',
    },
  },
  {
    id: 'gallery',
    name: 'Gallery',
    icon: 'icons/gallery.svg',
    platform: 'Android · Windows · Linux (Arch)',
    stack: 'Kotlin · Jetpack Compose · Qt 6',
    accent: '#DC143C',
    headline: 'A Gallery without the bloat.',
    strengths: [
      'Most relevant daily features.',
      'Cohesive navigation and context menus.',
    ],
    repositoryUrl: `${GITHUB}/VADOS-GALLERY`,
    version: '1.6.1',
    availability: 'Public',
    demonstration: {
      kind: 'stack',
    },
  },
  {
    id: 'files',
    name: 'Files',
    icon: 'icons/files.svg',
    platform: 'Windows · Linux (Arch)',
    stack: 'Qt 6 · QML · C++',
    accent: '#f09b3a',
    headline: 'Styled file manager.',
    strengths: [
      'Customization.',
      'Integrated features such as unzip, convert, etc.',
    ],
    repositoryUrl: `${GITHUB}/VADOS-Files`,
    version: '1.0.0',
    availability: 'Public',
    demonstration: {
      kind: 'screenshots',
      images: ['media/files-preview.png'],
    },
  },
  {
    id: 'notes',
    name: 'Notes',
    icon: 'icons/notes.svg',
    platform: 'iPadOS 26+ · Windows · Linux (Arch)',
    stack: 'SwiftUI · Tauri · a shared Swift core',
    accent: '#5bfd5b',
    headline: 'Handwriting Notes with embedded .MD support.',
    strengths: [
      'Infinite Canvas in A4 format, PDF supported.',
      'Full dark mode compatibility.',
      'Sync all notes with a single GitHub Token.',
    ],
    repositoryUrl: `${GITHUB}/VADOS-NOTES`,
    version: '1.4.0',
    availability: 'Public · in progress',
    demonstration: {
      kind: 'ink',
    },
  },
];
