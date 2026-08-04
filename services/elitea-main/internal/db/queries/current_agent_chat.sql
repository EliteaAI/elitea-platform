-- name: ResolveCurrentApplicationTurn :one
SELECT conversation.id AS conversation_id,
       author_participant.id AS author_participant_id,
       target_participant.id AS target_participant_id,
       (target_participant.entity_meta ->> 'id')::integer AS application_id,
       (target_participant.entity_meta ->> 'project_id')::integer AS application_project_id,
       (target_mapping.entity_settings ->> 'version_id')::integer AS application_version_id,
       COALESCE(target_mapping.entity_settings -> 'variables', '[]'::jsonb)::text AS application_variables_json,
       COALESCE(current_history.chat_history, '[]'::jsonb)::text AS chat_history_json,
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
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
               jsonb_build_object(
                   'role', history_group.role,
                   'content', history_group.content,
                   'additional_kwargs', '{}'::jsonb
               )
               ORDER BY history_group.created_at, history_group.id
           ) AS chat_history
    FROM (
        SELECT message_group.id,
               message_group.created_at,
               CASE
                   WHEN author.entity_name = 'user' THEN 'user'
                   ELSE 'assistant'
               END AS role,
               jsonb_agg(
                   jsonb_build_object('type', 'text', 'text', message_text.content)
                   ORDER BY message_item.order_index, message_item.id
               ) FILTER (WHERE message_text.content <> '') AS content
        FROM chat_message_group AS message_group
        JOIN chat_participants AS author
          ON author.id = message_group.author_participant_id
        JOIN chat_message_items AS message_item
          ON message_item.message_group_id = message_group.id
         AND message_item.item_type = 'text_message'
        JOIN chat_messages_text AS message_text
          ON message_text.id = message_item.id
        WHERE message_group.conversation_id = conversation.id
          AND message_group.created_at < COALESCE(
              (
                  SELECT current_question.created_at
                  FROM chat_message_group AS current_question
                  WHERE current_question.conversation_id = conversation.id
                    AND current_question.uuid = sqlc.arg(question_id)::uuid
              ),
              statement_timestamp()
          )
        GROUP BY message_group.id, message_group.created_at, author.entity_name
    ) AS history_group
    WHERE jsonb_array_length(history_group.content) > 0
) AS current_history ON TRUE
WHERE conversation.uuid = sqlc.arg(conversation_uuid)::uuid
  AND (target_participant.entity_meta ->> 'project_id')::integer = sqlc.arg(project_id)::integer
  AND application_version.agent_type <> 'pipeline'
  AND jsonb_typeof(COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)) = 'array'
  AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
          CASE
              WHEN jsonb_typeof(COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)) = 'array'
              THEN COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)
              ELSE '[]'::jsonb
          END
      ) AS internal_tool(value)
      WHERE jsonb_typeof(internal_tool.value) <> 'string'
         OR internal_tool.value #>> '{}' <> 'internal_mcp'
  )
  AND COALESCE(application_version.meta::jsonb -> 'internal_tools', '[]'::jsonb) = '[]'::jsonb
  AND COALESCE(
      conversation.meta #>> '{context_analytics,last_summarization,summary_content}',
      ''
  ) = ''
  AND NOT EXISTS (
      SELECT 1
      FROM chat_message_group AS pending_response
      WHERE pending_response.conversation_id = conversation.id
        AND pending_response.is_streaming
        AND NOT EXISTS (
            SELECT 1
            FROM chat_message_group AS retried_question
            WHERE retried_question.id = pending_response.reply_to_id
              AND retried_question.uuid = sqlc.arg(question_id)::uuid
        )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM chat_message_group AS historical_group
      JOIN chat_message_items AS historical_item
        ON historical_item.message_group_id = historical_group.id
      WHERE historical_group.conversation_id = conversation.id
        AND historical_group.created_at < COALESCE(
            (
                SELECT current_question.created_at
                FROM chat_message_group AS current_question
                WHERE current_question.conversation_id = conversation.id
                  AND current_question.uuid = sqlc.arg(question_id)::uuid
            ),
            statement_timestamp()
        )
        AND (
            historical_item.item_type IN ('attachment_message', 'canvas_message')
            OR (
                historical_item.item_type = 'context_message'
                AND NOT EXISTS (
                    SELECT 1
                    FROM chat_messages_context AS historical_context
                    WHERE historical_context.id = historical_item.id
                      AND historical_context.context_type = 'support_assistant_context'
                      AND jsonb_typeof(historical_context.context_data) = 'object'
                      AND historical_context.context_data ->> 'user_id'
                          = sqlc.arg(actor_user_id)::bigint::text
                      AND historical_context.context_data ->> 'project_id'
                          = sqlc.arg(project_id)::integer::text
                      AND historical_context.context_data - 'user_id' - 'project_id' = '{}'::jsonb
                )
            )
        )
  );

