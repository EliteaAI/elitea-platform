/**
 * "Import branding package…" (ADR-0024 WP9): a file picker that runs the dry
 * run at once, and the report it answers — problems, warnings, the manifest,
 * and the field-by-field diff — above an Apply button that is withheld, and
 * says why, until the report is clean.
 */
import { useRef, type DragEvent } from 'react';

import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import type { BrandingPackageReport } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';

import { formatDiffValue, formatPackageSize, formatPackageTime } from './brandingPackage';
import type { BrandingPackageState } from './useBrandingPackage';

const ZIP_ACCEPT = '.zip,application/zip';

function ProblemList({ report }: { readonly report: BrandingPackageReport }) {
  if (report.problems.length === 0) return null;
  return (
    <Alert severity="error" data-testid="branding-package-problems">
      <Typography variant="labelMedium" component="p">
        {t('pages.admin.branding.package.problems', 'The package cannot be applied:')}
      </Typography>
      <Box component="ul" sx={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
        {report.problems.map((problem, index) => (
          <li key={`${problem.entry}-${index}`}>
            <Typography variant="bodySmall" component="span" sx={{ fontFamily: (theme) => theme.typography.fontFamily }}>
              {problem.entry}
            </Typography>
            {` — ${problem.reason}`}
          </li>
        ))}
      </Box>
    </Alert>
  );
}

function WarningList({ report }: { readonly report: BrandingPackageReport }) {
  if (report.warnings.length === 0) return null;
  return (
    <Alert severity="warning" data-testid="branding-package-warnings">
      <Box component="ul" sx={{ margin: 0, paddingLeft: '1.25rem' }}>
        {report.warnings.map((warning, index) => (
          <li key={`${index}-${warning}`}>{warning}</li>
        ))}
      </Box>
    </Alert>
  );
}

function ManifestSummary({ report }: { readonly report: BrandingPackageReport }) {
  const manifest = report.manifest;
  if (manifest === undefined) return null;
  const rows: ReadonlyArray<readonly [string, string]> = [
    [t('pages.admin.branding.package.manifest.product', 'Product'), manifest.product],
    [t('pages.admin.branding.package.manifest.exportedAt', 'Exported'), formatPackageTime(manifest.exported_at)],
    [
      t('pages.admin.branding.package.manifest.deployment', 'Deployment'),
      manifest.deployment === undefined || manifest.deployment === ''
        ? t('pages.admin.branding.package.manifest.noDeployment', 'not stated')
        : manifest.deployment,
    ],
  ];
  return (
    <Box component="dl" data-testid="branding-package-manifest" sx={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: '1rem', rowGap: '0.25rem' }}>
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="labelSmall" color="text.secondary">
            {label}
          </Typography>
          <Typography component="dd" variant="bodySmall" sx={{ margin: 0 }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function DiffTable({ report }: { readonly report: BrandingPackageReport }) {
  const inherit = t('pages.admin.branding.package.diff.inherit', 'inherit');
  if (report.diff.length === 0) {
    return (
      <Typography variant="bodySmall" color="text.secondary" data-testid="branding-package-diff-empty">
        {t('pages.admin.branding.package.diff.none', 'No field changes — the package matches the current brand.')}
      </Typography>
    );
  }
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label={t('pages.admin.branding.package.diff.table', 'Field changes')} data-testid="branding-package-diff">
        <TableHead>
          <TableRow>
            <TableCell>{t('pages.admin.branding.package.diff.column.key', 'Field')}</TableCell>
            <TableCell>{t('pages.admin.branding.package.diff.column.current', 'Current')}</TableCell>
            <TableCell>{t('pages.admin.branding.package.diff.column.incoming', 'Incoming')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {report.diff.map((change) => (
            <TableRow key={change.key} data-testid={`branding-package-diff-${change.key}`}>
              <TableCell component="th" scope="row" sx={{ fontFamily: (theme) => theme.typography.fontFamily }}>
                {change.key}
              </TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>{formatDiffValue(change.current, inherit)}</TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>{formatDiffValue(change.incoming, inherit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

interface DropZoneProps {
  readonly file: File | undefined;
  readonly disabled: boolean;
  readonly onPickFile: (file: File) => void;
}

function DropZone({ file, disabled, onPickFile }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    if (disabled) return;
    const dropped = event.dataTransfer.files[0];
    if (dropped !== undefined) onPickFile(dropped);
  };
  return (
    <Box
      data-testid="branding-package-dropzone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '1.25rem',
        border: `0.0625rem dashed ${theme.vars.palette.border.lines}`,
        borderRadius: theme.vars.shape.radiusMd,
        backgroundColor: theme.vars.palette.background.default,
      })}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={ZIP_ACCEPT}
        data-testid="branding-package-input"
        aria-label={t('pages.admin.branding.package.file', 'Branding package file')}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (picked !== undefined) onPickFile(picked);
        }}
      />
      <Typography variant="bodySmall" color="text.secondary" sx={{ textAlign: 'center' }}>
        {t('pages.admin.branding.package.drop', 'Drop a branding package (.zip, at most 4 MiB) here, or choose one.')}
      </Typography>
      <Button
        size="small"
        variant="secondary"
        startIcon={<UploadFileOutlinedIcon />}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        data-testid="branding-package-choose"
      >
        {t('pages.admin.branding.package.choose', 'Choose file')}
      </Button>
      {file === undefined ? null : (
        <Typography variant="bodySmall" data-testid="branding-package-filename" sx={{ overflowWrap: 'anywhere' }}>
          {`${file.name} · ${formatPackageSize(file.size)}`}
        </Typography>
      )}
    </Box>
  );
}

export interface BrandingPackageImportDialogProps {
  readonly state: BrandingPackageState;
}

export function BrandingPackageImportDialog({ state }: BrandingPackageImportDialogProps) {
  const busy = state.phase !== 'idle';
  return (
    <Dialog
      open={state.importOpen}
      onClose={state.onCloseImport}
      fullWidth
      maxWidth="md"
      aria-labelledby="branding-package-import-title"
      data-testid="branding-package-dialog"
    >
      <DialogTitle id="branding-package-import-title">
        {t('pages.admin.branding.package.import.title', 'Import branding package')}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Typography variant="bodySmall" color="text.secondary">
          {t(
            'pages.admin.branding.package.import.body',
            'The package is checked first and nothing changes. Apply sets every branding key from it in one step; the current brand is kept for rollback.',
          )}
        </Typography>
        <DropZone file={state.file} disabled={busy} onPickFile={state.onPickFile} />
        {state.phase === 'checking' ? (
          <LinearProgress aria-label={t('pages.admin.branding.package.checking', 'Checking the package')} />
        ) : null}
        {state.checkError === undefined ? null : (
          <Alert severity="error" data-testid="branding-package-check-error">
            {state.checkError}
          </Alert>
        )}
        {state.report === undefined ? null : (
          <>
            <ProblemList report={state.report} />
            <WarningList report={state.report} />
            <ManifestSummary report={state.report} />
            <DiffTable report={state.report} />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        {state.applyBlockedReason === undefined || state.file === undefined ? null : (
          <Typography variant="bodySmall" color="text.secondary" data-testid="branding-package-apply-blocked" sx={{ marginRight: 'auto' }}>
            {state.applyBlockedReason}
          </Typography>
        )}
        <Button variant="secondary" size="small" onClick={state.onCloseImport} disabled={busy} data-testid="branding-package-cancel">
          {t('pages.admin.branding.package.import.cancel', 'Cancel')}
        </Button>
        <Button
          variant="elitea"
          color="primary"
          size="small"
          onClick={state.onApply}
          disabled={!state.canApply}
          data-testid="branding-package-apply"
        >
          {state.phase === 'applying'
            ? t('pages.admin.branding.package.import.applying', 'Applying…')
            : t('pages.admin.branding.package.import.apply', 'Apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
