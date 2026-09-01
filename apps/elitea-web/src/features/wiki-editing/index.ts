/** Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20). */
export type { MermaidBlock } from './lib/mermaidBlocks';
export {
  extractMermaidBlocks,
  extractMermaidFromResponse,
  replaceMermaidBlock,
} from './lib/mermaidBlocks';