-- name: ResolveCurrentAdhocTurn :one
SELECT conversation.id AS conversation_id,
       author_participant.id AS author_participant_id,
       target_participant.id AS target_participant_id,
       COALESCE(author_mapping.entity_settings -> 'llm_settings', '{}'::jsonb)::text AS llm_settings_json,
       (CASE
           WHEN COALESCE(conversation.meta ->> 'default_instructions', '') = ''
           THEN COALESCE(conversation.instructions, '')
           WHEN COALESCE(conversation.instructions, '') = ''
           THEN conversation.meta ->> 'default_instructions'
           ELSE conversation.instructions || E'\n\n' || (conversation.meta ->> 'default_instructions')
       END)::text AS instructions,
       COALESCE(conversation.meta, '{}'::jsonb)::text AS conversation_meta_json,
       COALESCE(current_tools.tools, '[]'::jsonb)::text AS tools_json,
       COALESCE(current_history.chat_history, '[]'::jsonb)::text AS chat_history_json
FROM chat_conversations AS conversation
JOIN chat_participant_mapping AS author_mapping
  ON author_mapping.conversation_id = conversation.id
JOIN chat_participants AS author_participant
  ON author_participant.id = author_mapping.participant_id
 AND author_participant.entity_name = 'user'
 AND (author_participant.entity_meta ->> 'id')::bigint = sqlc.arg(actor_user_id)::bigint
JOIN chat_participant_mapping AS target_mapping
  ON target_mapping.conversation_id = conversation.id
