/**
 * model/useCredentialValidation.ts — on-demand credential connection-test
 * status, cached per credential id (unit A7). Ported from
 * `apps/elitea-ui/src/[fsd]/features/credentials/lib/hooks/useCredentialValidation.hooks.js`.
 *
 * Placed in `model/` (not `api/`): this is client-only UI state (a status
 * cache keyed by credential id) layered ON TOP of the two mutation hooks in
 * `../api/useConfigurations.ts` — R-S1 is satisfied because nothing here is
 * data a query already holds (the mutation results are transient outcomes,
 * not a cached resource). A plain `useState`-backed hook, not a zustand
 * store: the baseline hook is called once per `CredentialsSelect` instance
 * and its state was never shared across components, so a module-scope
 * store would be a behaviour change, not a straight port.
 */
import { useCallback, useRef, useState } from 'react';

import { useBatchTestConfigurationConnection, useTestConfigurationConnection } from '../api/useConfigurations';

export type CredentialValidationStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'unsupported';

interface ValidateCredentialParams {
  readonly projectId: string | number;
  readonly credentialId: string;
  readonly credentialType: string;
  readonly data: Readonly<Record<string, unknown>>;
}

interface BatchValidateCredentialItem {
  readonly projectId: string | number;
  readonly credentialId: string;
  readonly credentialType: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface UseCredentialValidationResult {
  validateCredential: (params: ValidateCredentialParams) => Promise<void>;
  batchValidateCredentials: (items: readonly BatchValidateCredentialItem[]) => Promise<void>;
  getCredentialStatus: (credentialId: string | undefined) => CredentialValidationStatus;
  getCredentialMessage: (credentialId: string | undefined) => string;
  resetStatus: (credentialId: string) => void;
  resetStatuses: () => void;
}

/** HTTP statuses the baseline treats as "this credential type has no test-connection support", not a failure. */
const UNSUPPORTED_STATUSES = new Set([404, 405, 501]);

export function useCredentialValidation(): UseCredentialValidationResult {
  const [statuses, setStatuses] = useState<Record<string, CredentialValidationStatus>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;

  const testConnection = useTestConfigurationConnection();
  const batchTestConnection = useBatchTestConfigurationConnection();

  const validateCredential = useCallback(
    async ({ projectId, credentialId, credentialType, data }: ValidateCredentialParams): Promise<void> => {
      const currentStatus = statusesRef.current[credentialId];
      if (currentStatus === 'checking' || currentStatus === 'valid' || currentStatus === 'invalid' || currentStatus === 'unsupported') {
        return;
      }

      statusesRef.current = { ...statusesRef.current, [credentialId]: 'checking' };
      setStatuses((prev) => ({ ...prev, [credentialId]: 'checking' }));

      try {
        const result = await testConnection.mutateAsync({ projectId, configType: credentialType, body: data });
        const isValid = result.error === undefined;
        setStatuses((prev) => ({ ...prev, [credentialId]: isValid ? 'valid' : 'invalid' }));
        if (!isValid && result.error) {
          setMessages((prev) => ({ ...prev, [credentialId]: result.error ?? '' }));
        }
      } catch (error) {
        const status = getHttpStatus(error);
        if (status !== undefined && UNSUPPORTED_STATUSES.has(status)) {
          setStatuses((prev) => ({ ...prev, [credentialId]: 'unsupported' }));
          return;
        }
        setStatuses((prev) => ({ ...prev, [credentialId]: 'invalid' }));
      }
    },
    [testConnection],
  );

  const validateProjectBatch = useCallback(
    async (projectId: string | number, credentials: readonly BatchValidateCredentialItem[]): Promise<void> => {
      const items = credentials.map((c) => ({ id: c.credentialId, type: c.credentialType, data: c.data }));
      try {
        const rows = await batchTestConnection.mutateAsync({ projectId, items });
        const statusUpdates: Record<string, CredentialValidationStatus> = {};
        const messageUpdates: Record<string, string> = {};
        for (const row of rows) {
          if (row.unsupported) {
            statusUpdates[row.id] = 'unsupported';
          } else {
            statusUpdates[row.id] = row.success ? 'valid' : 'invalid';
            if (!row.success && row.message) messageUpdates[row.id] = row.message;
          }
        }
        setStatuses((prev) => ({ ...prev, ...statusUpdates }));
        if (Object.keys(messageUpdates).length > 0) setMessages((prev) => ({ ...prev, ...messageUpdates }));
      } catch {
        const statusUpdates: Record<string, CredentialValidationStatus> = {};
        for (const c of credentials) statusUpdates[c.credentialId] = 'invalid';
        setStatuses((prev) => ({ ...prev, ...statusUpdates }));
      }
    },
    [batchTestConnection],
  );

  const batchValidateCredentials = useCallback(
    async (items: readonly BatchValidateCredentialItem[]): Promise<void> => {
      const toValidate = items.filter((item) => {
        const currentStatus = statusesRef.current[item.credentialId];
        return currentStatus === undefined || currentStatus === 'idle';
      });
      if (toValidate.length === 0) return;

      const checkingUpdates: Record<string, CredentialValidationStatus> = {};
      const byProject = new Map<string, BatchValidateCredentialItem[]>();
      for (const item of toValidate) {
        checkingUpdates[item.credentialId] = 'checking';
        statusesRef.current = { ...statusesRef.current, [item.credentialId]: 'checking' };
        const key = String(item.projectId);
        const bucket = byProject.get(key) ?? [];
        bucket.push(item);
        byProject.set(key, bucket);
      }
      setStatuses((prev) => ({ ...prev, ...checkingUpdates }));

      await Promise.all([...byProject.entries()].map(([projectId, credentials]) => validateProjectBatch(projectId, credentials)));
    },
    [validateProjectBatch],
  );

  const getCredentialStatus = useCallback(
    (credentialId: string | undefined): CredentialValidationStatus => (credentialId === undefined ? 'idle' : (statuses[credentialId] ?? 'idle')),
    [statuses],
  );

  const getCredentialMessage = useCallback(
    (credentialId: string | undefined): string => (credentialId === undefined ? '' : (messages[credentialId] ?? '')),
    [messages],
  );

  const resetStatus = useCallback((credentialId: string): void => {
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[credentialId];
      statusesRef.current = next;
      return next;
    });
    setMessages((prev) => {
      const next = { ...prev };
      delete next[credentialId];
      return next;
    });
  }, []);

  const resetStatuses = useCallback((): void => {
    setStatuses({});
    setMessages({});
  }, []);

  return { validateCredential, batchValidateCredentials, getCredentialStatus, getCredentialMessage, resetStatus, resetStatuses };
}

/** `EliteaApiError.failure.kind === 'http'` carries the numeric status; anything else (network/auth/aborted) has none. */
function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('failure' in error)) return undefined;
  const failure = (error as { failure?: unknown }).failure;
  if (typeof failure !== 'object' || failure === null) return undefined;
  const record = failure as { kind?: unknown; status?: unknown };
  if (record.kind !== 'http') return undefined;
  return typeof record.status === 'number' ? record.status : undefined;
}
