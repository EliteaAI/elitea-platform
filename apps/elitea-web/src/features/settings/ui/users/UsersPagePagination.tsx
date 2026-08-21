/**
 * UsersPagePagination — the row-count select and the page-step buttons for
 * the users page.
 *
 * Extracted from `UsersPageContent.tsx` to keep that file under 400 lines.
 */
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';

import { ArrowLeftIcon } from '@/shared/ui/icons/arrow-left-icon';
import { ArrowRightIcon } from '@/shared/ui/icons/arrow-right-icon';
import { t } from '@/shared/i18n';

export function UsersPagePagination({
  usersPageStyles, startRow, endRow, pageSize, page, total,
  onPageSizeChange, onChangePage,
}: {
  usersPageStyles: typeof import('./UsersPage.styles').usersPageStyles;
  startRow: number;
  endRow: number;
  pageSize: number;
  page: number;
  total: number;
  onPageSizeChange: (size: number) => void;
  onChangePage: (page: number) => void;
}) {
  const isFirstPage = page <= 0;
  const isLastPage = (page + 1) * pageSize >= total;

  return (
    <Box sx={usersPageStyles.pagination}>
      <Typography variant="bodySmall" color="text.secondary">
        {t('shared.ui.settings.users.paginationInfo', `Showing ${startRow}–${endRow} of ${total}`, { startRow, endRow, total })}
      </Typography>
      <Box sx={usersPageStyles.pageSizeSelectContainer}>
        <Typography variant="bodySmall" sx={{ mr: 1 }}>
          {t('shared.ui.settings.users.rowsPerPage', 'Rows per page:')}
        </Typography>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={usersPageStyles.pageSizeSelect}
          aria-label={t('shared.ui.settings.users.pageSize', 'Rows per page')}
        >
          {[10, 20, 50, 100].map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
        <Box sx={usersPageStyles.paginationButtons}>
          <IconButton
            size="small"
            onClick={() => onChangePage(page - 1)}
            disabled={isFirstPage}
            aria-label={t('shared.ui.settings.users.prevPage', 'Previous page')}
          >
            <SvgIcon component={ArrowLeftIcon} inheritViewBox sx={{ width: '0.875rem', height: '0.875rem' }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => onChangePage(page + 1)}
            disabled={isLastPage}
            aria-label={t('shared.ui.settings.users.nextPage', 'Next page')}
          >
            <SvgIcon component={ArrowRightIcon} inheritViewBox sx={{ width: '0.875rem', height: '0.875rem' }} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
