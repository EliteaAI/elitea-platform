/**
 * AI Configuration barrel export.
 */
export { default as ConfigurationCard } from './ConfigurationCard';
export { default as ConfigurationSection } from './ConfigurationSection';
export { default as ProjectAIConfiguration } from './ProjectAIConfiguration';
export { default as CodePreview } from './CodePreview';
export { default as CodePreviewContent } from './CodePreviewContent';
export { default as CodePreviewEmpty } from './CodePreviewEmpty';
export { default as CodePreviewHeader } from './CodePreviewHeader';
export { default as OpenAITemplate } from './OpenAITemplate';
export { default as ModelCapabilitiesSection } from './ModelCapabilitiesSection';
export { default as FieldWithCopy } from './FieldWithCopy';
export type { ModelsApiResponse } from './api';
export { fetchModels } from './api';

export { CODE_EXAMPLE_TYPES, CODE_EXAMPLE_LABELS, DEFAULT_SETTINGS_LAYOUT } from './codeExamples';
export { getConfigurationDisplayName, getConfigurationStatus, isConfigurationEditable, getIconTypeKey, getConfigurationGroup, sortConfigurationsByDisplayName, createConfigurationOptions, CONFIGURATION_TYPE_GROUPS } from './configuration.helpers';
export { removeDuplicateModels } from './modelConfiguration.helpers';
export { useCodePreview } from './useCodePreview';
export { useModelConfiguration, createOptions } from './useModelConfiguration';
export { useConfigurationNavigation } from './useConfigurationNavigation';

/**
 * AIConfiguration — top-level tab content for the model configuration page.
 * Composes project config, configuration section, and model capabilities.
 */
export { AIConfiguration } from './AIConfiguration';
