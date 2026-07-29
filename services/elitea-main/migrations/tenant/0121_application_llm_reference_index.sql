-- Configuration lifecycle repair locates exact saved LLM references and then
-- updates them in deterministic application-version ID order. The expression
-- index bounds lookup work without changing the current JSON contract.
CREATE INDEX IF NOT EXISTS application_versions_llm_model_name_idx
    ON application_versions ((llm_settings ->> 'model_name'), id);
