export interface SystemStep {
  title: string;
  detail: string;
}

export interface SystemFigure {
  value: number;
  label: string;
}

export interface SystemAccent {
  name: string;
  hex: string;
}

declare const __SYSTEM_VERSION__: string | null;

const RECORDED_SYSTEM_VERSION = '6.3.5';

export const SYSTEM_VERSION = __SYSTEM_VERSION__ ?? RECORDED_SYSTEM_VERSION;

export const systemSteps: SystemStep[] = [
  {
    title: 'Name the roles before the values.',
    detail: 'Every colour, size and duration is decided once, as a token, before a single screen exists.',
  },
  {
    title: 'Write the decisions down.',
    detail: 'A design system is a set of answers someone else can follow without asking.',
  },
  {
    title: 'Build the foundation, then the components.',
    detail: 'Type, spacing, colour and motion come first. Every component is assembled from them.',
  },
  {
    title: 'Prove it on one real product.',
    detail: 'Real content is where the system meets its first contradictions, and gets corrected.',
  },
  {
    title: 'Port it, one platform at a time.',
    detail: 'Each port keeps the decisions and changes only the syntax.',
  },
  {
    title: 'Keep one source of truth.',
    detail: 'A change lands in the system first, then flows into every product.',
  },
];

export const systemFigures: SystemFigure[] = [
  { value: 6, label: 'Steps' },
  { value: 15, label: 'Foundation modules' },
  { value: 28, label: 'Built components' },
  { value: 8, label: 'Platforms' },
];

export const systemAccents: SystemAccent[] = [
  { name: 'Terminal green', hex: '#5bfd5b' },
  { name: 'Sodium yellow', hex: '#FFDD1B' },
  { name: 'Electric blue', hex: '#0040ff' },
  { name: 'Crimson', hex: '#DC143C' },
  { name: 'Amber', hex: '#f09b3a' },
  { name: 'Violet', hex: '#8a2be2' },
];

export const systemPlatforms: string[] = [
  'Vue · GSAP',
  'Svelte · Tauri',
  'Android · Compose',
  'Android · Shizuku',
  'SwiftUI',
  'Qt · QML',
  'Godot',
  'CLI · TUI',
];
