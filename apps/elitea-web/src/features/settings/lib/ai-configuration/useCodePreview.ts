/**
 * Code preview hook — manages language selection and code-example generation.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/hooks/useCodePreview.hooks.js`.
 */
import { useCallback, useMemo, useState } from 'react';

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
  handleDownload: () => Promise<void>;
  fileName: string;
}

/**
 * @param model - The selected model whose data drives the generated code example.
 * @param projectId - Currently-selected project id — threaded down from the
 *   route. Only its truthiness is used (mirrors the previous `!project` gate).
 */
export function useCodePreview(model: Record<string, unknown> | null, projectId: string) {
  const [selectedLanguage, setSelectedLanguage] = useState<string>(DEFAULT_LANGUAGE);

  const baseApiUrl = useMemo(() => {
    if (!projectId) return '';
    // Build base URL from the current origin — the LLM endpoint is behind
    // the same host as the app (the old app replaced `/api/v2` to get the
    // server root, then appended `/llm/v1`).
    const baseUrl = window.location.origin;
    return `${baseUrl}/llm/v1`;
  }, [projectId]);

  const authToken = useMemo(() => {
    // The old app used a "placeholder token" — in the real app this would
    // come from the authenticated session / API key configuration.
    return 'Your_Personal_Token';
  }, []);

  const codeExample = useMemo(() => {
    const modelName = (model?.model_name as string) || (model?.name as string) || 'gpt-4o-mini';
    const apiUrl = baseApiUrl;
    const projectId = model?.project_id as string | undefined;
    return generateCodeExample(selectedLanguage, apiUrl, modelName, authToken, projectId);
  }, [selectedLanguage, model, baseApiUrl, authToken]);

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
