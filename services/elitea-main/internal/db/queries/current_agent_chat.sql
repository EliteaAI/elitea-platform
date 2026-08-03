-- name: ResolveInitialCurrentApplicationTurn :one
SELECT conversation.id AS conversation_id,
       author_participant.id AS author_participant_id,
       target_participant.id AS target_participant_id,
       (target_participant.entity_meta ->> 'id')::integer AS application_id,
       (target_participant.entity_meta ->> 'project_id')::integer AS application_project_id,
       (target_mapping.entity_settings ->> 'version_id')::integer AS application_version_id,
       COALESCE(target_mapping.entity_settings -> 'variables', '[]'::jsonb)::text AS application_variables_json,
       jsonb_build_object(
           'id', application_version.id,
           'application_id', application_version.application_id,
           'name', application_version.name,
           'status', application_version.status,
           'created_at', application_version.created_at,
           'agent_type', application_version.agent_type,
           'instructions', COALESCE(application_version.instructions, ''),
           'welcome_message', COALESCE(application_version.welcome_message, ''),
           'llm_settings', COALESCE(NULLIF(application_version.llm_settings::jsonb, 'null'::jsonb), '{}'::jsonb),
           'meta', COALESCE(NULLIF(application_version.meta::jsonb, 'null'::jsonb), '{}'::jsonb),
           'conversation_starters', COALESCE(NULLIF(application_version.conversation_starters::jsonb, 'null'::jsonb), '[]'::jsonb),
           'pipeline_settings', COALESCE(NULLIF(application_version.pipeline_settings::jsonb, 'null'::jsonb), '{}'::jsonb),
           'author_id', application_version.author_id,
           'tools', COALESCE((
               SELECT jsonb_agg(
                   jsonb_build_object(
                       'id', tool.id,
                       'type', tool.type,
                       'name', tool.name,
                       'description', tool.description,
                       'author_id', tool.author_id,
                       'settings', CASE
                           WHEN jsonb_typeof(tool.settings -> 'selected_tools') = 'array'
                            AND jsonb_array_length(tool.settings -> 'selected_tools') > 0
                           THEN tool.settings
                                || jsonb_build_object(
                                       'available_tools', tool.settings -> 'selected_tools'
                                   )
                                || CASE
                                       WHEN jsonb_typeof(application_tool_mapping.selected_tools) = 'array'
                                        AND jsonb_array_length(application_tool_mapping.selected_tools) > 0
                                       THEN jsonb_build_object(
                                           'selected_tools', CASE
                                               WHEN jsonb_array_length(selected_tools_intersection.value) > 0
                                               THEN selected_tools_intersection.value
                                               ELSE application_tool_mapping.selected_tools
                                           END
                                       )
                                       ELSE '{}'::jsonb
                                   END
                           WHEN jsonb_typeof(application_tool_mapping.selected_tools) = 'array'
                            AND jsonb_array_length(application_tool_mapping.selected_tools) > 0
                           THEN tool.settings || jsonb_build_object(
                               'selected_tools', application_tool_mapping.selected_tools
                           )
                           ELSE tool.settings
                       END,
                       'meta', tool.meta,
                       'created_at', tool.created_at,
                       'toolkit_name', tool.name,
                       'author', NULL,
                       'agent_type', NULL,
                       'online', NULL,
                       'icon_meta', NULL,
                       'variables', '[]'::jsonb,
                       'is_pinned', FALSE,
                       'indexes_count', NULL
                   )
                   ORDER BY application_tool_mapping.id
               )
               FROM entity_tool_mapping AS application_tool_mapping
               JOIN elitea_tools AS tool
                 ON tool.id = application_tool_mapping.tool_id
               LEFT JOIN LATERAL (
                   SELECT COALESCE(
                       jsonb_agg(selected.value ORDER BY selected.ordinality),
                       '[]'::jsonb
                   ) AS value
                   FROM jsonb_array_elements_text(
                       CASE
                           WHEN jsonb_typeof(application_tool_mapping.selected_tools) = 'array'
                           THEN application_tool_mapping.selected_tools
                           ELSE '[]'::jsonb
                       END
                   ) WITH ORDINALITY AS selected(value, ordinality)
                   WHERE jsonb_typeof(tool.settings -> 'selected_tools') = 'array'
                     AND tool.settings -> 'selected_tools' ? selected.value
               ) AS selected_tools_intersection ON TRUE
               WHERE application_tool_mapping.entity_version_id = application_version.id
                 AND application_tool_mapping.entity_id = application_version.application_id
                 AND application_tool_mapping.entity_type = 'agent'
           ), '[]'::jsonb),
           'tags', '[]'::jsonb,
           'variables', '[]'::jsonb
       )::text AS application_version_details_json
FROM chat_conversations AS conversation
JOIN chat_participant_mapping AS author_mapping
  ON author_mapping.conversation_id = conversation.id
