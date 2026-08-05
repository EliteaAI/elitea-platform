import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { filterBucketsByQuery, type Bucket } from '@/entities/bucket';
import { t } from '@/shared/i18n';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';

import type { ArtifactStorageConfiguration } from '../model/types';

interface BucketSidebarProps {
  readonly buckets: readonly Bucket[];
  readonly selectedBucket?: string;
  readonly storageConfigurations: readonly ArtifactStorageConfiguration[];
  readonly selectedStorage?: string;
  readonly loading: boolean;
  readonly onStorageChange: (id: string) => void;
  readonly onSelect: (bucket: Bucket) => void;
  readonly onCreate: () => void;
  readonly onRename: (bucket: Bucket, nextName: string) => Promise<unknown>;
  readonly onPin: (bucket: Bucket) => Promise<unknown>;
  readonly onDelete: (bucket: Bucket) => Promise<unknown>;
}

export function BucketSidebar(props: BucketSidebarProps): ReactNode {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<Bucket>();
  const [deleting, setDeleting] = useState<Bucket>();
  const [nextName, setNextName] = useState('');
  const visibleBuckets = useMemo(() => filterBucketsByQuery(props.buckets, query), [props.buckets, query]);

  return (
    <Box sx={sidebarSx}>
      <Box sx={headerSx}>
        <Typography variant="headingSmall">{t('artifacts.buckets.title', 'Buckets')}</Typography>
        <Tooltip title={t('artifacts.buckets.create', 'Create bucket')}>
          <IconButton
            aria-label={t('artifacts.buckets.create', 'Create bucket')}
            onClick={props.onCreate}
          >
            <AddOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Box>
      {props.storageConfigurations.length > 0 && (
        <Select
          fullWidth
          size="small"
          aria-label={t('artifacts.buckets.storageAria', 'Storage integration')}
          value={props.selectedStorage ?? props.storageConfigurations[0]?.id ?? ''}
          onChange={(event) => props.onStorageChange(event.target.value)}
        >
          {props.storageConfigurations.map((configuration) => (
            <MenuItem
              key={configuration.id}
              value={configuration.id}
            >
              {configuration.title}
              {configuration.shared ? t('artifacts.buckets.sharedSuffix', ' (shared)') : ''}
            </MenuItem>
          ))}
        </Select>
      )}
      <SimpleSearchBar
        value={query}
        debounceMs={0}
        onChange={setQuery}
        placeholder={t('artifacts.buckets.search', 'Search buckets')}
      />
      <Divider />
      {props.loading ? (
        <Typography sx={{ p: 2 }}>{t('artifacts.buckets.loading', 'Loading buckets…')}</Typography>
      ) : (
        <List
          dense
          sx={{ overflowY: 'auto' }}
        >
          {visibleBuckets.map((bucket) => (
            <ListItemButton
              key={bucket.id}
              selected={bucket.name === props.selectedBucket}
              onClick={() => props.onSelect(bucket)}
            >
              <ListItemIcon sx={{ minWidth: '2rem' }}>
                <FolderOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={bucket.name}
                slotProps={{ primary: { noWrap: true } }}
              />
              <Tooltip title={bucket.isPinned
                ? t('artifacts.buckets.unpin', 'Unpin bucket')
                : t('artifacts.buckets.pin', 'Pin bucket')}
              >
                <IconButton
                  size="small"
                  aria-label={bucket.isPinned ? `Unpin ${bucket.name}` : `Pin ${bucket.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void props.onPin(bucket).catch(() => undefined);
                  }}
                >
                  {bucket.isPinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title={t('artifacts.buckets.rename', 'Rename bucket')}>
                <IconButton
                  size="small"
                  aria-label={`Rename ${bucket.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setRenaming(bucket);
                    setNextName(bucket.name);
                  }}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('artifacts.buckets.delete', 'Delete bucket')}>
                <IconButton
                  size="small"
                  aria-label={`Delete ${bucket.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleting(bucket);
                  }}
                >
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </ListItemButton>
          ))}
          {visibleBuckets.length === 0 && (
            <Typography sx={{ p: 2 }}>{t('artifacts.buckets.empty', 'No buckets found.')}</Typography>
          )}
        </List>
      )}
      <Dialog
        open={renaming !== undefined}
        onClose={() => setRenaming(undefined)}
      >
        <DialogTitle>{t('artifacts.buckets.rename', 'Rename bucket')}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('artifacts.buckets.nameLabel', 'Bucket name')}
            value={nextName}
            onChange={(event) => setNextName(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(undefined)}>{t('common.cancel', 'Cancel')}</Button>
          <Button
            variant="contained"
            disabled={nextName.trim() === '' || nextName === renaming?.name}
            onClick={() => {
              if (renaming === undefined) return;
              void props.onRename(renaming, nextName.trim())
                .then(() => setRenaming(undefined))
                .catch(() => undefined);
            }}
          >
            {t('common.rename', 'Rename')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={deleting !== undefined}
        onClose={() => setDeleting(undefined)}
      >
        <DialogTitle>{t('artifacts.buckets.deleteTitle', 'Delete bucket?')}</DialogTitle>
        <DialogContent>
          {t('artifacts.buckets.deleteDescription', 'This will remove {{name}} and all files inside it.', {
            name: deleting?.name ?? '',
          })}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(undefined)}>{t('common.cancel', 'Cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (deleting === undefined) return;
              void props.onDelete(deleting)
                .then(() => setDeleting(undefined))
                .catch(() => undefined);
            }}
          >
            {t('common.delete', 'Delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const sidebarSx: SxProps<Theme> = (theme) => ({
  width: '19rem',
  minWidth: '16rem',
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1.5),
  padding: theme.spacing(2),
  borderRight: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  backgroundColor: theme.vars.palette.background.default,
  overflow: 'hidden',
});
const headerSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
