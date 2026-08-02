import { memo, useCallback, useEffect, useRef } from 'react';

import { Box, MenuItem, TextField, Typography, useTheme } from '@mui/material';

/**
 * Phase-2 PlusChatSubmenu component
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type PlusChatSubmenuProps = {
  items?: { key: string; label: string; onClick?: () => void }[];
  searchValue?: string;
  onSearchChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  searchPlaceholder?: string;
  onCreateNew?: () => void;
  createNewLabel?: string;
  showCreateNew?: boolean;
  isLoading?: boolean;
  emptyMessage?: string;
  noResultsMessage?: string;
  onScroll?: (e: React.SyntheticEvent<HTMLDivElement>) => void;
  showToggle?: boolean;
};

const PlusChatSubmenu = memo(
  ({
    items = [],
    searchValue = '',
    onSearchChange,
    searchPlaceholder = 'Search...',
    onCreateNew,
    createNewLabel = 'Create new',
    showCreateNew = false,
    isLoading = false,
    emptyMessage = 'No items available',
    noResultsMessage = 'No items found',
  }: PlusChatSubmenuProps) => {
    const searchRef = useRef<HTMLInputElement>(null);
    const theme = useTheme();

    void theme;

    useEffect(() => {
      searchRef.current?.focus();
    }, []);

    const handleItemClick = useCallback((item: { onClick?: () => void }) => () => {
      item.onClick?.();
    }, []);

    return (
      <Box>
        <Box
          sx={{
            padding: '0.25rem 1rem',
            borderBottom: '1px solid',
            borderColor: 'border.lines',
          }}
        >
          <TextField
            inputRef={searchRef}
            size="small"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={onSearchChange}
            variant="standard"
            autoFocus
            sx={{ '& .MuiInputBase-input': { color: 'text.primary' } }}
          />
        </Box>

        <Box
          sx={{
            maxHeight: '20.3125rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {showCreateNew && (
            <MenuItem
              onClick={onCreateNew}
              sx={{
                padding: '0.5rem 1.25rem',
                height: '2.5rem',
                gap: '0.75rem',
              }}
            >
              <Typography variant="bodyMedium" color="text.secondary">
                {createNewLabel}
              </Typography>
            </MenuItem>
          )}

          {items.map(item => (
            <MenuItem
              key={item.key}
              onClick={handleItemClick(item)}
              sx={{ padding: '0.5rem 1rem', height: '2.5rem' }}
            >
              <Typography variant="bodyMedium" color="text.secondary">
                {item.label}
              </Typography>
            </MenuItem>
          ))}

          {isLoading && (
            <MenuItem disabled sx={{ padding: '0.5rem 1rem' }}>
              <Typography variant="bodyMedium" color="text.secondary">
                Loading...
              </Typography>
            </MenuItem>
          )}

          {!isLoading && items.length === 0 && (
            <MenuItem disabled sx={{ padding: '0.5rem 1rem' }}>
              <Typography variant="bodyMedium" color="text.secondary">
                {searchValue ? noResultsMessage : emptyMessage}
              </Typography>
            </MenuItem>
          )}
        </Box>
      </Box>
    );
  },
);

PlusChatSubmenu.displayName = 'PlusChatSubmenu';

export default PlusChatSubmenu;
