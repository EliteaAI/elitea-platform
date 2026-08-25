/**
 * The public skill catalog: what publishing produces, seen from the consuming
 * side.
 *
 * A publish control with no catalog is half a feature — an author can push a
 * skill into a catalog nobody can open. This is the other half: search, the
 * category filter the `skill_categories` list feeds (built-in defaults plus
 * whatever an administrator added on Features › Skill Publishing), and the
 * attach that forks a published skill into the reader's own project.
 *
 * Reduced from the reference's `skill-hub` feature (≈2100 lines across a modal,
 * a tab, category sections, cards and a like widget). What is dropped is
 * dropped for a reason, not for time:
 *
 *  - the like/trend widgets read the social plugin's like store, which this
 *    platform does not have — `public_skills` documents `my_liked` and the
 *    trend window as unimplemented for exactly that reason;
 *  - author decoration needs the same store.
 *
 * What is kept is everything the Go routes actually serve.
 */
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { CategoryFilter } from '@/shared/ui/CategoryFilter';

import { AttachPublicSkillDialog } from './AttachPublicSkillDialog';
import { useSkillCategories } from '../model/useSkillPublishing';
import { usePublicSkills } from '../model/usePublicSkills';
import type { PublicSkillSummary } from '../model/publishTypes';

/**
 * The version an attach should target: the published one.
 *
 * A catalog row carries every version the twin skill has, and only the
 * published ones are attachable — the server refuses a draft by id. Picking the
 * first version regardless would offer a row whose attach can only fail.
 */
export function publishedVersionIdOf(skill: PublicSkillSummary | undefined): number | undefined {
  const published = skill?.versions?.find((version) => version.status === 'published');
  return published?.id;
}

function SkillCard({
  skill,
  onUse,
}: {
  readonly skill: PublicSkillSummary;
  readonly onUse: () => void;
}): ReactNode {
  return (
    <Card
      variant="outlined"
      sx={{ width: 300 }}
    >
      <CardActionArea
        onClick={onUse}
        sx={{ p: 2, alignItems: 'flex-start', textAlign: 'left' }}
      >
        <Typography variant="labelMedium">{skill.name}</Typography>
        <Typography
          variant="bodySmall"
          color="text.secondary"
          sx={{ display: 'block', mt: 0.5 }}
        >
          {skill.description}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {(skill.tags ?? []).map((tag) => (
            <Chip
              key={tag}
              size="small"
              label={tag}
            />
          ))}
        </Box>
      </CardActionArea>
    </Card>
  );
}

export function PublicSkillsCatalog({ projectId }: { readonly projectId: string | undefined }): ReactNode {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>();
  const [selected, setSelected] = useState<PublicSkillSummary>();

  const categories = useSkillCategories(projectId);
  const catalog = usePublicSkills({
    ...(query.trim() ? { query: query.trim() } : {}),
    ...(category ? { category } : {}),
  });

  const categoryNames = useMemo(
    () => (categories.data ?? []).map((entry) => entry.name),
    [categories.data],
  );
  const rows = catalog.data?.rows ?? [];

  return (
    <Box data-testid="public-skills-catalog">
      <CategoryFilter
        title={t('skills.public.title', 'Public skills')}
        searchPlaceholder={t('skills.public.search', 'Search public skills')}
        searchQuery={query}
        onSearchChange={(event) => setQuery(event.target.value)}
        allCategories={categoryNames}
        selectedCategories={category ? [category] : []}
        // Selecting the chip that is already on clears the filter, which is the
        // only way back to "everything" without a second control.
        onSelectCategory={(name) => setCategory((current) => (current === name ? undefined : name))}
      >
        {catalog.isPending && <LinearProgress />}
        {catalog.isError && (
          <Alert severity="warning">
            {t('skills.public.error', 'Failed to load the public skill catalog.')}
          </Alert>
        )}
        {!catalog.isPending && !catalog.isError && rows.length === 0 && (
          <Typography
            variant="bodyMedium"
            color="text.secondary"
          >
            {t('skills.public.empty', 'No skills have been published to the catalog yet.')}
          </Typography>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
          {rows.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onUse={() => setSelected(skill)}
            />
          ))}
        </Box>
      </CategoryFilter>
      <AttachPublicSkillDialog
        open={selected !== undefined}
        projectId={projectId}
        skill={selected}
        versionId={publishedVersionIdOf(selected)}
        onClose={() => setSelected(undefined)}
      />
    </Box>
  );
}
