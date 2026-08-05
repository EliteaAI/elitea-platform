/**
 * State + handlers for `./StateVariableItem.tsx`, split out purely to keep
 * that component under the §3.5 `complexity` budget (12) — same
 * split-for-budget rationale as `ui/nodes/BaseNode/NodeCardHeader.rename.ts`.
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/ui/state/StateVariableItem.jsx`'s own state/handlers (baseline
 * lines 13-145) — no behaviour change, only relocated.
 */
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { StateDrawerConstants } from '../../lib/flow-editor/constants';
import { calculateNameFieldWidth, validateValueByType } from '../../lib/flow-editor/helpers/state.helpers';

import type { StateVariableItemProps } from './StateVariableItem.types';

export interface StateVariableItemController {
  readonly isCreateMode: boolean;
  readonly isEditing: boolean;
  readonly editValue: string;
  readonly nameError: string;
  readonly validationError: string;
  readonly isDefaultValueModalOpen: boolean;
  readonly nameFieldWidth: string;
  readonly shouldExpandNameField: boolean;
  readonly handleStartEdit: () => void;
  readonly handleNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleNameBlur: () => void;
  readonly handleNameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly handleTypeChange: (newType: string) => void;
  readonly handleToggleChange: (checked: boolean) => void;
  readonly handleDeleteClick: () => void;
  readonly handleDefaultValueClick: () => void;
  readonly handleDefaultValueClose: () => void;
  readonly handleDefaultValueModalChange: (value: string) => void;
  readonly handleDefaultValueInlineChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function useStateVariableItemController(props: StateVariableItemProps): StateVariableItemController {
  const {
    mode = StateDrawerConstants.ItemMode.Display,
    name,
    type,
    isDefault,
    defaultValue,
    drawerWidth = 300,
    validateName,
    onToggle,
    onDelete,
    onUpdateName,
    onUpdateType,
    onUpdateDefaultValue,
    onCancel,
  } = props;

  const isCreateMode = mode === StateDrawerConstants.ItemMode.Create;

  const [isEditing, setIsEditing] = useState(isCreateMode);
  const [editValue, setEditValue] = useState(name);
  const [nameError, setNameError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [isDefaultValueModalOpen, setIsDefaultValueModalOpen] = useState(false);

  useEffect(() => {
    setValidationError(validateValueByType(type, defaultValue));
  }, [type, defaultValue]);

  const handleStartEdit = useCallback(() => {
    if (!isDefault && !isCreateMode) {
      setIsEditing(true);
      setEditValue(name);
    }
  }, [isDefault, isCreateMode, name]);

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      setEditValue(newValue);

      if (validateName && newValue && newValue !== name) {
        setNameError(validateName(newValue, name));
      } else {
        setNameError('');
      }
    },
    [validateName, name],
  );

  const handleNameBlur = useCallback(() => {
    if (editValue && editValue !== name && !nameError) {
      onUpdateName?.(name, editValue);
    }

    if (isCreateMode && (!editValue || nameError)) {
      onCancel?.();
    }

    setIsEditing(false);
    setNameError('');
  }, [editValue, name, nameError, onUpdateName, isCreateMode, onCancel]);

  const handleNameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        (event.target as HTMLInputElement).blur();
        return;
      }
      if (event.key !== 'Escape') return;
      if (isCreateMode) {
        onCancel?.();
      } else {
        setIsEditing(false);
        setEditValue(name);
      }
    },
    [name, isCreateMode, onCancel],
  );

  const handleTypeChange = useCallback(
    (newType: string) => {
      if (!isCreateMode) {
        onUpdateType?.(name, newType);
      }
    },
    [name, onUpdateType, isCreateMode],
  );

  const handleToggleChange = useCallback((checked: boolean) => onToggle?.(name, checked), [name, onToggle]);

  const handleDeleteClick = useCallback(() => {
    if (isCreateMode) {
      onCancel?.();
    } else {
      onDelete?.(name);
    }
  }, [name, onDelete, isCreateMode, onCancel]);

  const handleDefaultValueClick = useCallback(() => setIsDefaultValueModalOpen(true), []);
  const handleDefaultValueClose = useCallback(() => setIsDefaultValueModalOpen(false), []);

  const handleDefaultValueModalChange = useCallback(
    (value: string) => onUpdateDefaultValue?.(name, type, value),
    [name, type, onUpdateDefaultValue],
  );

  const handleDefaultValueInlineChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onUpdateDefaultValue?.(name, type, event.target.value),
    [name, type, onUpdateDefaultValue],
  );

  const nameFieldWidth = useMemo(() => `${calculateNameFieldWidth(drawerWidth)}px`, [drawerWidth]);
  const shouldExpandNameField = Boolean(isDefault) && !isCreateMode;

  return {
    isCreateMode,
    isEditing,
    editValue,
    nameError,
    validationError,
    isDefaultValueModalOpen,
    nameFieldWidth,
    shouldExpandNameField,
    handleStartEdit,
    handleNameChange,
    handleNameBlur,
    handleNameKeyDown,
    handleTypeChange,
    handleToggleChange,
    handleDeleteClick,
    handleDefaultValueClick,
    handleDefaultValueClose,
    handleDefaultValueModalChange,
    handleDefaultValueInlineChange,
  };
}
