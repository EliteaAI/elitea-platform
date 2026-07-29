import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as artifactsFeature from '@/features/artifacts';

const mocks = vi.hoisted(() => ({
  createBucket: vi.fn(),
}));

import { CreateBucket, validateBucketName } from './CreateBucket';
import { renderArtifactsRoute } from './__tests__/testRouter';

describe('validateBucketName', () => {
  it('accepts supported names and rejects invalid names', () => {
    expect(validateBucketName('reports-2026')).toBe('');
    expect(validateBucketName('')).toBe('Name is required.');
    expect(validateBucketName('1reports')).toContain('Start with a letter');
    expect(validateBucketName(`a${'b'.repeat(56)}`)).toContain('56 characters');
  });
});

describe('CreateBucket', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.createBucket.mockReset().mockResolvedValue(undefined);
    vi.spyOn(artifactsFeature, 'useArtifactMutations').mockReturnValue({
      createBucket: {
        mutateAsync: mocks.createBucket,
        isPending: false,
      },
    } as never);
  });

  it('creates a valid bucket and navigates back to its artifact list', async () => {
    const user = userEvent.setup();
    const { router } = renderArtifactsRoute(<CreateBucket />, '/artifacts/create-bucket');
    const input = await screen.findByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'reports');
    await user.click(screen.getByRole('button', { name: 'Create bucket' }));
    expect(mocks.createBucket).toHaveBeenCalledWith('reports');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/artifacts');
      expect(router.state.location.search).toMatchObject({ bucket: 'reports' });
    });
  });

  it('keeps invalid input local and supports cancellation', async () => {
    const user = userEvent.setup();
    const { router } = renderArtifactsRoute(<CreateBucket />, '/artifacts/create-bucket');
    const input = await screen.findByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'invalid name');
    await user.tab();
    expect(screen.getByText(/Start with a letter/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create bucket' })).toBeDisabled();
    expect(mocks.createBucket).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/artifacts'));
  });

  it('shows a safe message when creation fails', async () => {
    const user = userEvent.setup();
    mocks.createBucket.mockRejectedValueOnce(new Error('internal failure'));
    renderArtifactsRoute(<CreateBucket />, '/artifacts/create-bucket');
    const input = await screen.findByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'reports');
    await user.click(screen.getByRole('button', { name: 'Create bucket' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create the bucket.');
  });

  it('does not submit without a selected project', async () => {
    const user = userEvent.setup();
    renderArtifactsRoute(<CreateBucket />, '/artifacts/create-bucket', null);
    await user.click(await screen.findByRole('button', { name: 'Create bucket' }));
    expect(mocks.createBucket).not.toHaveBeenCalled();
  });
});
