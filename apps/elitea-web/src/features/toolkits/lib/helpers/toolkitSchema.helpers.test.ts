import { describe, expect, it } from 'vitest';

import { convertToolkitSchema } from './toolkitSchema.helpers';

describe('convertToolkitSchema', () => {
  it('returns an empty-properties object for an undefined/empty schema', () => {
    expect(convertToolkitSchema(undefined)).toEqual({ properties: {} });
    expect(convertToolkitSchema({})).toEqual({ properties: {} });
  });

  it('flattens json_schema_extra into the property', () => {
    const result = convertToolkitSchema({
      properties: { url: { type: 'string', json_schema_extra: { secret: true } } },
    });
    expect(result.properties.url).toEqual({ type: 'string', secret: true });
  });

  it('tags an llm_model-configuration_model property as llm_model, preserving the rest', () => {
    const result = convertToolkitSchema({
      properties: { model: { type: 'string', configuration_model: 'llm' } },
    });
    expect(result.properties.model).toMatchObject({ type: 'llm_model', configuration_model: 'llm' });
  });

  it('tags a bare "llm_model"-named property as llm_model even without configuration_model', () => {
    const result = convertToolkitSchema({ properties: { llm_model: { type: 'string' } } });
    expect(result.properties.llm_model?.type).toBe('llm_model');
  });

  it('tags an embedding_model property', () => {
    const result = convertToolkitSchema({
      properties: { embedding_model: { type: 'string' } },
    });
    expect(result.properties.embedding_model?.type).toBe('embedding_model');
  });

  it('tags an image_generation_model property', () => {
    const result = convertToolkitSchema({
      properties: { image_generation_model: { type: 'string' } },
    });
    expect(result.properties.image_generation_model?.type).toBe('image_generation_model');
  });

  it('tags a toolkit_types property as toolkit_reference and builds toolkit_filter', () => {
    const result = convertToolkitSchema({
      properties: { tool_ref: { type: 'string', toolkit_types: ['github'], application: true } },
    });
    expect(result.properties.tool_ref).toMatchObject({
      type: 'toolkit_reference',
      originalType: 'string',
      toolkit_filter: { toolkit_type: ['github'], application: true },
    });
  });

  it('tags an agent_tags property as agent_reference with an agent_filter', () => {
    const result = convertToolkitSchema({
      properties: { agent_ref: { type: 'string', agent_tags: ['support'] } },
    });
    expect(result.properties.agent_ref).toMatchObject({
      type: 'agent_reference',
      agent_filter: { agent_tags: ['support'] },
    });
  });

  it('tags a pipeline_tags property as pipeline_reference with a pipeline_filter', () => {
    const result = convertToolkitSchema({
      properties: { pipeline_ref: { type: 'string', pipeline_tags: ['etl'] } },
    });
    expect(result.properties.pipeline_ref).toMatchObject({
      type: 'pipeline_reference',
      pipeline_filter: { pipeline_tags: ['etl'] },
    });
  });

  it('resolves a direct $ref configuration property using $defs metadata.section', () => {
    const result = convertToolkitSchema({
      properties: { cred: { $ref: '#/$defs/CredentialRef' } },
      $defs: { CredentialRef: { metadata: { section: 'credentials' } } },
    });
    expect(result.properties.cred).toMatchObject({ type: 'configuration', section: 'credentials' });
  });

  it('resolves an anyOf-wrapped (Optional) $ref configuration property', () => {
    const result = convertToolkitSchema({
      properties: { cred: { anyOf: [{ $ref: '#/$defs/CredentialRef' }, { type: 'null' }] } },
      $defs: { CredentialRef: { metadata: { section: 'ai_credentials' } } },
    });
    expect(result.properties.cred).toMatchObject({ type: 'configuration', section: 'ai_credentials' });
  });

  it('does NOT tag a property carrying an explicit falsy toolkit_types marker as a toolkit_reference (R2 regression guard)', () => {
    // Matches the baseline's plain-JS-truthiness filter
    // (`toolkitSchemaUtils.js:43`: `properties[key].toolkit_types`) and the
    // Go backend's own `currentToolkitSchemaTruthy` categorization — an
    // explicit falsy marker (null here) must NOT route the field to the
    // toolkit-picker component; it must keep its real JSON-Schema type.
    const result = convertToolkitSchema({
      properties: { tool_ref: { type: 'string', toolkit_types: null } },
    });
    expect(result.properties.tool_ref).toEqual({ type: 'string', toolkit_types: null });
    expect(result.properties.tool_ref?.type).not.toBe('toolkit_reference');
  });

  it('does NOT tag a property carrying an explicit falsy agent_tags marker as an agent_reference (R2 regression guard)', () => {
    const result = convertToolkitSchema({
      properties: { agent_ref: { type: 'string', agent_tags: '' } },
    });
    expect(result.properties.agent_ref).toEqual({ type: 'string', agent_tags: '' });
    expect(result.properties.agent_ref?.type).not.toBe('agent_reference');
  });

  it('does NOT tag a property carrying an explicit falsy pipeline_tags marker as a pipeline_reference (R2 regression guard)', () => {
    const result = convertToolkitSchema({
      properties: { pipeline_ref: { type: 'string', pipeline_tags: false } },
    });
    expect(result.properties.pipeline_ref).toEqual({ type: 'string', pipeline_tags: false });
    expect(result.properties.pipeline_ref?.type).not.toBe('pipeline_reference');
  });

  it('leaves an ordinary property untouched (still a plain copy)', () => {
    const result = convertToolkitSchema({ properties: { name: { type: 'string' } } });
    expect(result.properties.name).toEqual({ type: 'string' });
  });

  it('preserves required and other top-level fields', () => {
    const result = convertToolkitSchema({ properties: { name: { type: 'string' } }, required: ['name'], title: 'GitHub' });
    expect(result.required).toEqual(['name']);
    expect(result.title).toBe('GitHub');
  });
});