JOIN chat_participants AS author_participant
  ON author_participant.id = author_mapping.participant_id
 AND author_participant.entity_name = 'user'
 AND (author_participant.entity_meta ->> 'id')::bigint = sqlc.arg(actor_user_id)::bigint
JOIN chat_participant_mapping AS target_mapping
  ON target_mapping.conversation_id = conversation.id
 AND target_mapping.participant_id = sqlc.arg(target_participant_id)::integer
JOIN chat_participants AS target_participant
  ON target_participant.id = target_mapping.participant_id
 AND target_participant.entity_name = 'application'
JOIN application_versions AS application_version
  ON application_version.id = (target_mapping.entity_settings ->> 'version_id')::integer
 AND application_version.application_id = (target_participant.entity_meta ->> 'id')::integer
WHERE conversation.uuid = sqlc.arg(conversation_uuid)::uuid
  AND (target_participant.entity_meta ->> 'project_id')::integer = sqlc.arg(project_id)::integer
  AND application_version.agent_type <> 'pipeline'
  AND COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb) = '[]'::jsonb
  AND NOT EXISTS (
      SELECT 1
      FROM chat_message_group AS existing_message
      WHERE existing_message.conversation_id = conversation.id
  );

-- name: LockCurrentAgentConversation :one
SELECT id
FROM chat_conversations
WHERE uuid = sqlc.arg(conversation_uuid)::uuid
FOR UPDATE;

-- name: InsertInitialCurrentApplicationTurn :one
WITH resolved AS MATERIALIZED (
    SELECT conversation.id AS conversation_id,
           author_participant.id AS author_participant_id,
           target_participant.id AS target_participant_id
    FROM chat_conversations AS conversation
    JOIN chat_participant_mapping AS author_mapping
      ON author_mapping.conversation_id = conversation.id
    JOIN chat_participants AS author_participant
      ON author_participant.id = author_mapping.participant_id
     AND author_participant.entity_name = 'user'
     AND (author_participant.entity_meta ->> 'id')::bigint = sqlc.arg(actor_user_id)::bigint
    JOIN chat_participant_mapping AS target_mapping
      ON target_mapping.conversation_id = conversation.id
     AND target_mapping.participant_id = sqlc.arg(target_participant_id)::integer
    JOIN chat_participants AS target_participant
      ON target_participant.id = target_mapping.participant_id
     AND target_participant.entity_name = 'application'
    JOIN application_versions AS application_version
      ON application_version.id = sqlc.arg(application_version_id)::integer
     AND application_version.id = (target_mapping.entity_settings ->> 'version_id')::integer
     AND application_version.application_id = sqlc.arg(application_id)::integer
     AND application_version.application_id = (target_participant.entity_meta ->> 'id')::integer
    WHERE conversation.uuid = sqlc.arg(conversation_uuid)::uuid
      AND (target_participant.entity_meta ->> 'project_id')::integer = sqlc.arg(project_id)::integer
      AND application_version.agent_type <> 'pipeline'
      AND COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb) = '[]'::jsonb
      AND NOT EXISTS (
          SELECT 1
          FROM chat_message_group AS existing_message
          WHERE existing_message.conversation_id = conversation.id
      )
), question_group AS (
    INSERT INTO chat_message_group (
        uuid, author_participant_id, conversation_id, sent_to_id, meta,
        is_streaming, created_at
    )
    SELECT sqlc.arg(question_id)::uuid,
           resolved.author_participant_id,
           resolved.conversation_id,
           resolved.target_participant_id,
           sqlc.arg(question_meta)::jsonb,
           FALSE,
           clock_timestamp()
    FROM resolved
    RETURNING id, uuid, conversation_id, sent_to_id
), question_item AS (
    INSERT INTO chat_message_items (
        uuid, item_type, order_index, meta, message_group_id
    )
    SELECT sqlc.arg(question_item_id)::uuid,
           'text_message',
           0,
           '{}'::jsonb,
           question_group.id
    FROM question_group
    RETURNING id
), question_text AS (
    INSERT INTO chat_messages_text (id, content)
    SELECT question_item.id, sqlc.arg(user_input)::text
    FROM question_item
), response_group AS (
    INSERT INTO chat_message_group (
        uuid, author_participant_id, conversation_id, reply_to_id, meta,
        is_streaming, created_at, task_id
    )
    SELECT sqlc.arg(response_message_id)::uuid,
           question_group.sent_to_id,
           question_group.conversation_id,
           question_group.id,
           jsonb_build_object(
               'execution_generation',
               sqlc.arg(execution_generation)::text
           ),
           TRUE,
           clock_timestamp() + interval '1 second',
           sqlc.arg(execution_id)::text
    FROM question_group
    RETURNING id, uuid
)
SELECT response_group.id AS response_message_group_id,
       response_group.uuid AS response_message_id
FROM response_group;
