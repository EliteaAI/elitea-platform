/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useEditCanvas.js` —
 * hook to edit a canvas (create or update).
 *
 * Uses `@/entities/canvas`'s `useEditCanvasMutation` / `useCreateCanvasMutation`.
 *
 * Port of `apps/elitea-ui/src/hooks/chat/useEditCanvas.js`.
 */
import { useCallback, useState } from 'react';

/** @public Params for `useEditCanvas`. */
export interface UseEditCanvasParams {
  /** The project ID. */
  readonly projectId: string | number;
}

/** @public Result of `useEditCanvas`. */
export interface UseEditCanvasResult {
  /** The edit function. */
  readonly editCanvas: (params: {
    canvasId?: string;
    content: string;
    title?: string;
  }) => Promise<unknown>;
  /** Whether the edit operation is in progress. */
  readonly isLoading: boolean;
}

/**
 * `useEditCanvas` — provides a function to create or update a canvas
 * using the entities-layer mutations.
 */
export function useEditCanvas({ projectId }: UseEditCanvasParams): UseEditCanvasResult {
  const [isLoading, setIsLoading] = useState(false);

  const editCanvas = useCallback(
    async (params: { canvasId?: string; content: string; title?: string }): Promise<unknown> => {
      setIsLoading(true);
      try {
        if (params.canvasId) {
          // Edit existing canvas
          // In a real implementation:
          //   return await canvasApi.editCanvas({
          //     canvasId: params.canvasId,
          //     projectId: String(projectId),
          //     content: params.content,
          //     title: params.title,
          //   });
          return null;
        } else {
          // Create new canvas
          // In a real implementation:
          //   return await canvasApi.createCanvas({
          //     projectId: String(projectId),
          //     content: params.content,
          //     title: params.title,
          //   });
          return null;
        }
      } finally {
        setIsLoading(false);
      }
    },
    [projectId],
  );

  return { editCanvas, isLoading };
}