JOIN chat_participants AS target_participant
  ON target_participant.id = target_mapping.participant_id
 AND target_participant.entity_name = 'dummy'
 AND (
     sqlc.arg(target_participant_id)::integer = 0
     OR target_participant.id = sqlc.arg(target_participant_id)::integer
 )
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
               jsonb_build_object(
                   'id', tool.id,
                   'type', tool.type,
                   'name', tool.name,
                   'description', tool.description,
                   'author_id', tool.author_id,
                   'project_id', sqlc.arg(project_id)::integer,
                   'settings', tool.settings,
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
               ORDER BY toolkit_mapping.id
           ) AS tools
    FROM chat_participant_mapping AS toolkit_mapping
    JOIN chat_participants AS toolkit_participant
      ON toolkit_participant.id = toolkit_mapping.participant_id
     AND toolkit_participant.entity_name = 'toolkit'
    JOIN elitea_tools AS tool
      ON tool.id::text = toolkit_participant.entity_meta ->> 'id'
    WHERE toolkit_mapping.conversation_id = conversation.id
      AND toolkit_participant.entity_meta ->> 'project_id' = (sqlc.arg(project_id)::integer)::text
) AS current_tools ON TRUE
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
               jsonb_build_object(
                   'role', history_group.role,
                   'content', history_group.content,
                   'additional_kwargs', '{}'::jsonb
               )
               ORDER BY history_group.created_at, history_group.id
           ) AS chat_history
    FROM (
        SELECT message_group.id,
               message_group.created_at,
               CASE
                   WHEN author.entity_name = 'user' THEN 'user'
                   ELSE 'assistant'
               END AS role,
               jsonb_agg(
                   jsonb_build_object('type', 'text', 'text', message_text.content)
                   ORDER BY message_item.order_index, message_item.id
               ) FILTER (WHERE message_text.content <> '') AS content
        FROM chat_message_group AS message_group
        JOIN chat_participants AS author
          ON author.id = message_group.author_participant_id
        JOIN chat_message_items AS message_item
          ON message_item.message_group_id = message_group.id
         AND message_item.item_type = 'text_message'
        JOIN chat_messages_text AS message_text
          ON message_text.id = message_item.id
        WHERE message_group.conversation_id = conversation.id
          AND message_group.created_at < COALESCE(
              (
                  SELECT current_question.created_at
                  FROM chat_message_group AS current_question
                  WHERE current_question.conversation_id = conversation.id
                    AND current_question.uuid = sqlc.arg(question_id)::uuid
              ),
              statement_timestamp()
          )
        GROUP BY message_group.id, message_group.created_at, author.entity_name
    ) AS history_group
    WHERE jsonb_array_length(history_group.content) > 0
) AS current_history ON TRUE
WHERE conversation.uuid = sqlc.arg(conversation_uuid)::uuid
  AND jsonb_typeof(COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)) = 'array'
  AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
          CASE
              WHEN jsonb_typeof(COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)) = 'array'
              THEN COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)
              ELSE '[]'::jsonb
          END
      ) AS internal_tool(value)
      WHERE jsonb_typeof(internal_tool.value) <> 'string'
         OR internal_tool.value #>> '{}' <> 'internal_mcp'
  )
  AND COALESCE(
      conversation.meta #>> '{context_analytics,last_summarization,summary_content}',
      ''
  ) = ''
  AND NOT EXISTS (
      SELECT 1
      FROM configuration AS project_context
      WHERE project_context.type = 'project_context'
        AND project_context.data ->> 'enabled' = 'true'
        AND COALESCE(project_context.data ->> 'content', '') <> ''
  )
  AND NOT EXISTS (
      SELECT 1
      FROM chat_participant_mapping AS unsupported_mapping
      JOIN chat_participants AS unsupported_participant
        ON unsupported_participant.id = unsupported_mapping.participant_id
      WHERE unsupported_mapping.conversation_id = conversation.id
        AND unsupported_participant.entity_name NOT IN ('user', 'dummy', 'toolkit')
  )
  AND NOT EXISTS (
      SELECT 1
      FROM chat_participant_mapping AS invalid_toolkit_mapping
      JOIN chat_participants AS invalid_toolkit_participant
        ON invalid_toolkit_participant.id = invalid_toolkit_mapping.participant_id
       AND invalid_toolkit_participant.entity_name = 'toolkit'
      LEFT JOIN elitea_tools AS invalid_toolkit
        ON invalid_toolkit.id::text = invalid_toolkit_participant.entity_meta ->> 'id'
      WHERE invalid_toolkit_mapping.conversation_id = conversation.id
        AND (
            invalid_toolkit_participant.entity_meta ->> 'project_id'
                IS DISTINCT FROM (sqlc.arg(project_id)::integer)::text
            OR invalid_toolkit.id IS NULL
            OR invalid_toolkit.type IN ('application', 'mcp')
            OR invalid_toolkit.meta ->> 'mcp' = 'true'
        )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM chat_message_group AS pending_response
      WHERE pending_response.conversation_id = conversation.id
        AND pending_response.is_streaming
        AND NOT EXISTS (
            SELECT 1
            FROM chat_message_group AS retried_question
            WHERE retried_question.id = pending_response.reply_to_id
              AND retried_question.uuid = sqlc.arg(question_id)::uuid
        )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM chat_message_group AS historical_group
      JOIN chat_message_items AS historical_item
        ON historical_item.message_group_id = historical_group.id
      WHERE historical_group.conversation_id = conversation.id
        AND historical_group.created_at < COALESCE(
            (
                SELECT current_question.created_at
                FROM chat_message_group AS current_question
                WHERE current_question.conversation_id = conversation.id
                  AND current_question.uuid = sqlc.arg(question_id)::uuid
            ),
            statement_timestamp()
        )
        AND (
            historical_item.item_type IN ('attachment_message', 'canvas_message')
            OR (
                historical_item.item_type = 'context_message'
                AND NOT EXISTS (
                    SELECT 1
                    FROM chat_messages_context AS historical_context
                    WHERE historical_context.id = historical_item.id
                      AND historical_context.context_type = 'support_assistant_context'
                      AND jsonb_typeof(historical_context.context_data) = 'object'
                      AND historical_context.context_data ->> 'user_id'
                          = sqlc.arg(actor_user_id)::bigint::text
                      AND historical_context.context_data ->> 'project_id'
                          = sqlc.arg(project_id)::integer::text
                      AND historical_context.context_data - 'user_id' - 'project_id' = '{}'::jsonb
                )
            )
        )
  )
