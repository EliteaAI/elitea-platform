import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationValidator } from './ApplicationValidator';

describe('ApplicationValidator', () => {
  it('calls useValidate for the parent version', () => {
    const useValidate = vi.fn().mockReturnValue({ isError: false, error: undefined });
    render(
      <ApplicationValidator
        projectId="p1"
        applicationId={1}
        versionId={2}
        tools={[{ type: 'github' }]}
        useValidate={useValidate}
      />,
    );
    expect(useValidate).toHaveBeenCalledWith({ projectId: 'p1', applicationId: 1, versionId: 2 });
  });

  it('skips validation (and calls useValidate with versionId undefined) when there are no tools at all', () => {
    const useValidate = vi.fn().mockReturnValue({ isError: false, error: undefined });
    render(
      <ApplicationValidator
        projectId="p1"
        applicationId={1}
        versionId={2}
        tools={[]}
        useValidate={useValidate}
      />,
    );
    expect(useValidate).toHaveBeenCalledWith({ projectId: 'p1', applicationId: 1, versionId: undefined });
  });

  it('skips validation in create mode', () => {
    const useValidate = vi.fn().mockReturnValue({ isError: false, error: undefined });
    render(
      <ApplicationValidator
        projectId="p1"
        applicationId={1}
        versionId={2}
        tools={[]}
        isCreateMode
        useValidate={useValidate}
      />,
    );
    expect(useValidate).toHaveBeenCalledWith({ projectId: 'p1', applicationId: 1, versionId: undefined });
  });

  it('renders one sub-validator per application-type tool with both ids', () => {
    const useValidate = vi.fn().mockReturnValue({ isError: false, error: undefined });
    const tools = [
      { type: 'github' },
      { type: 'application', settings: { application_id: 5, application_version_id: 9 } },
      { type: 'application', settings: { application_id: 6, application_version_id: 10 } },
    ];
    render(
      <ApplicationValidator
        projectId="p1"
        applicationId={1}
        versionId={2}
        tools={tools}
        useValidate={useValidate}
      />,
    );
    // 1 call for the parent version + 2 for the sub-agent tools.
    expect(useValidate).toHaveBeenCalledTimes(3);
    expect(useValidate).toHaveBeenCalledWith({ projectId: 'p1', applicationId: 5, versionId: 9 });
    expect(useValidate).toHaveBeenCalledWith({ projectId: 'p1', applicationId: 6, versionId: 10 });
  });

  it('calls onValidationError when the parent version is invalid', () => {
    const onValidationError = vi.fn();
    const useValidate = vi.fn().mockReturnValue({ isError: true, error: 'boom' });
    render(
      <ApplicationValidator
        projectId="p1"
        applicationId={1}
        versionId={2}
        tools={[{ type: 'github' }]}
        useValidate={useValidate}
        onValidationError={onValidationError}
      />,
    );
    expect(onValidationError).toHaveBeenCalledWith({ isError: true, error: 'boom' });
  });

  it('does not call onValidationError while skipped', () => {
    const onValidationError = vi.fn();
    const useValidate = vi.fn().mockReturnValue({ isError: true, error: 'boom' });
    render(
      <ApplicationValidator
        projectId="p1"
        applicationId={1}
        versionId={2}
        tools={[]}
        skip
        useValidate={useValidate}
        onValidationError={onValidationError}
      />,
    );
    expect(onValidationError).not.toHaveBeenCalled();
  });

  it('is skipped when projectId/applicationId/versionId are missing', () => {
    const useValidate = vi.fn().mockReturnValue({ isError: false, error: undefined });
    render(
      <ApplicationValidator
        projectId={undefined}
        applicationId={undefined}
        versionId={undefined}
        tools={[]}
        useValidate={useValidate}
      />,
    );
    expect(useValidate).toHaveBeenCalledWith({ projectId: undefined, applicationId: undefined, versionId: undefined });
  });
});
