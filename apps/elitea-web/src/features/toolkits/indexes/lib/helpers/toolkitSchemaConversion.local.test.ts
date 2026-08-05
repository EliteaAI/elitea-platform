import { describe, expect, it } from 'vitest';

import { convertToolkitSchema } from './toolkitSchemaConversion.local';
import type { ToolkitTypeSchema } from './toolkitSchemaConversion.local';

describe('convertToolkitSchema', () => {
  it('returns an empty object for undefined or empty input', () => {
    expect(convertToolkitSchema(undefined)).toEqual({});
    expect(convertToolkitSchema({})).toEqual({});
  });

  it('flattens json_schema_extra onto the property, dropping the wrapper key', () => {
    const schema: ToolkitTypeSchema = {
      properties: {
        api_key: { json_schema_extra: { placeholder: 'sk-...' }, title: 'API Key' },
      },
    };
    const result = convertToolkitSchema(schema);
    expect(result.properties?.['api_key']).toMatchObject({ placeholder: 'sk-...', title: 'API Key' });
    expect(result.properties?.['api_key']).not.toHaveProperty('json_schema_extra');
  });

  it('classifies a $defs-referenced property as "configuration" and reads its metadata.section', () => {
    const schema: ToolkitTypeSchema = {
      properties: { credentials: { $ref: '#/$defs/GithubCreds' } },
      $defs: { GithubCreds: { metadata: { section: 'credentials' } } },
    };
    const result = convertToolkitSchema(schema);
    expect(result.properties?.['credentials']).toMatchObject({ type: 'configuration', section: 'credentials' });
  });

  it('classifies a $defs-referenced property inside anyOf the same way', () => {
    const schema: ToolkitTypeSchema = {
      properties: { credentials: { anyOf: [{ $ref: '#/$defs/GithubCreds' }, { type: 'null' }] } },
      $defs: { GithubCreds: { metadata: { section: 'credentials' } } },
    };
    const result = convertToolkitSchema(schema);
    expect(result.properties?.['credentials']).toMatchObject({ type: 'configuration', section: 'credentials' });
  });

  it('classifies configuration_model: "llm" (or the literal key "llm_model") as llm_model', () => {
    const schema: ToolkitTypeSchema = {
      properties: {
        model_choice: { configuration_model: 'llm' },
        llm_model: {},
      },
    };
    const result = convertToolkitSchema(schema);
    expect(result.properties?.['model_choice']).toMatchObject({ type: 'llm_model' });
    expect(result.properties?.['llm_model']).toMatchObject({ type: 'llm_model' });
  });

  it('classifies configuration_model: "embedding" as embedding_model', () => {
    const schema: ToolkitTypeSchema = { properties: { embed: { configuration_model: 'embedding' } } };
    const result = convertToolkitSchema(schema);
    expect(result.properties?.['embed']).toMatchObject({ type: 'embedding_model' });
  });

  it('classifies configuration_model: "image_generation" as image_generation_model', () => {
    const schema: ToolkitTypeSchema = { properties: { img: { configuration_model: 'image_generation' } } };
    const result = convertToolkitSchema(schema);
    expect(result.properties?.['img']).toMatchObject({ type: 'image_generation_model' });
  });

  it('classifies toolkit_types/agent_tags/pipeline_tags as their respective reference types', () => {
    const schema: ToolkitTypeSchema = {
      properties: {
        toolkit_ref: { toolkit_types: ['github'] },
        agent_ref: { agent_tags: ['tag'] },
        pipeline_ref: { pipeline_tags: ['tag'] },
      },
    };
    const result = convertToolkitSchema(schema);
    expect(result.properties?.['toolkit_ref']).toMatchObject({ type: 'toolkit_reference' });
    expect(result.properties?.['agent_ref']).toMatchObject({ type: 'agent_reference' });
    expect(result.properties?.['pipeline_ref']).toMatchObject({ type: 'pipeline_reference' });
  });

  it('leaves an unclassified property alone (no type field added)', () => {
    const schema: ToolkitTypeSchema = { properties: { plain_field: { title: 'Plain' } } };
    const result = convertToolkitSchema(schema);
    expect(result.properties?.['plain_field']).toEqual({ title: 'Plain' });
  });

  it('preserves "required" and other top-level fields untouched', () => {
    const schema: ToolkitTypeSchema = { properties: { a: {} }, required: ['a'], title: 'MySchema' };
    const result = convertToolkitSchema(schema);
    expect(result.required).toEqual(['a']);
    expect(result['title']).toBe('MySchema');
  });
});
