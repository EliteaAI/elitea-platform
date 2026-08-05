import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getConfig } from '@/shared/config';

import {
  createArtifactBucket,
  fetchArtifacts,
  fetchArtifactBuckets,
  fetchArtifactStorageConfigurations,
  removeArtifact,
  removeArtifacts,
  removeArtifactBucket,
  renameArtifactBucket,
  setArtifactBucketPinned,
} from '../api/artifactsApi';

export const artifactQueryKeys = {
  all: ['artifacts'] as const,
  buckets: (projectId: string) => [...artifactQueryKeys.all, 'buckets', projectId] as const,
  files: (projectId: string, bucket: string) => [...artifactQueryKeys.all, 'files', projectId, bucket] as const,
  storage: (projectId: string) => [...artifactQueryKeys.all, 'storage', projectId] as const,
};

function resolvedBaseUrl(): string {
  const config = getConfig();
  if (config.status !== 'ok') throw new Error('Runtime configuration is unavailable.');
  return config.config.vite_server_url;
}

export function useArtifactBuckets(projectId: string | undefined) {
  return useQuery({
    queryKey: artifactQueryKeys.buckets(projectId ?? ''),
    queryFn: ({ signal }) => fetchArtifactBuckets(resolvedBaseUrl(), projectId ?? '', signal),
    enabled: projectId !== undefined && projectId !== '',
  });
}

export function useArtifacts(projectId: string | undefined, bucket: string | undefined) {
  return useQuery({
    queryKey: artifactQueryKeys.files(projectId ?? '', bucket ?? ''),
    queryFn: ({ signal }) => fetchArtifacts(resolvedBaseUrl(), projectId ?? '', bucket ?? '', signal),
    enabled: projectId !== undefined && projectId !== '' && bucket !== undefined && bucket !== '',
  });
}

export function useArtifactStorageConfigurations(projectId: string | undefined) {
  return useQuery({
    queryKey: artifactQueryKeys.storage(projectId ?? ''),
    queryFn: ({ signal }) => fetchArtifactStorageConfigurations(projectId ?? '', signal),
    enabled: projectId !== undefined && projectId !== '',
  });
}

export function useArtifactMutations(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const requiredProjectId = (): string => {
    if (projectId === undefined || projectId === '') throw new Error('A project must be selected.');
    return projectId;
  };
  const refreshBuckets = () => queryClient.invalidateQueries({ queryKey: artifactQueryKeys.buckets(requiredProjectId()) });
  const refreshFiles = (bucket: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: artifactQueryKeys.files(requiredProjectId(), bucket) }),
      queryClient.invalidateQueries({ queryKey: artifactQueryKeys.buckets(requiredProjectId()) }),
    ]);

  const createBucket = useMutation({
    mutationFn: (name: string) => createArtifactBucket(requiredProjectId(), name),
    onSuccess: refreshBuckets,
  });
  const renameBucket = useMutation({
    mutationFn: ({ currentName, nextName }: { readonly currentName: string; readonly nextName: string }) =>
      renameArtifactBucket(requiredProjectId(), currentName, nextName),
    onSuccess: refreshBuckets,
  });
  const pinBucket = useMutation({
    mutationFn: ({ name, isPinned }: { readonly name: string; readonly isPinned: boolean }) =>
      setArtifactBucketPinned(requiredProjectId(), name, isPinned),
    onSuccess: refreshBuckets,
  });
  const deleteBucket = useMutation({
    mutationFn: (name: string) => removeArtifactBucket(requiredProjectId(), name),
    onSuccess: refreshBuckets,
  });
  const deleteFile = useMutation({
    mutationFn: ({ bucket, key }: { readonly bucket: string; readonly key: string }) =>
      removeArtifact(requiredProjectId(), bucket, key),
    onSuccess: (_data, variables) => refreshFiles(variables.bucket),
  });
  const deleteMany = useMutation({
    mutationFn: ({ bucket, keys }: { readonly bucket: string; readonly keys: readonly string[] }) =>
      removeArtifacts(requiredProjectId(), bucket, keys),
    onSuccess: (_data, variables) => refreshFiles(variables.bucket),
  });

  return { createBucket, renameBucket, pinBucket, deleteBucket, deleteFile, deleteMany, refreshFiles };
}
