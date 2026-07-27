/**
 * Payload-shape catalogue + `events.ts` / `messages.ts` renderers for
 * scripts/gen-socket-contract.mjs (unit S5, spec §5.5).
 *
 * WHY a hand-authored catalogue: Go source and the old app's untyped JS
 * carry no machine-derivable payload TYPE information (server.go's handlers
 * read a raw `map[string]any`; the old client destructures socket messages
 * with plain JS optional-chaining). The spec's own §5.1 preamble makes the
 * same point about REST payloads ("no OpenAPI spec will ever describe
 * these" — §5.5). This module is the domain-knowledge input, exactly the
 * role EXCLUSIONS/SYMMETRY_FILLS/ADDITIONS play in gen-brand-tokens.mjs and
 * the OpenAPI spec plays for check-contract-coverage.mjs: hand-authored,
 * evidence-cited, and mechanically CHECKED for completeness against the
 * parsed source (diffCatalogueCompleteness in socket-contract-core.mjs) —
 * so drift in constants.js is a hard generation failure, never a silent
 * placeholder.
 *
 * Every shape below is deliberately PERMISSIVE (`z.looseObject` /
 * `z.record(z.string(), z.unknown())`) wherever the real evidence shows the
 * old app itself accessing the field defensively (`response_metadata?.x`).
 * A fabricated strict shape would be less accurate than an honest loose
 * one — see components/Chat/hooks.js:509-1460 for the scale of variation
 * `response_metadata` carries across discriminants.
 */

