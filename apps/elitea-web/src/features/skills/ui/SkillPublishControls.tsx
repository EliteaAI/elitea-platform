/**
 * The publish surface as ONE component: the two toolbar controls and the dialog
 * behind them, over one state machine.
 *
 * The editor page used to hold all three pieces — the hook, the buttons' props
 * and the modal — and thread them together itself. That put a three-part
 * protocol in a page whose subject is editing a skill, and it put four more
 * symbols across the slice boundary for no gain: a caller has no decision to
 * make between "run the hook" and "render the dialog", so there was nothing for
 * it to compose.
 *
 * `permissions` is passed IN rather than read here. The permission set comes
 * from `widgets/sidebar`, and a feature reaching into a widget is the wrong
 * direction — the same layering rule `pages/agents/lib/isPublicAgentsProject.ts`
 * documents for `routes/`.
 */
import type { ReactNode } from 'react';

import { publishTargetOf } from '../lib/publishTarget';
import { useSkillPublishing } from '../model/useSkillPublishing';
import { PublishSkillModal } from './PublishSkillModal';
import { SkillPublishButtons } from './SkillPublishButtons';
import type { SkillRecord } from '../model/types';

export interface SkillPublishControlsProps {
  readonly projectId: string | undefined;
  readonly skill: SkillRecord | undefined;
  /** The skill's route id, which is not always the record's own. */
  readonly skillId: string | undefined;
  /** The version the URL selects, if any. */
  readonly versionId: string | undefined;
  readonly permissions: ReadonlySet<string>;
  /** Called after a publish or unpublish lands, to refetch what changed. */
  readonly onPublished: () => void;
}

export function SkillPublishControls({
  projectId,
  skill,
  skillId,
  versionId,
  permissions,
  onPublished,
}: SkillPublishControlsProps): ReactNode {
  const state = useSkillPublishing(
    projectId,
    publishTargetOf(skill, skillId, versionId),
    permissions,
    onPublished,
  );
  return (
    <>
      <SkillPublishButtons
        canShowPublish={state.canShowPublish}
        canPublish={state.canPublish}
        canUnpublish={state.canUnpublish}
        isUnpublishing={state.isUnpublishing}
        onPublish={state.open}
        onUnpublish={() => void state.unpublish()}
      />
      <PublishSkillModal state={state} />
    </>
  );
}
