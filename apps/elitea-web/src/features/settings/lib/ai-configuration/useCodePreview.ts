/**
 * Code preview hook — manages language selection and code-example generation.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/hooks/useCodePreview.hooks.js`.
 */
import { useCallback, useMemo, useState } from 'react';

import { getConfig } from '@/shared/config';

import {
  CODE_EXAMPLE_TYPES,
} from './codeExamples';
import {
  generateCanvasTitle,
  generateCodeExample,
  getEditorLanguage,
  getFileNameForLanguage,
} from './codeExamples.helpers';

const DEFAULT_LANGUAGE = CODE_EXAMPLE_TYPES.PYTHON;

export interface UseCodePreviewResult {
  selectedLanguage: string;
  codeExample: string;
  canvasTitle: string;
  editorLanguage: string;
  handleLanguageChange: (language: string) => void;
  handleCopy: () => Promise<void>;
  /*
   * [#71] Was declared `() => Promise<void>`, but `handleDownload` builds a
   * blob and clicks an anchor synchronously — no await anywhere in it. The
   * mismatch went unnoticed because nothing referenced this interface;
   * annotating `useCodePreview`'s return type with it surfaced the error.
   * Corrected to match the implementation rather than the reverse: making the
   * function async would change what callers can do with its result.
   */
  handleDownload: () => void;
  fileName: string;
}

/**
 * @param model - The selected model whose data drives the generated code example.
 * @param projectId - Currently-selected project id — threaded down from the
 *   route. This is the BILLING project: the samples send it as `X-Project-Id`,
 *   the header the `/llm` edge reads (spec-llm-project-scope §6.1, §9).
 *   It also gates `baseApiUrl` (mirrors the previous `!project` gate).
 */
export function useCodePreview(model: Record<string, unknown> | null, projectId: string): UseCodePreviewResult {
  const [selectedLanguage, setSelectedLanguage] = useState<string>(DEFAULT_LANGUAGE);

  const baseApiUrl = useMemo(() => {
    if (!projectId) return '';
    // Old app priority: `user.api_url || VITE_SERVER_URL?.replace('/api/v2', '')
    // || window.location.origin` (`useCodePreview.hooks.js:20-23`) — this app
    // has no per-user `api_url` equivalent yet (not modeled anywhere in the
    // ported user/auth entities), so this falls back to the deployment-level
    // `VITE_SERVER_URL` config, then `window.location.origin` as the old
    // app's own last resort. This is the fallback the old app relies on for
    // deployments where the API is served from a different host/subdomain
    // than the frontend.
    const result = getConfig();
    const serverUrl = result.status === 'ok' ? result.config.vite_server_url : '';
    const baseUrl = (serverUrl && serverUrl.replace('/api/v2', '')) || window.location.origin;
    return `${baseUrl}/llm/v1`;
  }, [projectId]);

  const authToken = useMemo(() => {
    // The old app used a "placeholder token" — in the real app this would
    // come from the authenticated session / API key configuration.
    return 'Your_Personal_Token';
  }, []);

  const codeExample = useMemo(() => {
    const modelName = (model?.model_name as string) || (model?.name as string) || 'gpt-4o-mini';
    /*
     * The sample carries `projectId`, the project the user works in — NOT
     * `model.project_id`. A local `const projectId = model?.project_id` used
     * to shadow the parameter here, so every sample advertised the project
     * that owns the model. That is the public project for a shared model,
     * because the models query passes `includeShared`. See
     * `spec-llm-project-scope` §9.1.
     */
    return generateCodeExample(selectedLanguage, baseApiUrl, modelName, authToken, projectId);
  }, [selectedLanguage, model, baseApiUrl, authToken, projectId]);

  const canvasTitle = useMemo(() => {
    const integrationName = model?.integration_name as string | undefined;
    const modelName = model?.model_name as string | undefined;
    return generateCanvasTitle(integrationName, modelName);
  }, [model?.integration_name, model?.model_name]);

  const editorLanguage = useMemo(() => {
    return getEditorLanguage(selectedLanguage);
  }, [selectedLanguage]);

  const handleLanguageChange = useCallback((language: string) => {
    setSelectedLanguage(language);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeExample);
    } catch {
      // Silently fail — the old app used toastError here, but no toast
      // system exists in Wave-1 shared/ui.
    }
  }, [codeExample]);

  const handleDownload = useCallback(() => {
    const fileName = getFileNameForLanguage(selectedLanguage);
    try {
      const element = document.createElement('a');
      const file = new Blob([codeExample], { type: 'text/plain' });
      element.href = URL.createObjectURL(file);
      element.download = fileName;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      URL.revokeObjectURL(element.href);
    } catch {
      // Silently fail
    }
  }, [codeExample, selectedLanguage]);

  const fileName = useMemo(() => {
    return getFileNameForLanguage(selectedLanguage);
  }, [selectedLanguage]);

  return {
    selectedLanguage,
    codeExample,
    canvasTitle,
    editorLanguage,
    handleLanguageChange,
    handleCopy,
    handleDownload,
    fileName,
  };
}