ORDER BY target_participant.id
LIMIT 1;

-- name: ResolveCurrentRegeneration :one
SELECT conversation.uuid AS conversation_uuid,
       question.uuid AS question_id,
       response.author_participant_id AS target_participant_id,
       CASE response_author.entity_name
           WHEN 'application' THEN 'application'
           WHEN 'dummy' THEN 'adhoc'
       END::text AS regeneration_kind,
       question_text.content::text AS user_input
FROM chat_message_group AS response
JOIN chat_conversations AS conversation
  ON conversation.id = response.conversation_id
JOIN chat_message_group AS question
  ON question.id = response.reply_to_id
 AND question.conversation_id = conversation.id
JOIN chat_participants AS question_author
  ON question_author.id = question.author_participant_id
 AND question_author.entity_name = 'user'
JOIN chat_participants AS response_author
  ON response_author.id = response.author_participant_id
 AND response_author.entity_name IN ('application', 'dummy')
JOIN chat_participant_mapping AS actor_mapping
  ON actor_mapping.conversation_id = conversation.id
JOIN chat_participants AS actor_participant
  ON actor_participant.id = actor_mapping.participant_id
 AND actor_participant.entity_name = 'user'
 AND (actor_participant.entity_meta ->> 'id')::bigint = sqlc.arg(actor_user_id)::bigint
JOIN LATERAL (
    SELECT text_item.content
    FROM chat_message_items AS item
    JOIN chat_messages_text AS text_item ON text_item.id = item.id
    WHERE item.message_group_id = question.id
      AND item.item_type = 'text_message'
    ORDER BY item.order_index DESC, item.id DESC
    LIMIT 1
) AS question_text ON TRUE
WHERE response.uuid = sqlc.arg(response_message_id)::uuid
  AND NOT response.is_streaming
  AND (
      conversation.author_id = sqlc.arg(actor_user_id)::bigint
      OR (question_author.entity_meta ->> 'id')::bigint = sqlc.arg(actor_user_id)::bigint
  )
  AND (
      response_author.entity_name = 'dummy'
      OR (
          response_author.entity_name = 'application'
          AND (response_author.entity_meta ->> 'project_id')::integer = sqlc.arg(project_id)::integer
      )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM chat_message_items AS unsupported_question_item
      WHERE unsupported_question_item.message_group_id = question.id
        AND unsupported_question_item.item_type <> 'text_message'
  )
  AND NOT EXISTS (
      SELECT 1
      FROM chat_message_items AS unsupported_response_item
      WHERE unsupported_response_item.message_group_id = response.id
        AND unsupported_response_item.item_type <> 'text_message'
  );

-- name: LockCurrentAgentConversation :one
SELECT id
FROM chat_conversations
WHERE uuid = sqlc.arg(conversation_uuid)::uuid
FOR UPDATE;

