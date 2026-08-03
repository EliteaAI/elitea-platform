/**
 * Split out of `ChatBox.tsx` to stay under the file-length/complexity
 * budgets (§3.5) — `NewChatInput`'s `slots` prop bundle (attachment button,
 * internal-tools-config button, voice button, LLM model selector), grouped
 * into option objects the same way `ChatBoxPopups` groups its own props.
 */
import type { ComponentProps, ReactNode } from 'react';

import { AttachmentButton, ChatInternalToolsConfigButton, VoiceButton } from '@/widgets/chat';
import { LLMModelSelector } from '@/widgets/llm-model-selector';

import { optField } from './ChatBox.helpers';

type LLMSettingsValues = NonNullable<ComponentProps<typeof LLMModelSelector>['llmSettings']>;
type LLMModelListItem = NonNullable<ComponentProps<typeof LLMModelSelector>['models']>[number];
type InternalToolItem = NonNullable<ComponentProps<typeof ChatInternalToolsConfigButton>['tools']>[number];

interface ChatBoxInputSlotsAttachments {
  readonly attachments: ComponentProps<typeof AttachmentButton>['attachments'] | undefined;
  readonly onAttachFiles: ComponentProps<typeof AttachmentButton>['onAttachFiles'] | undefined;
}

interface ChatBoxInputSlotsInternalTools {
  readonly disabled: boolean;
  readonly tools: readonly InternalToolItem[];
  readonly onToolChange: ComponentProps<typeof ChatInternalToolsConfigButton>['onToolChange'] | undefined;
}

interface ChatBoxInputSlotsModel {
  readonly llmSettings: LLMSettingsValues | undefined;
  readonly onSetLLMSettings: ((settings: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly selectedModel: ComponentProps<typeof LLMModelSelector>['selectedModel'];
  readonly onSelectModel: ComponentProps<typeof LLMModelSelector>['onSelectModel'];
  readonly models: readonly LLMModelListItem[];
}

export interface ChatBoxInputSlotsProps {
  readonly attachments: ChatBoxInputSlotsAttachments;
  readonly internalTools: ChatBoxInputSlotsInternalTools;
  readonly model: ChatBoxInputSlotsModel;
}

export interface ChatBoxInputSlotsResult {
  readonly attachmentButton: ReactNode;
  readonly internalToolsConfig: ReactNode;
  readonly voiceButton: ReactNode;
  readonly modelSelector: ReactNode;
}

/** Builds `NewChatInput`'s `slots` prop bundle — a function (not a component) so its return type slots directly into `NewChatInput`'s `slots` prop without an extra wrapper element. Prop objects are built as local consts (not inline `{...optField(...)}` spreads) so their `optField`-derived string keys aren't parsed as JSX-nested literals by the `i18next/no-literal-string` gate. */
export function buildChatBoxInputSlots({ attachments, internalTools, model }: ChatBoxInputSlotsProps): ChatBoxInputSlotsResult {
  const attachmentButtonProps = {
    disableAttachments: false,
    ...optField('attachments', attachments.attachments),
    ...optField('onAttachFiles', attachments.onAttachFiles),
  };
  const internalToolsConfigProps = {
    disabled: internalTools.disabled,
    tools: [...internalTools.tools],
    ...optField('onToolChange', internalTools.onToolChange),
  };
  const modelSelectorProps = {
    ...optField('llmSettings', model.llmSettings),
    ...optField('onSetLLMSettings', model.onSetLLMSettings ? (settings: LLMSettingsValues) => model.onSetLLMSettings?.(settings as Readonly<Record<string, unknown>>) : undefined),
    ...optField('selectedModel', model.selectedModel),
    ...optField('onSelectModel', model.onSelectModel),
    models: [...model.models],
  };
  return {
    attachmentButton: <AttachmentButton {...attachmentButtonProps} />,
    internalToolsConfig: <ChatInternalToolsConfigButton {...internalToolsConfigProps} />,
    voiceButton: <VoiceButton disabled={false} onRecordingChange={() => {}} />,
    modelSelector: <LLMModelSelector {...modelSelectorProps} />,
  };
}
