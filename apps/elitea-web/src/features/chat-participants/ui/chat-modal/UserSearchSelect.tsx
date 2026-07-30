// @ts-nocheck
/**
 * UserSearchSelect — user-type-only entity picker for the add-participant flow.
 *
 * Ported from `pages/NewChat/AddNewUser/UserSearchSelect.jsx`.
 *
 * Cross-cutting: uses `entities/participant`'s `useFilteredEntityItems` for
 * user candidate filtering (issue #33, item 8).
 */
import { memo, useCallback, useState } from 'react';

import { Autocomplete, Box, TextField, Typography } from '@mui/material';

import { useFilteredEntityItems } from '@/entities/participant';
import { useSelectedProjectId } from '@/shared/config';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UserSearchSelectProps {
  value?: Record<string, unknown> | null;
  onChange: (value: Record<string, unknown> | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Filter by entity types to include. */
  types?: string[];
}

/**
 * UserSearchSelect component — autocomplete for selecting a user participant.
 * Uses the entity hook for filtered candidate browsing.
 */
const UserSearchSelect = memo((props: UserSearchSelectProps): React.ReactElement => {
  const { value, onChange, placeholder = 'Search users...', disabled, types } = props;

  const projectId = useSelectedProjectId();
  const [inputValue, setInputValue] = useState('');

  // Use the entity hook for filtered candidates
  const { participants: candidates, isLoading } = useFilteredEntityItems({
    projectId,
    query: inputValue,
    types: types as unknown as Parameters<typeof useFilteredEntityItems>[0]['types'],
    enabled: !!inputValue && inputValue.length >= 2,
  });

  const handleChange = useCallback(
    (_event: React.SyntheticEvent, newValue: Record<string, unknown> | null) => {
      onChange(newValue);
    },
    [onChange],
  );

  return (
    <Autocomplete
      value={value ?? null}
      onChange={handleChange}
      inputValue={inputValue}
      onInputChange={(_e, newInputValue) => setInputValue(newInputValue)}
      options={candidates}
      getOptionLabel={(option) => option.entity_meta?.name || option.meta?.user_name || 'Unknown'}
      isOptionEqualToValue={(option, value) => option.id === value.id}
      loading={isLoading}
      disabled={disabled}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder}
          size="small"
          autoComplete="off"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isLoading ? <Box sx={{ mr: 1 }}><Typography variant="body2">Loading...</Typography></Box> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      renderOption={(props, option) => {
        const { key, ...optionProps } = props as React.HTMLProps<HTMLLIElement>;
        return (
          <li key={key ?? option.id} {...optionProps}>
            <Typography variant="body2">{option.entity_meta?.name || option.meta?.user_name || 'Unknown'}</Typography>
          </li>
        );
      }}
    />
  );
});

UserSearchSelect.displayName = 'UserSearchSelect';

export default UserSearchSelect;
