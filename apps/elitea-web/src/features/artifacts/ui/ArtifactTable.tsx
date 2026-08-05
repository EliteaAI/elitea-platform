import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import CloudDownloadOutlinedIcon from '@mui/icons-material/CloudDownloadOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import PreviewOutlinedIcon from '@mui/icons-material/PreviewOutlined';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { formatArtifactSize, type Artifact } from '@/entities/artifact';
import { t } from '@/shared/i18n';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';

import { getItemsAtCurrentLevel, parsePrefixToBreadcrumbs } from '../lib/fileTree';
import type { ArtifactListItem } from '../model/types';

type SortField = 'name' | 'size' | 'lastModified';
type SortDirection = 'asc' | 'desc';

interface ArtifactTableProps {
  readonly contents: readonly Artifact[];
  readonly currentPrefix: string;
  readonly loading: boolean;
  readonly error?: string;
  readonly onPrefixChange: (prefix: string) => void;
  readonly onPreview: (item: ArtifactListItem) => void;
  readonly onDownload: (item: ArtifactListItem) => void;
  readonly onDownloadMany: (items: readonly ArtifactListItem[]) => void;
  readonly onDelete: (items: readonly ArtifactListItem[]) => void;
  readonly onUpload: (files: readonly File[]) => void;
}

function sortItems(
  items: readonly ArtifactListItem[],
  field: SortField,
  direction: SortDirection,
): ArtifactListItem[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
    if (field === 'size') return (left.size - right.size) * factor;
    const leftValue = field === 'name' ? left.name : left.lastModified ?? '';
    const rightValue = field === 'name' ? right.name : right.lastModified ?? '';
    return leftValue.localeCompare(rightValue) * factor;
  });
}

