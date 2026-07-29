import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { toolkitValidation } from '@/entities/toolkit';

import { ToolkitValidator } from './ToolkitValidator';
import type { UseValidateToolkitQuery } from './ToolkitValidator';

function resetStore(): void {
  const keys = Object.keys(toolkitValidation.useToolkitValidationStore.getState().infoByKey);
  for (const key of keys) {
    toolkitValidation.useToolkitValidationStore.getState().setToolkitValidationInfo(key, []);
  }
}

describe('ToolkitValidator', () => {
  it('renders nothing', () => {
    resetStore();
    const useValidateToolkitQuery: UseValidateToolkitQuery = () => ({ isError: false, error: undefined });
    const { container } = render(<ToolkitValidator toolkitId="tk-1" projectId="proj-1" useValidateToolkitQuery={useValidateToolkitQuery} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls the injected query with forceSkip: false when no validation data exists yet', () => {
    resetStore();
    const useValidateToolkitQuery = vi.fn<UseValidateToolkitQuery>(() => ({ isError: false, error: undefined }));
    render(<ToolkitValidator toolkitId="tk-1" projectId="proj-1" useValidateToolkitQuery={useValidateToolkitQuery} />);
    expect(useValidateToolkitQuery).toHaveBeenCalledWith({ projectId: 'proj-1', toolkitId: 'tk-1', forceSkip: false });
  });

  it('passes forceSkip: true once the store already has an entry for this project/toolkit key', () => {
    resetStore();
    toolkitValidation.useToolkitValidationStore.getState().setToolkitValidationInfo('proj-1_tk-1', []);
    const useValidateToolkitQuery = vi.fn<UseValidateToolkitQuery>(() => ({ isError: false, error: undefined }));
    render(<ToolkitValidator toolkitId="tk-1" projectId="proj-1" useValidateToolkitQuery={useValidateToolkitQuery} />);
    expect(useValidateToolkitQuery).toHaveBeenCalledWith({ projectId: 'proj-1', toolkitId: 'tk-1', forceSkip: true });
  });

  it('stores validation errors reported by the injected query', () => {
    resetStore();
    const useValidateToolkitQuery: UseValidateToolkitQuery = () => ({
      isError: true,
      error: { status: 400, data: { settings_errors: [{ msg: 'bad config' }] } },
    });
    render(<ToolkitValidator toolkitId="tk-2" projectId="proj-1" useValidateToolkitQuery={useValidateToolkitQuery} />);
    expect(toolkitValidation.useToolkitValidationStore.getState().infoByKey['proj-1_tk-2']).toEqual([{ msg: 'bad config' }]);
  });
});