-- name: ResetCurrentAgentResponse :one
WITH resolved AS MATERIALIZED (
    SELECT response.id, response.uuid
    FROM chat_message_group AS response
    JOIN chat_conversations AS conversation
      ON conversation.id = response.conversation_id
    JOIN chat_message_group AS question
      ON question.id = response.reply_to_id
     AND question.conversation_id = conversation.id
    JOIN chat_participants AS question_author
      ON question_author.id = question.author_participant_id
     AND question_author.entity_name = 'user'
    JOIN chat_participants AS response_author
      ON response_author.id = response.author_participant_id
     AND response_author.id = sqlc.arg(target_participant_id)::integer
    LEFT JOIN chat_participant_mapping AS application_mapping
      ON application_mapping.conversation_id = conversation.id
     AND application_mapping.participant_id = response_author.id
    LEFT JOIN application_versions AS application_version
      ON application_version.id = sqlc.arg(application_version_id)::integer
     AND application_version.id = (application_mapping.entity_settings ->> 'version_id')::integer
     AND application_version.application_id = sqlc.arg(application_id)::integer
     AND application_version.application_id = (response_author.entity_meta ->> 'id')::integer
    WHERE conversation.uuid = sqlc.arg(conversation_uuid)::uuid
      AND response.uuid = sqlc.arg(response_message_id)::uuid
      AND question.uuid = sqlc.arg(question_id)::uuid
      AND NOT response.is_streaming
      AND (
          conversation.author_id = sqlc.arg(actor_user_id)::bigint
          OR (question_author.entity_meta ->> 'id')::bigint = sqlc.arg(actor_user_id)::bigint
      )
      AND (
          (
              sqlc.arg(regeneration_kind)::text = 'adhoc'
              AND response_author.entity_name = 'dummy'
              AND sqlc.arg(application_id)::integer = 0
              AND sqlc.arg(application_version_id)::integer = 0
          )
          OR (
              sqlc.arg(regeneration_kind)::text = 'application'
              AND response_author.entity_name = 'application'
              AND (response_author.entity_meta ->> 'project_id')::integer = sqlc.arg(project_id)::integer
              AND application_version.id IS NOT NULL
              AND application_version.agent_type <> 'pipeline'
          )
      )
      AND NOT EXISTS (
          SELECT 1
          FROM chat_message_items AS unsupported_question_item
          WHERE unsupported_question_item.message_group_id = question.id
            AND unsupported_question_item.item_type <> 'text_message'
      )
      AND NOT EXISTS (
          SELECT 1
          FROM chat_message_items AS unsupported_response_item
          WHERE unsupported_response_item.message_group_id = response.id
            AND unsupported_response_item.item_type <> 'text_message'
      )
    FOR UPDATE OF response
), removed_trace AS (
    DELETE FROM chat_message_trace_step AS trace
    USING resolved
    WHERE trace.message_group_id = resolved.id
    RETURNING trace.id
), removed_items AS (
    DELETE FROM chat_message_items AS item
    USING resolved
    WHERE item.message_group_id = resolved.id
    RETURNING item.id
), updated AS (
    UPDATE chat_message_group AS response
    SET meta = (
            response.meta
            - 'resolved_hitl_interrupt_ids'
            - 'hitl_interrupts'
            - 'hitl_interrupt'
            - 'invoked_skills'
        ) || jsonb_build_object(
            'execution_generation', sqlc.arg(execution_generation)::text
        ),
        is_streaming = TRUE,
        task_id = sqlc.arg(execution_id)::text,
        updated_at = clock_timestamp()
    FROM resolved
    WHERE response.id = resolved.id
      AND (SELECT count(*) FROM removed_trace) >= 0
      AND (SELECT count(*) FROM removed_items) >= 0
    RETURNING response.id, response.uuid
)
SELECT updated.id AS response_message_group_id,
       updated.uuid AS response_message_id
FROM updated;

