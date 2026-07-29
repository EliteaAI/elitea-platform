import { useCallback, useRef, useState } from 'react';

import JSZip from 'jszip';

import { downloadArtifactsAsZip } from '@/shared/api/artifacts';
import { getConfig } from '@/shared/config';
import { triggerBlobDownload } from '@/shared/lib/download';

import type { ZipDownloadProgress } from './types';

const INITIAL_PROGRESS: ZipDownloadProgress = { open: false, current: 0, total: 0, filename: '' };

export function useZipDownload() {
  const abortController = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<ZipDownloadProgress>(INITIAL_PROGRESS);

  const start = useCallback(async (params: {
    readonly projectId: string;
    readonly bucket: string;
    readonly filenames: readonly string[];
    readonly currentPrefix?: string;
  }) => {
    const config = getConfig();
    if (config.status !== 'ok') {
      setProgress({ ...INITIAL_PROGRESS, error: 'Runtime configuration is unavailable.' });
      return;
    }
    const controller = new AbortController();
    abortController.current = controller;
    setProgress({ open: true, current: 0, total: params.filenames.length, filename: '' });
    try {
      const result = await downloadArtifactsAsZip({
        baseUrl: config.config.vite_server_url,
        projectId: params.projectId,
        bucket: params.bucket,
        filenames: params.filenames,
        archiver: new JSZip(),
        ...(params.currentPrefix === undefined ? {} : { currentPrefix: params.currentPrefix }),
        signal: controller.signal,
        onProgress: (current, total, filename) => setProgress({ open: true, current, total, filename }),
      });
      if (result.status === 'ok') {
        triggerBlobDownload(result.blob, `${params.bucket}.zip`);
        setProgress(INITIAL_PROGRESS);
      } else if (result.status === 'cancelled') {
        setProgress(INITIAL_PROGRESS);
      } else {
        setProgress({ ...INITIAL_PROGRESS, error: `Failed to download ${result.filename}.` });
      }
    } catch {
      setProgress({ ...INITIAL_PROGRESS, error: 'Failed to prepare the ZIP download.' });
    } finally {
      if (abortController.current === controller) abortController.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortController.current?.abort();
    abortController.current = null;
    setProgress(INITIAL_PROGRESS);
  }, []);

  return { progress, start, cancel };
}