function displayDate(value: string | undefined): string {
  return value === undefined ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function ArtifactTable(props: ArtifactTableProps): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('lastModified');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const breadcrumbs = useMemo(() => parsePrefixToBreadcrumbs(props.currentPrefix), [props.currentPrefix]);
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = getItemsAtCurrentLevel(props.contents, props.currentPrefix)
      .filter((item) => needle === '' || item.name.toLowerCase().includes(needle));
    return sortItems(items, sortField, sortDirection);
  }, [props.contents, props.currentPrefix, query, sortDirection, sortField]);
  const paginated = useMemo(
    () => visibleItems.slice(page * pageSize, page * pageSize + pageSize),
    [page, pageSize, visibleItems],
  );
  const selectableIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selected.has(item.id)),
    [selected, visibleItems],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));

  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => selectableIds.includes(id))));
    if (page * pageSize >= visibleItems.length) setPage(0);
  }, [page, pageSize, selectableIds, visibleItems.length]);

  const toggleSort = (field: SortField): void => {
    if (sortField === field) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortDirection('asc');
    }
  };
  const stageInputFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files;
    if (files !== null) props.onUpload([...files]);
    event.target.value = '';
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    props.onUpload([...event.dataTransfer.files]);
  };

  return (
    <Paper
      elevation={0}
      sx={rootSx}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <Box sx={toolbarSx}>
        <Box>
          <Typography variant="headingSmall">{t('artifacts.table.title', 'Files')}</Typography>
          <Breadcrumbs aria-label={t('artifacts.table.breadcrumbsAria', 'Artifact folder path')}>
            <Link
              component="button"
              underline="hover"
              onClick={() => props.onPrefixChange('')}
            >
              {t('artifacts.table.root', 'Root')}
            </Link>
            {breadcrumbs.map((breadcrumb) => (
              <Link
                key={breadcrumb.path}
                component="button"
                underline="hover"
                onClick={() => props.onPrefixChange(breadcrumb.path)}
              >
                {breadcrumb.name}
              </Link>
            ))}
          </Breadcrumbs>
        </Box>
        <Box sx={actionsSx}>
          <SimpleSearchBar
            value={query}
            debounceMs={0}
            onChange={(value) => {
              setQuery(value);
              setPage(0);
            }}
            placeholder={t('artifacts.table.search', 'Search files')}
          />
          <input
            hidden
            ref={inputRef}
            type="file"
            multiple
            onChange={stageInputFiles}
          />
          <Button
            variant="contained"
            startIcon={<CloudUploadOutlinedIcon />}
            onClick={() => inputRef.current?.click()}
          >
            {t('common.upload', 'Upload')}
          </Button>
          <Tooltip title={t('artifacts.table.downloadSelected', 'Download selected')}>
            <span>
              <IconButton
                aria-label={t('artifacts.table.downloadSelected', 'Download selected')}
                disabled={!someSelected}
                onClick={() => props.onDownloadMany(selectedItems)}
              >
                <CloudDownloadOutlinedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('artifacts.table.deleteSelected', 'Delete selected')}>
            <span>
              <IconButton
                aria-label={t('artifacts.table.deleteSelected', 'Delete selected')}
                disabled={!someSelected}
                onClick={() => props.onDelete(selectedItems)}
              >
                <DeleteOutlinedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>
      {props.error !== undefined && <Typography sx={{ p: 2 }} role="alert">{props.error}</Typography>}
      <TableContainer sx={{ flex: 1 }}>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={allSelected}
                  indeterminate={!allSelected && someSelected}
                  slotProps={{ input: { 'aria-label': 'Select all artifacts' } }}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(selectableIds))}
                />
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'name'}
                  direction={sortField === 'name' ? sortDirection : 'asc'}
                  onClick={() => toggleSort('name')}
                >
                  {t('common.name', 'Name')}
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'size'}
                  direction={sortField === 'size' ? sortDirection : 'asc'}
                  onClick={() => toggleSort('size')}
                >
                  {t('common.size', 'Size')}
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'lastModified'}
                  direction={sortField === 'lastModified' ? sortDirection : 'asc'}
                  onClick={() => toggleSort('lastModified')}
                >
                  {t('artifacts.table.lastUpdate', 'Last update')}
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginated.map((item) => (
              <TableRow
                hover
                key={item.id}
                selected={selected.has(item.id)}
                sx={item.kind === 'folder' ? { cursor: 'pointer' } : undefined}
                onDoubleClick={() => item.kind === 'folder' ? props.onPrefixChange(item.key) : props.onPreview(item)}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selected.has(item.id)}
                    slotProps={{ input: { 'aria-label': `Select ${item.name}` } }}
                    onChange={() => setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })}
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {item.kind === 'folder' ? <FolderOutlinedIcon /> : <InsertDriveFileOutlinedIcon />}
                    <Link
                      component="button"
                      underline="hover"
                      onClick={() => item.kind === 'folder' ? props.onPrefixChange(item.key) : props.onPreview(item)}
                    >
                      {item.name}
                    </Link>
                  </Box>
                </TableCell>
                <TableCell>{item.kind === 'folder' ? '—' : formatArtifactSize(item.size)}</TableCell>
                <TableCell>{displayDate(item.lastModified)}</TableCell>
                <TableCell align="right">
                  {item.kind === 'file' && (
                    <Tooltip title={t('common.preview', 'Preview')}>
                      <IconButton
                        aria-label={`Preview ${item.name}`}
                        onClick={() => props.onPreview(item)}
                      >
                        <PreviewOutlinedIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title={t('common.download', 'Download')}>
                    <IconButton
                      aria-label={`Download ${item.name}`}
                      onClick={() => props.onDownload(item)}
                    >
                      <CloudDownloadOutlinedIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('common.delete', 'Delete')}>
                    <IconButton
                      aria-label={`Delete ${item.name}`}
                      onClick={() => props.onDelete([item])}
                    >
                      <DeleteOutlinedIcon />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!props.loading && visibleItems.length === 0 && (
          <Box sx={emptySx}>
            <Typography>{t('artifacts.table.empty', 'No files in this folder.')}</Typography>
            <Button
              startIcon={<CloudUploadOutlinedIcon />}
              onClick={() => inputRef.current?.click()}
            >
              {t('artifacts.table.uploadFiles', 'Upload files')}
            </Button>
          </Box>
        )}
        {props.loading && <Typography sx={{ p: 3 }}>{t('artifacts.table.loading', 'Loading files…')}</Typography>}
      </TableContainer>
      <TablePagination
        component="div"
        count={visibleItems.length}
        page={page}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[10, 25, 50, 100]}
        onPageChange={(_event, nextPage) => setPage(nextPage)}
        onRowsPerPageChange={(event) => {
          setPageSize(Number(event.target.value));
          setPage(0);
        }}
      />
    </Paper>
  );
}

const rootSx: SxProps<Theme> = { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const toolbarSx: SxProps<Theme> = (theme) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: theme.spacing(2),
  padding: theme.spacing(2),
  borderBottom: `0.0625rem solid ${theme.vars.palette.border.lines}`,
});
const actionsSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
const emptySx: SxProps<Theme> = { minHeight: '16rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' };
