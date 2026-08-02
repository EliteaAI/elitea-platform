import { memo, useCallback, useEffect, useRef } from 'react';

import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { Theme } from '@mui/material/styles';

/**
 * Submenu used inside PlusChatButton for searching and selecting items
 * (agents, pipelines, toolkits, attachments, tools).
 */
export interface PlusChatSubmenuProps {
  items?: { key: string; label: string; onClick?: () => void }[];
  searchValue?: string;
  onSearchChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  searchPlaceholder?: string;
  onCreateNew?: (() => void) | undefined;
  createNewLabel?: string;
  showCreateNew?: boolean;
  isLoading?: boolean;
  emptyMessage?: string;
  noResultsMessage?: string;
  onScroll?: (e: React.SyntheticEvent<HTMLDivElement>) => void;
  showToggle?: boolean;
}

export const PlusChatSubmenu = memo(
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
    onScroll,
    showToggle,
  }: PlusChatSubmenuProps) => {
    const searchRef = useRef<HTMLInputElement>(null);

    // Auto-focus search input when submenu opens
    useEffect(() => {
      searchRef.current?.focus();
    }, []);

    const handleItemClick = useCallback((item: { onClick?: () => void }) => () => {
      item.onClick?.();
    }, []);

    const filteredItems = searchValue
      ? items.filter((item) => item.label.toLowerCase().includes(searchValue.toLowerCase()))
      : items;

    return (
      <Box>
        {/* Search bar */}
        <Box
          sx={{
            padding: '0.25rem 1rem',
            borderBottom: '0.0625rem solid',
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

        {/* Items list */}
        <Box
          sx={{
            maxHeight: '20.3125rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
          onScroll={onScroll}
        >
          {/* Create new button */}
          {showCreateNew && (
            <MenuItem
              onClick={onCreateNew}
              sx={{
                padding: '0.5rem 1.25rem',
                height: '2.5rem',
                gap: 0.75,
                color: 'text.secondary',
                '&:hover': {
                  backgroundColor: 'action.hover',
                },
              }}
            >
              <Typography variant="bodyMedium">{createNewLabel}</Typography>
            </MenuItem>
          )}

          {/* Items */}
          {filteredItems.map((item) => (
            <MenuItem
              key={item.key}
              onClick={handleItemClick(item)}
              sx={{
                padding: '0.5rem 1rem',
                height: '2.5rem',
                color: 'text.secondary',
                '&:hover': {
                  backgroundColor: 'action.hover',
                },
              }}
            >
              <Typography variant="bodyMedium">{item.label}</Typography>
            </MenuItem>
          ))}

          {/* Loading state */}
          {isLoading && (
            <MenuItem disabled sx={{ padding: '0.5rem 1rem' }}>
              <Typography variant="bodyMedium" color="text.secondary">
                Loading...
              </Typography>
            </MenuItem>
          )}

          {/* Empty / no results state */}
          {!isLoading && filteredItems.length === 0 && (
            <MenuItem disabled sx={{ padding: '0.5rem 1rem' }}>
              <Typography variant="bodyMedium" color="text.secondary">
                {searchValue ? noResultsMessage : emptyMessage}
              </Typography>
            </MenuItem>
          )}

          {/* Toggle placeholder (reserved for future use) */}
          {showToggle && (
            <Box
              sx={(theme: Theme) => ({
                padding: '0.5rem 1rem',
                color: theme.vars.palette.text.disabled,
                fontSize: '0.75rem',
              })}
            >
              Toggle options coming soon
            </Box>
          )}
        </Box>
      </Box>
    );
  },
);

PlusChatSubmenu.displayName = 'PlusChatSubmenu';

export default PlusChatSubmenu;
