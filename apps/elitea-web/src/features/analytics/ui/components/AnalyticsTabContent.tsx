import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ProjectAnalytics } from '@/shared/api/generated/model';

import { AnalyticsAgents } from '../AnalyticsAgents';
import { AnalyticsGuide } from '../AnalyticsGuide';
import { AnalyticsHealth } from '../AnalyticsHealth';
import { AnalyticsOverview } from '../AnalyticsOverview';
import { AnalyticsTools } from '../AnalyticsTools';
import { AnalyticsUsers } from '../AnalyticsUsers';
import { AnalyticsLoadError } from './DetailStatus';

/**
 * The six-tab body of `AnalyticsContainer`'s content area. Extracted purely
 * to bring `AnalyticsContainer` itself under the `eslint(complexity)`
 * budget (12) — the eight-plus branch points below (loading/error/six
 * tabs) were the bulk of that function's complexity of 19. The `switch` is
 * further split into its own function (`renderTabBody`) — the loading/
 * error guards plus a 6-case switch in one function still measured 13.
 */
export interface AnalyticsTabContentProps {
  readonly activeTab: number;
  readonly needsOverview: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly data: ProjectAnalytics | undefined;
  readonly projectId: string | undefined;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly pendingUserId: string | null;
  readonly onUserClick: (userId: string) => void;
  readonly onBackToSource: () => void;
}

const centeredSx: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: (theme: Theme) => theme.spacing(8),
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
};

type TabBodyProps = Omit<AnalyticsTabContentProps, 'needsOverview' | 'isFetching' | 'isError'>;

function renderTabBody({
  activeTab,
  data,
  projectId,
  dateFrom,
  dateTo,
  pendingUserId,
  onUserClick,
  onBackToSource,
}: TabBodyProps): ReactNode {
  switch (activeTab) {
    case 0:
      return data === undefined ? null : (
        <AnalyticsOverview
          data={data}
          onUserClick={onUserClick}
        />
      );
    case 1:
      return (
        <AnalyticsAgents
          projectId={projectId}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      );
    case 2:
      return (
        <AnalyticsTools
          projectId={projectId}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      );
    case 3:
      return (
        <AnalyticsUsers
          projectId={projectId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          initialUserId={pendingUserId}
          onBackToSource={onBackToSource}
        />
      );
    case 4:
      return data === undefined ? null : <AnalyticsHealth dailyActivity={data.daily_activity} />;
    case 5:
      return <AnalyticsGuide />;
    default:
      return null;
  }
}

export function AnalyticsTabContent(props: AnalyticsTabContentProps): ReactNode {
  const { needsOverview, isFetching, isError } = props;

  if (needsOverview && isFetching) {
    return (
      <Box sx={centeredSx}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  // Only the OVERVIEW query's failure is visible here (`isError` comes from
  // `AnalyticsContainer`'s usage-summary query). The Agents/Tools/Users tabs
  // each own a separate query, so they render their own `AnalyticsLoadError`
  // — see each tab's `isError` guard.
  if (needsOverview && isError) {
    return <AnalyticsLoadError />;
  }

  return renderTabBody(props);
}