-- name: InsertCurrentApplicationTurn :one
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
      AND jsonb_typeof(COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)) = 'array'
      AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
              CASE
                  WHEN jsonb_typeof(COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)) = 'array'
                  THEN COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)
                  ELSE '[]'::jsonb
              END
          ) AS internal_tool(value)
          WHERE jsonb_typeof(internal_tool.value) <> 'string'
             OR internal_tool.value #>> '{}' <> 'internal_mcp'
      )
      AND COALESCE(application_version.meta::jsonb -> 'internal_tools', '[]'::jsonb) = '[]'::jsonb
      AND COALESCE(
          conversation.meta #>> '{context_analytics,last_summarization,summary_content}',
          ''
      ) = ''
      AND NOT EXISTS (
          SELECT 1
          FROM chat_message_group AS pending_response
          WHERE pending_response.conversation_id = conversation.id
            AND pending_response.is_streaming
      )
      AND NOT EXISTS (
          SELECT 1
          FROM chat_message_group AS historical_group
          JOIN chat_message_items AS historical_item
            ON historical_item.message_group_id = historical_group.id
          WHERE historical_group.conversation_id = conversation.id
            AND (
                historical_item.item_type IN ('attachment_message', 'canvas_message')
                OR (
                    historical_item.item_type = 'context_message'
                    AND NOT EXISTS (
                        SELECT 1
                        FROM chat_messages_context AS historical_context
                        WHERE historical_context.id = historical_item.id
                          AND historical_context.context_type = 'support_assistant_context'
                          AND jsonb_typeof(historical_context.context_data) = 'object'
                          AND historical_context.context_data ->> 'user_id'
                              = sqlc.arg(actor_user_id)::bigint::text
                          AND historical_context.context_data ->> 'project_id'
                              = sqlc.arg(project_id)::integer::text
                          AND historical_context.context_data - 'user_id' - 'project_id' = '{}'::jsonb
                    )
                )
            )
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

-- name: InsertCurrentAdhocTurn :one
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
     AND target_participant.entity_name = 'dummy'
    WHERE conversation.uuid = sqlc.arg(conversation_uuid)::uuid
      AND jsonb_typeof(COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)) = 'array'
      AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
              CASE
                  WHEN jsonb_typeof(COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)) = 'array'
                  THEN COALESCE(conversation.meta -> 'internal_tools', '[]'::jsonb)
                  ELSE '[]'::jsonb
              END
          ) AS internal_tool(value)
          WHERE jsonb_typeof(internal_tool.value) <> 'string'
             OR internal_tool.value #>> '{}' <> 'internal_mcp'
      )
      AND COALESCE(
          conversation.meta #>> '{context_analytics,last_summarization,summary_content}',
          ''
      ) = ''
      AND NOT EXISTS (
          SELECT 1
          FROM configuration AS project_context
          WHERE project_context.type = 'project_context'
            AND project_context.data ->> 'enabled' = 'true'
            AND COALESCE(project_context.data ->> 'content', '') <> ''
      )
      AND NOT EXISTS (
          SELECT 1
          FROM chat_participant_mapping AS unsupported_mapping
          JOIN chat_participants AS unsupported_participant
            ON unsupported_participant.id = unsupported_mapping.participant_id
          WHERE unsupported_mapping.conversation_id = conversation.id
            AND unsupported_participant.entity_name NOT IN ('user', 'dummy', 'toolkit')
      )
      AND NOT EXISTS (
          SELECT 1
          FROM chat_participant_mapping AS invalid_toolkit_mapping
          JOIN chat_participants AS invalid_toolkit_participant
            ON invalid_toolkit_participant.id = invalid_toolkit_mapping.participant_id
           AND invalid_toolkit_participant.entity_name = 'toolkit'
          LEFT JOIN elitea_tools AS invalid_toolkit
            ON invalid_toolkit.id::text = invalid_toolkit_participant.entity_meta ->> 'id'
          WHERE invalid_toolkit_mapping.conversation_id = conversation.id
            AND (
                invalid_toolkit_participant.entity_meta ->> 'project_id'
                    IS DISTINCT FROM (sqlc.arg(project_id)::integer)::text
                OR invalid_toolkit.id IS NULL
                OR invalid_toolkit.type IN ('application', 'mcp')
                OR invalid_toolkit.meta ->> 'mcp' = 'true'
            )
      )
      AND NOT EXISTS (
          SELECT 1
          FROM chat_message_group AS pending_response
          WHERE pending_response.conversation_id = conversation.id
            AND pending_response.is_streaming
      )
      AND NOT EXISTS (
          SELECT 1
          FROM chat_message_group AS historical_group
          JOIN chat_message_items AS historical_item
            ON historical_item.message_group_id = historical_group.id
          WHERE historical_group.conversation_id = conversation.id
            AND (
                historical_item.item_type IN ('attachment_message', 'canvas_message')
                OR (
                    historical_item.item_type = 'context_message'
                    AND NOT EXISTS (
                        SELECT 1
                        FROM chat_messages_context AS historical_context
                        WHERE historical_context.id = historical_item.id
                          AND historical_context.context_type = 'support_assistant_context'
                          AND jsonb_typeof(historical_context.context_data) = 'object'
                          AND historical_context.context_data ->> 'user_id'
                              = sqlc.arg(actor_user_id)::bigint::text
                          AND historical_context.context_data ->> 'project_id'
                              = sqlc.arg(project_id)::integer::text
                          AND historical_context.context_data - 'user_id' - 'project_id' = '{}'::jsonb
                    )
                )
            )
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