// ---------------------------------------------------------------------------
// Shared schema building blocks (emitted once into events.ts / messages.ts).
// Each constant name here is referenced BY NAME from the catalogues below —
// keep names in sync.
// ---------------------------------------------------------------------------
const SHARED_SCHEMAS_TS = `
/**
 * Free-form metadata blob attached to most streamed agent/tool messages
 * (\`response_metadata\`). Evidence across dozens of call sites
 * (components/Chat/hooks.js:509-1460) shows wildly different nested keys
 * per discriminant (tool_run_id, metadata{}, tool_name, toolkit_name,
 * thread_id, model_name, node_name, hitl_interrupts[], resource_metadata{},
 * authorization_servers[], server_url, tool_meta{}, ...); every real
 * consumer reads it defensively via optional chaining, so a permissive
 * record — not a fabricated strict shape — is the accurate reproduction of
 * the actual contract.
 */
const responseMetadataSchema = z.record(z.string(), z.unknown());

/**
 * Shared envelope for streamed predict responses (chat_predict /
 * application_predict / chat_predict_attachment, receive direction).
 * Evidence: components/Chat/hooks.js:367-373 (destructures message_id,
 * type, response_metadata, sio_event, question_id from every message).
 * \`done\`/\`type\`+\`content\`-only is what the CURRENT Go stub emits
 * (server.go:163-181); the richer envelope fields are what the old React
 * client actually consumes — see the S5 final report for the gap this
 * documents between the Go stub and the pre-existing (Python) backend
 * contract the client was built against.
 */
const streamEnvelopeSchema = z.looseObject({
  message_id: z.string().optional(),
  sio_event: z.string().optional(),
  question_id: z.string().optional(),
  type: z.string(),
  content: z.unknown().optional(),
  response_metadata: responseMetadataSchema.optional(),
  created_at: z.union([z.string(), z.number()]).optional(),
  done: z.boolean().optional(),
  threadId: z.string().optional(),
});

/**
 * Client -> server "start/continue a run" emit payload. Loose: the old app
 * builds this from a free-form \`eventPayload\` object
 * ([fsd]/features/chat/ui/chat-box/ChatBox.jsx:929) merged with a
 * \`conversation_uuid\`; server.go's stub handler instead reads
 * \`conversation_id\` (see the S5 final report — a pre-existing Go-stub /
 * old-client field-name mismatch, out of scope for this unit).
 */
const predictEmitSchema = z.looseObject({
  conversation_uuid: z.string().optional(),
  conversation_id: z.union([z.string(), z.number()]).optional(),
  project_id: z.string().optional(),
  version_id: z.union([z.string(), z.number()]).optional(),
  participant_id: z.union([z.string(), z.number()]).optional(),
  content: z.unknown().optional(),
  input: z.unknown().optional(),
});

/**
 * Room enter/leave emit payload. server.go's handleEnterRoom reads
 * \`room_id\`, falling back to \`conversation_id\`
 * (services/elitea-main/internal/api/socketio/server.go:118-121);
 * handleLeaveRooms ignores its payload entirely — rooms are tracked
 * server-side by socket id (server.go:130-136) — so this stays permissive.
 */
const roomLifecycleEmitSchema = z.looseObject({
  conversation_id: z.union([z.string(), z.number()]).optional(),
  conversation_uuid: z.string().optional(),
  project_id: z.string().optional(),
  room_id: z.string().optional(),
});

/**
 * chat_leave_rooms has been observed emitted with an ARRAY of stream ids
 * (components/Chat/hooks.js:73, \`emitLeaveRoom([streamId])\`) as well as
 * the object shape above and no payload at all — the server ignores the
 * payload regardless, so all three are accepted.
 */
const leaveRoomsEmitSchema = z.union([
  roomLifecycleEmitSchema,
  z.array(z.union([z.string(), z.number()])),
  z.undefined(),
]);

// -- Canvas (hooks/chat/useCanvasSocket.js) --------------------------------
const canvasJoinEmitSchema = z.looseObject({
  project_id: z.string().optional(),
  canvas_uuid: z.string().optional(),
});
const canvasLeaveEmitSchema = z.looseObject({
  canvas_uuid: z.string().optional(),
  project_id: z.string().optional(),
  canvas_content: z.unknown().optional(),
  code_language: z.string().optional(),
});
const canvasEditEmitSchema = z.looseObject({
  project_id: z.string().optional(),
  canvas_uuid: z.string().optional(),
  content: z.unknown().optional(),
});
const canvasSyncReceiveSchema = z.looseObject({ content: z.unknown().optional() });
const canvasErrorReceiveSchema = z.unknown();
const canvasDetailReceiveSchema = z.looseObject({ content: z.unknown().optional() });
/** Mirrors server.go:237-239's own emit shape exactly (the one canvas event the server both triggers and the client fully specifies). */
const canvasEditorJoinedReceiveSchema = z.looseObject({ user_id: z.unknown().optional() });
const canvasEditorsChangeReceiveSchema = z.unknown();
/** server.go:252 broadcasts the raw edit payload verbatim (\`data\`) — arbitrary shape. */
const canvasContentChangeReceiveSchema = z.record(z.string(), z.unknown());

// -- Notifications ----------------------------------------------------------
/** widgets/sidebar-root/ui/button/NotificationButton.jsx:39-43 never reads the payload — it only flips a boolean on receipt. */
const notificationsNotifyReceiveSchema = z.unknown();

// -- MCP ----------------------------------------------------------------------
const mcpStatusReceiveSchema = z.looseObject({
  project_id: z.union([z.string(), z.number()]).optional(),
  connected: z.boolean().optional(),
  type: z.string().optional(),
});
const testMcpConnectionEmitSchema = z.looseObject({
  stream_id: z.string().optional(),
  message_id: z.string().optional(),
  project_id: z.union([z.string(), z.number()]).optional(),
  toolkit_config: z
    .looseObject({
      toolkit_id: z.union([z.string(), z.number()]).optional(),
      toolkit_name: z.string().optional(),
      type: z.string().optional(),
      settings: z.unknown().optional(),
    })
    .optional(),
  mcp_tokens: z.record(z.string(), z.unknown()).optional(),
});
const testMcpConnectionReceiveSchema = streamEnvelopeSchema;

// -- Chat message/participant lifecycle (receive-only) -----------------------
const chatMessageSyncReceiveSchema = z.record(z.string(), z.unknown());
const chatMessageDeleteReceiveSchema = z.looseObject({ message_group_uid: z.string().optional() });
const chatMessageDeleteAllReceiveSchema = z.looseObject({
  conversation_id: z.union([z.string(), z.number()]).optional(),
});
const chatParticipantDeleteReceiveSchema = z.looseObject({
  conversation_id: z.union([z.string(), z.number()]).optional(),
  participant_id: z.union([z.string(), z.number()]).optional(),
});
const chatParticipantUpdateReceiveSchema = z.record(z.string(), z.unknown());
const chatConversationNameUpdatedReceiveSchema = z.looseObject({
  conversation_id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
});
const socketValidationErrorReceiveSchema = z.looseObject({
  message_id: z.string().optional(),
  type: z.string().optional(),
  content: z.unknown().optional(),
});

// -- ASR (features/chat/lib/hooks/useStreamingSpeechRecognition.hooks.js) ---
const asrStartEmitSchema = z.looseObject({
  project_id: z.string().optional(),
  model_name: z.string().optional(),
  model_project_id: z.union([z.string(), z.number()]).optional(),
  language: z.string().optional(),
});
/** \`audio\` is a PCM16 ArrayBuffer (useStreamingSpeechRecognition.hooks.js:201) — not zod-structurally representable, validated as present. */
const asrAudioChunkEmitSchema = z.looseObject({ audio: z.unknown() });
const asrStopEmitSchema = z.looseObject({});
const asrTranscriptDeltaReceiveSchema = z.looseObject({ delta: z.string().optional() });
const asrTranscriptDoneReceiveSchema = z.looseObject({ transcript: z.string().optional() });
const asrErrorReceiveSchema = z.looseObject({ error: z.string().optional() });
const asrSpeechStartedReceiveSchema = z.looseObject({});
const asrVadFlushReceiveSchema = z.looseObject({});

// -- TTS (features/chat/lib/hooks/useTextToSpeech.hooks.js) ------------------
const ttsStartEmitSchema = z.looseObject({
  project_id: z.union([z.string(), z.number()]).optional(),
  model_name: z.string().optional(),
  model_project_id: z.union([z.string(), z.number()]).optional(),
  text: z.string().optional(),
  voice: z.string().optional(),
  speed: z.number().optional(),
});
const ttsStopEmitSchema = z.looseObject({});
/** Declared in constants.js:932 but grep-verified UNUSED anywhere else in the old app — dead constant, not merely an unimplemented backend feature. */
const ttsNextUnusedSchema = z.unknown();
const ttsAudioChunkReceiveSchema = z.looseObject({ audio: z.unknown(), sample_rate: z.number().optional() });
const ttsDoneReceiveSchema = z.looseObject({ char_end: z.number().optional() });
const ttsErrorReceiveSchema = z.looseObject({ error: z.string().optional() });
`;

/**
 * @typedef {{
 *   name: string,
 *   direction: 'emit' | 'receive' | 'bidirectional',
 *   emitSchema: string | null,
 *   receiveSchema: string | null,
 *   evidence: string[],
 *   note?: string,
 * }} EventCatalogueEntry
 */

/** @type {EventCatalogueEntry[]} In apps/elitea-ui/src/common/constants.js:881-936 declaration order. */
export const EVENT_CATALOGUE = [
  { name: 'socket_validation_error', direction: 'receive', emitSchema: null, receiveSchema: 'socketValidationErrorReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:882', 'apps/elitea-ui/src/components/Chat/hooks.js:1527'] },
  { name: 'chat_predict', direction: 'bidirectional', emitSchema: 'predictEmitSchema', receiveSchema: 'streamEnvelopeSchema', evidence: ['apps/elitea-ui/src/common/constants.js:883', 'apps/elitea-ui/src/components/Chat/hooks.js:239,496', "apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/ChatBox.jsx:929"] },
  { name: 'chat_continue_predict', direction: 'emit', emitSchema: 'predictEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:884', "apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/ChatBox.jsx:174"] },
  { name: 'application_continue_message', direction: 'emit', emitSchema: 'predictEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:885'], note: 'Declared, grep-verified UNUSED anywhere else in the old app (no emit/listener call site). Typed by analogy to chat_continue_predict.' },
  { name: 'chat_enter_room', direction: 'emit', emitSchema: 'roomLifecycleEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:886', "apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/useApplicationChat.hooks.js:114", "apps/elitea-ui/src/[fsd]/features/pipelines/lib/hooks/usePipelineChat.hooks.js:95,156", "apps/elitea-ui/src/[fsd]/features/toolkits/lib/hooks/useToolkitChat.hooks.js:208,218-224"] },
  { name: 'chat_leave_rooms', direction: 'emit', emitSchema: 'leaveRoomsEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:887', 'apps/elitea-ui/src/components/Chat/hooks.js:73,240,1529', "apps/elitea-ui/src/[fsd]/features/pipelines/lib/hooks/usePipelineChat.hooks.js:96", "apps/elitea-ui/src/[fsd]/features/toolkits/lib/hooks/useToolkitChat.hooks.js:209"] },
  { name: 'chat_participant_delete', direction: 'receive', emitSchema: null, receiveSchema: 'chatParticipantDeleteReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:888', 'apps/elitea-ui/src/components/Chat/hooks.js:1584-1596'] },
  { name: 'chat_message_delete', direction: 'receive', emitSchema: null, receiveSchema: 'chatMessageDeleteReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:889', 'apps/elitea-ui/src/components/Chat/hooks.js:1554-1566'] },
  { name: 'chat_message_delete_all', direction: 'receive', emitSchema: null, receiveSchema: 'chatMessageDeleteAllReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:890', 'apps/elitea-ui/src/components/Chat/hooks.js:1569-1581'] },
  { name: 'chat_message_sync', direction: 'receive', emitSchema: null, receiveSchema: 'chatMessageSyncReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:891', 'apps/elitea-ui/src/components/Chat/hooks.js:1540-1551'] },
  { name: 'chat_participant_update', direction: 'receive', emitSchema: null, receiveSchema: 'chatParticipantUpdateReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:892', 'apps/elitea-ui/src/components/Chat/hooks.js:1599-1610'] },
  { name: 'chat_conversation_name_updated', direction: 'receive', emitSchema: null, receiveSchema: 'chatConversationNameUpdatedReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:893', 'apps/elitea-ui/src/components/Chat/hooks.js:1613-1624'] },
  { name: 'application_predict', direction: 'bidirectional', emitSchema: 'predictEmitSchema', receiveSchema: 'streamEnvelopeSchema', evidence: ['apps/elitea-ui/src/common/constants.js:894', "apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/useApplicationChat.hooks.js:114-115", "apps/elitea-ui/src/[fsd]/features/pipelines/lib/hooks/usePipelineChat.hooks.js:95-96", "apps/elitea-ui/src/[fsd]/features/toolkits/lib/hooks/useToolkitChat.hooks.js:207-209"] },
  { name: 'application_leave_rooms', direction: 'emit', emitSchema: 'leaveRoomsEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:895'] },
  { name: 'promptlib_predict', direction: 'emit', emitSchema: 'predictEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:896'], note: 'Declared, grep-verified UNUSED anywhere else in the old app. server.go registers a listener that routes to handleApplicationPredict, which emits its response back under the LITERAL "application_predict" name, not "promptlib_predict" — so even server-side this event is effectively emit-only. Typed by analogy to application_predict/chat_predict.' },
  { name: 'promptlib_leave_rooms', direction: 'emit', emitSchema: 'leaveRoomsEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:897'], note: 'Declared, grep-verified UNUSED anywhere else in the old app.' },
  { name: 'notifications_notify', direction: 'receive', emitSchema: null, receiveSchema: 'notificationsNotifyReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:898', "apps/elitea-ui/src/[fsd]/widgets/sidebar-root/ui/button/NotificationButton.jsx:43"] },
  { name: 'chat_canvas_join', direction: 'emit', emitSchema: 'canvasJoinEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:901', 'apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:7-23'] },
  { name: 'chat_canvas_leave_rooms', direction: 'emit', emitSchema: 'canvasLeaveEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:902', 'apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:25-35'] },
  { name: 'chat_canvas_edit', direction: 'emit', emitSchema: 'canvasEditEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:903', 'apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:37-49'] },
  { name: 'chat_canvas_sync', direction: 'receive', emitSchema: null, receiveSchema: 'canvasSyncReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:905', 'apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:51-76'] },
  { name: 'chat_canvas_error', direction: 'receive', emitSchema: null, receiveSchema: 'canvasErrorReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:906', 'apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:78-101'] },
  { name: 'chat_canvas_detail', direction: 'receive', emitSchema: null, receiveSchema: 'canvasDetailReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:907', 'apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:103-128'] },
  { name: 'chat_canvas_editor_joined', direction: 'receive', emitSchema: null, receiveSchema: 'canvasEditorJoinedReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:908', 'apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:130-154', 'services/elitea-main/internal/api/socketio/server.go:237-239'], note: 'The Go server both triggers chat_canvas_join AND emits this back — see the S5 report for the emitter/listener asymmetry this documents.' },
  { name: 'chat_canvas_editors_change', direction: 'receive', emitSchema: null, receiveSchema: 'canvasEditorsChangeReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:909', 'apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:156-180'] },
  { name: 'chat_canvas_content_change', direction: 'receive', emitSchema: null, receiveSchema: 'canvasContentChangeReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:910', 'apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:182-206', 'services/elitea-main/internal/api/socketio/server.go:252'], note: 'The Go server emits this back to the room when chat_canvas_edit is received — same asymmetry class as chat_canvas_editor_joined.' },
  { name: 'chat_predict_attachment', direction: 'receive', emitSchema: null, receiveSchema: 'streamEnvelopeSchema', evidence: ['apps/elitea-ui/src/common/constants.js:911', 'apps/elitea-ui/src/components/Chat/hooks.js:1478'] },
  { name: 'mcp_status', direction: 'receive', emitSchema: null, receiveSchema: 'mcpStatusReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:914', 'apps/elitea-ui/src/hooks/chat/useMCPParticipantStatusMonitor.js:24', 'apps/elitea-ui/src/hooks/application/useAgentMCPToolsStatusMonitor.js:73', "apps/elitea-ui/src/[fsd]/features/toolkits/lib/hooks/useGetCurrentToolkitSchemas.hooks.js:40"] },
  { name: 'test_mcp_connection', direction: 'bidirectional', emitSchema: 'testMcpConnectionEmitSchema', receiveSchema: 'testMcpConnectionReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:917', "apps/elitea-ui/src/[fsd]/features/mcp/lib/hooks/useMcpAuthCheck.hooks.js:84-133", 'services/elitea-main/internal/api/socketio/server.go:105-107,255-280'] },
  { name: 'asr_start', direction: 'emit', emitSchema: 'asrStartEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:920', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useStreamingSpeechRecognition.hooks.js:215-220"] },
  { name: 'asr_audio_chunk', direction: 'emit', emitSchema: 'asrAudioChunkEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:921', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useStreamingSpeechRecognition.hooks.js:200-203"] },
  { name: 'asr_stop', direction: 'emit', emitSchema: 'asrStopEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:922', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useStreamingSpeechRecognition.hooks.js:251,261"] },
  { name: 'asr_transcript_delta', direction: 'receive', emitSchema: null, receiveSchema: 'asrTranscriptDeltaReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:923', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useStreamingSpeechRecognition.hooks.js:113-116,140"] },
  { name: 'asr_transcript_done', direction: 'receive', emitSchema: null, receiveSchema: 'asrTranscriptDoneReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:924', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useStreamingSpeechRecognition.hooks.js:118-124,141"] },
  { name: 'asr_error', direction: 'receive', emitSchema: null, receiveSchema: 'asrErrorReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:925', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useStreamingSpeechRecognition.hooks.js:136-138,144"] },
  { name: 'asr_speech_started', direction: 'receive', emitSchema: null, receiveSchema: 'asrSpeechStartedReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:926', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useStreamingSpeechRecognition.hooks.js:126-129,142"] },
  { name: 'asr_vad_flush', direction: 'receive', emitSchema: null, receiveSchema: 'asrVadFlushReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:927', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useStreamingSpeechRecognition.hooks.js:131-134,143"] },
  { name: 'tts_start', direction: 'emit', emitSchema: 'ttsStartEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:930', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useTextToSpeech.hooks.js:465-472"] },
  { name: 'tts_stop', direction: 'emit', emitSchema: 'ttsStopEmitSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:931', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useTextToSpeech.hooks.js:446,525"] },
  { name: 'tts_next', direction: 'emit', emitSchema: 'ttsNextUnusedSchema', receiveSchema: null, evidence: ['apps/elitea-ui/src/common/constants.js:932'], note: 'Declared, grep-verified UNUSED anywhere else in the old app — only mentioned in a code COMMENT (useTextToSpeech.hooks.js:608). Dead constant.' },
  { name: 'tts_audio_chunk', direction: 'receive', emitSchema: null, receiveSchema: 'ttsAudioChunkReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:933', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useTextToSpeech.hooks.js:562-586,635"] },
  { name: 'tts_done', direction: 'receive', emitSchema: null, receiveSchema: 'ttsDoneReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:934', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useTextToSpeech.hooks.js:588-626,636"] },
  { name: 'tts_error', direction: 'receive', emitSchema: null, receiveSchema: 'ttsErrorReceiveSchema', evidence: ['apps/elitea-ui/src/common/constants.js:935', "apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useTextToSpeech.hooks.js:628-633,637"] },
];

/**
 * @typedef {{ key: string, value: string, evidence: string[], shape: string, note?: string }} DiscriminantCatalogueEntry
 */

/** @type {DiscriminantCatalogueEntry[]} In apps/elitea-ui/src/common/constants.js:157-193 declaration order. */
export const DISCRIMINANT_CATALOGUE = [
  { key: 'AgentStart', value: 'agent_start', evidence: ['apps/elitea-ui/src/common/constants.js:158', 'apps/elitea-ui/src/components/Chat/hooks.js:1286-1305'], shape: 'base' },
  { key: 'AgentResponse', value: 'agent_response', evidence: ['apps/elitea-ui/src/common/constants.js:159', 'apps/elitea-ui/src/components/Chat/hooks.js:492-507'], shape: 'base' },
  { key: 'AgentException', value: 'agent_exception', evidence: ['apps/elitea-ui/src/common/constants.js:160', 'apps/elitea-ui/src/components/Chat/hooks.js:1231-1266'], shape: 'base' },
  { key: 'AgentToolStart', value: 'agent_tool_start', evidence: ['apps/elitea-ui/src/common/constants.js:161', 'apps/elitea-ui/src/components/Chat/hooks.js:669-803'], shape: 'base' },
  { key: 'AgentToolEnd', value: 'agent_tool_end', evidence: ['apps/elitea-ui/src/common/constants.js:162', 'apps/elitea-ui/src/components/Chat/hooks.js:856-895'], shape: 'base' },
  { key: 'AgentToolError', value: 'agent_tool_error', evidence: ['apps/elitea-ui/src/common/constants.js:163', 'apps/elitea-ui/src/components/Chat/hooks.js:896-908'], shape: 'base' },
  { key: 'AgentRequiresConfirmation', value: 'agent_requires_confirmation', evidence: ['apps/elitea-ui/src/common/constants.js:164', 'apps/elitea-ui/src/components/Chat/hooks.js:1011-1035'], shape: 'base' },
  { key: 'AgentHitlInterrupt', value: 'agent_hitl_interrupt', evidence: ['apps/elitea-ui/src/common/constants.js:165', 'apps/elitea-ui/src/components/Chat/hooks.js:1036-1212'], shape: 'base' },
  { key: 'McpAuthorizationRequired', value: 'mcp_authorization_required', evidence: ['apps/elitea-ui/src/common/constants.js:166', 'apps/elitea-ui/src/components/Chat/hooks.js:909-1010', "apps/elitea-ui/src/[fsd]/features/mcp/lib/hooks/useMcpAuthCheck.hooks.js:59-63"], shape: 'mcpAuth' },
  { key: 'AgentLlmStart', value: 'agent_llm_start', evidence: ['apps/elitea-ui/src/common/constants.js:167', 'apps/elitea-ui/src/components/Chat/hooks.js:509,669-803'], shape: 'base' },
  { key: 'AgentLlmChunk', value: 'agent_llm_chunk', evidence: ['apps/elitea-ui/src/common/constants.js:168', 'apps/elitea-ui/src/components/Chat/hooks.js:509-600'], shape: 'llmChunk' },
  { key: 'AgentLlmEnd', value: 'agent_llm_end', evidence: ['apps/elitea-ui/src/common/constants.js:169', 'apps/elitea-ui/src/components/Chat/hooks.js:601-668'], shape: 'base' },
  { key: 'AgentOnFunctionToolNode', value: 'agent_on_function_tool_node', evidence: ['apps/elitea-ui/src/common/constants.js:170', 'apps/elitea-ui/src/components/Chat/hooks.js:1370-1377'], shape: 'base' },
  { key: 'AgentOnToolNode', value: 'agent_on_tool_node', evidence: ['apps/elitea-ui/src/common/constants.js:171', 'apps/elitea-ui/src/components/Chat/hooks.js:1370-1377'], shape: 'base' },
  { key: 'AgentOnTransitionalEdge', value: 'agent_on_transitional_edge', evidence: ['apps/elitea-ui/src/common/constants.js:172', 'apps/elitea-ui/src/components/Chat/hooks.js:1370-1377'], shape: 'base' },
  { key: 'AgentOnConditionalEdge', value: 'agent_on_conditional_edge', evidence: ['apps/elitea-ui/src/common/constants.js:173', 'apps/elitea-ui/src/components/Chat/hooks.js:1370-1377'], shape: 'base' },
  { key: 'AgentOnDecisionEdge', value: 'agent_on_decision_edge', evidence: ['apps/elitea-ui/src/common/constants.js:174', 'apps/elitea-ui/src/components/Chat/hooks.js:1370-1377'], shape: 'base' },
  { key: 'References', value: 'references', evidence: ['apps/elitea-ui/src/common/constants.js:175', 'apps/elitea-ui/src/components/Chat/hooks.js:1214-1216'], shape: 'references' },
  { key: 'Chunk', value: 'chunk', evidence: ['apps/elitea-ui/src/common/constants.js:176', 'apps/elitea-ui/src/components/Chat/hooks.js:492-507'], shape: 'base' },
  { key: 'AIMessageChunk', value: 'AIMessageChunk', evidence: ['apps/elitea-ui/src/common/constants.js:177', 'apps/elitea-ui/src/components/Chat/hooks.js:492-507'], shape: 'base' },
  { key: 'ChatUserMessage', value: 'chat_user_message', evidence: ['apps/elitea-ui/src/common/constants.js:178', 'apps/elitea-ui/src/components/Chat/hooks.js:466-490'], shape: 'chatUserMessage' },
  { key: 'StartTask', value: 'start_task', evidence: ['apps/elitea-ui/src/common/constants.js:179', 'apps/elitea-ui/src/components/Chat/hooks.js:385-421'], shape: 'base' },
  { key: 'Freeform', value: 'freeform', evidence: ['apps/elitea-ui/src/common/constants.js:180', 'apps/elitea-ui/src/components/Chat/hooks.js:1284-1285'], shape: 'base' },
  { key: 'Error', value: 'error', evidence: ['apps/elitea-ui/src/common/constants.js:181', 'apps/elitea-ui/src/components/Chat/hooks.js:1217-1230'], shape: 'base' },
  { key: 'LlmError', value: 'llm_error', evidence: ['apps/elitea-ui/src/common/constants.js:182', 'apps/elitea-ui/src/components/Chat/hooks.js:1268-1282'], shape: 'base' },
  { key: 'PipelineFinish', value: 'pipeline_finish', evidence: ['apps/elitea-ui/src/common/constants.js:183', 'apps/elitea-ui/src/components/Chat/hooks.js:1370-1377'], shape: 'base' },
  { key: 'AgentThinkingStep', value: 'agent_thinking_step', evidence: ['apps/elitea-ui/src/common/constants.js:184', 'apps/elitea-ui/src/components/Chat/hooks.js:821-854'], shape: 'base' },
  { key: 'AgentThinkingStepUpdate', value: 'agent_thinking_step_update', evidence: ['apps/elitea-ui/src/common/constants.js:185', 'apps/elitea-ui/src/components/Chat/hooks.js:805-820'], shape: 'base' },
  { key: 'ChatPredictSummaryStarted', value: 'chat_predict_summary_started', evidence: ['apps/elitea-ui/src/common/constants.js:186', 'apps/elitea-ui/src/components/Chat/hooks.js:1378-1431'], shape: 'summaryStarted' },
  { key: 'ChatPredictSummaryFinished', value: 'chat_predict_summary_finished', evidence: ['apps/elitea-ui/src/common/constants.js:187', 'apps/elitea-ui/src/components/Chat/hooks.js:1433-1445'], shape: 'base' },
  { key: 'SwarmChildMessage', value: 'swarm_child_message', evidence: ['apps/elitea-ui/src/common/constants.js:189', 'apps/elitea-ui/src/components/Chat/hooks.js:1306-1368'], shape: 'swarmChild' },
  { key: 'AgentSwarmAgentStart', value: 'agent_swarm_agent_start', evidence: ['apps/elitea-ui/src/common/constants.js:190', 'apps/elitea-ui/src/components/Chat/hooks.js:1447-1452'], shape: 'base' },
  { key: 'AgentSwarmAgentResponse', value: 'agent_swarm_agent_response', evidence: ['apps/elitea-ui/src/common/constants.js:191', 'apps/elitea-ui/src/components/Chat/hooks.js:1447-1452'], shape: 'base' },
  { key: 'AgentSwarmHandoff', value: 'agent_swarm_handoff', evidence: ['apps/elitea-ui/src/common/constants.js:192', 'apps/elitea-ui/src/components/Chat/hooks.js:1447-1452'], shape: 'base' },
];

const DISCRIMINANT_SHAPE_FIELDS = {
  base: '',
  llmChunk: '  thinking: z.string().optional(),\n',
  mcpAuth: '  stream_id: z.string().optional(),\n',
  references: '  references: z.array(z.unknown()).optional(),\n',
  chatUserMessage:
    '  author_participant_id: z.union([z.string(), z.number()]).optional(),\n' +
    '  uuid: z.string().optional(),\n' +
    '  sent_to_id: z.union([z.string(), z.number()]).optional(),\n' +
    '  message_items: z.array(z.unknown()).optional(),\n',
  summaryStarted: '  payload: z.record(z.string(), z.unknown()).optional(),\n',
  swarmChild:
    '  parent_message_id: z.string().optional(),\n' +
    '  agent_name: z.string().optional(),\n',
};

function jsStringArray(values) {
  return `[${values.map((v) => JSON.stringify(v)).join(', ')}]`;
}

function evidenceComment(evidence, note, indent = '  ') {
  const lines = evidence.map((e) => `${indent} *   - ${e}`);
  if (note) lines.push(`${indent} *   NOTE: ${note}`);
  return `${indent}/**\n${indent} * evidence:\n${lines.join('\n')}\n${indent} */\n`;
}

const GENERATED_HEADER = (sourceCmd) => `/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 *
 * Produced by \`node scripts/gen-socket-contract.mjs\` (unit S5, spec §5.5)
 * from:
 *   - apps/elitea-ui/src/common/constants.js (sioEvents / SocketMessageType)
 *   - services/elitea-main/internal/api/socketio/server.go (registered
 *     \`client.On(...)\` handlers — the ONLY source for \`hasServerHandler\`)
 *   - scripts/lib/socket-contract-render.mjs (hand-authored payload-shape
 *     catalogue — see that file's header for why payload TYPES cannot be
 *     mechanically derived from either source)
 *
 * Regenerate with: ${sourceCmd}
 * Re-running with unchanged inputs reproduces this file byte-for-byte.
 */
`;

/**
 * @param {Array<{event:string,hasServerHandler:boolean,serverEmits:boolean}>} crossReferenceRows
 */
export function renderEventsTs(crossReferenceRows) {
  const byEvent = new Map(crossReferenceRows.map((r) => [r.event, r]));
  const header = GENERATED_HEADER('node scripts/gen-socket-contract.mjs');

  const registryEntries = EVENT_CATALOGUE.map((e) => {
    const row = byEvent.get(e.name);
    if (!row) throw new Error(`renderEventsTs: no cross-reference row for event "${e.name}"`);
    return `${evidenceComment(e.evidence, e.note)}  ${e.name}: {
    name: ${JSON.stringify(e.name)},
    direction: ${JSON.stringify(e.direction)},
    hasServerHandler: ${row.hasServerHandler},
    serverEmits: ${row.serverEmits},
    emitSchema: ${e.emitSchema ?? 'null'},
    receiveSchema: ${e.receiveSchema ?? 'null'},
    evidence: ${jsStringArray(e.evidence)},
  },`;
  }).join('\n');

  const eventNamesArray = jsStringArray(EVENT_CATALOGUE.map((e) => e.name));

  return `${header}
import { z } from 'zod';
${SHARED_SCHEMAS_TS}
/** The 43 catalogued socket.io channel event names, in constants.js declaration order (R-A3: only this module and client.ts import socket.io-client-adjacent types). */
export const SOCKET_EVENT_NAMES = ${eventNamesArray} as const;

export type SocketEventName = (typeof SOCKET_EVENT_NAMES)[number];

/** Not exported: only consumed inline via SocketEventContract.direction below — export when a Wave-2 consumer needs to name it directly. */
type SocketEventDirection = 'emit' | 'receive' | 'bidirectional';

export interface SocketEventContract<TEmit = unknown, TReceive = unknown> {
  readonly name: SocketEventName;
  readonly direction: SocketEventDirection;
  /** Whether services/elitea-main's socket.io server registers a \`client.On(...)\` listener for this event today (mechanically derived — see the generator header). */
  readonly hasServerHandler: boolean;
  /** Whether the Go server contains an \`.Emit(...)\` call site for this event name (informational — distinct from hasServerHandler, see chat_canvas_editor_joined / chat_canvas_content_change). */
  readonly serverEmits: boolean;
  readonly emitSchema: z.ZodType<TEmit> | null;
  readonly receiveSchema: z.ZodType<TReceive> | null;
  readonly evidence: readonly string[];
}

/** Keyed registry — the single source of truth every socket/ module reads from. */
export const SOCKET_EVENTS = {
${registryEntries}
} as const satisfies Record<SocketEventName, SocketEventContract>;

type EmittableEventName = {
  [K in SocketEventName]: (typeof SOCKET_EVENTS)[K]['direction'] extends 'emit' | 'bidirectional' ? K : never;
}[SocketEventName];

type ReceivableEventName = {
  [K in SocketEventName]: (typeof SOCKET_EVENTS)[K]['direction'] extends 'receive' | 'bidirectional' ? K : never;
}[SocketEventName];

export type { EmittableEventName, ReceivableEventName };

export type EmitPayloadOf<E extends EmittableEventName> = (typeof SOCKET_EVENTS)[E]['emitSchema'] extends z.ZodType<infer T>
  ? T
  : never;

export type ReceivePayloadOf<E extends ReceivableEventName> = (typeof SOCKET_EVENTS)[E]['receiveSchema'] extends z.ZodType<infer T>
  ? T
  : never;

/** Events with NO registered server handler today (client.On absent) — cross-check against scripts/socket-contract.allowlist.json. */
export const EVENTS_WITHOUT_SERVER_HANDLER: readonly SocketEventName[] = SOCKET_EVENT_NAMES.filter(
  (name) => !SOCKET_EVENTS[name].hasServerHandler,
);
`;
}

/**
 * @param {DiscriminantCatalogueEntry[]} [catalogue]
 */
export function renderMessagesTs(catalogue = DISCRIMINANT_CATALOGUE) {
  const header = GENERATED_HEADER('node scripts/gen-socket-contract.mjs');

  const variantConsts = catalogue.map((d) => {
    const extra = DISCRIMINANT_SHAPE_FIELDS[d.shape] ?? '';
    return `${evidenceComment(d.evidence, d.note, '')}const ${d.key}MessageSchema = z.looseObject({
  type: z.literal(${JSON.stringify(d.value)}),
  message_id: z.string().optional(),
  sio_event: z.string().optional(),
  question_id: z.string().optional(),
  content: z.unknown().optional(),
  response_metadata: responseMetadataSchema.optional(),
  created_at: z.union([z.string(), z.number()]).optional(),
  threadId: z.string().optional(),
${extra}});`;
  }).join('\n\n');

  const unionMembers = catalogue.map((d) => `  ${d.key}MessageSchema,`).join('\n');
  const discriminantValuesArray = jsStringArray(catalogue.map((d) => d.value));

  return `${header}
import { z } from 'zod';

/** Shared \`response_metadata\` shape — see events.ts for the full rationale (permissive by evidence, not by default). */
const responseMetadataSchema = z.record(z.string(), z.unknown());

/** The 34 catalogued SocketMessageType discriminant VALUES, in constants.js declaration order. Narrow with \`(typeof SOCKET_MESSAGE_TYPES)[number]\` if a bare type name is ever needed — no consumer does yet. */
export const SOCKET_MESSAGE_TYPES = ${discriminantValuesArray} as const;

${variantConsts}

/** \`z.discriminatedUnion('type', [...])\` over all 34 variants (spec §5.5). */
export const socketMessageSchema = z.discriminatedUnion('type', [
${unionMembers}
]);

/** Not exported: no consumer needs the bare type name yet — SocketMessageParseResult (below, exported) already carries it structurally. Export when a Wave-2 consumer needs to name it directly. */
type SocketMessage = z.infer<typeof socketMessageSchema>;

export type SocketMessageParseResult =
  | { readonly ok: true; readonly message: SocketMessage }
  | { readonly ok: false; readonly reason: 'unknown_event'; readonly rawType: string | undefined; readonly raw: unknown };

/**
 * Validate a raw socket payload against the 34-discriminant union. Spec
 * §5.5: "unknown discriminants route to a logged \`unknown_event\` branch
 * rather than crashing or silently dropping" — mirrors the old app's own
 * fallback exactly (components/Chat/hooks.js:1453-1460,
 * \`console.warn('unknown message type', socketMessageType)\`). Never throws.
 */
export function parseSocketMessage(raw: unknown): SocketMessageParseResult {
  const parsed = socketMessageSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, message: parsed.data };
  }
  const rawType =
    raw !== null && typeof raw === 'object' && 'type' in raw && typeof (raw as { type: unknown }).type === 'string'
      ? (raw as { type: string }).type
      : undefined;
  // eslint-disable-next-line no-console -- parity: components/Chat/hooks.js:1459's own console.warn fallback
  console.warn('unknown message type', rawType);
  return { ok: false, reason: 'unknown_event', rawType, raw };
}
`;
}
