use std::collections::HashSet;

use prost::Message;
use serde::Deserialize;
use serde_json::value::RawValue;

use super::wire::{Schema, scan_message};
use super::{ProtocolError, elitea::runtime::v1::NodeEventV1};

pub const MAX_CURRENT_NODE_EVENT_JSON_BYTES: usize = 60 * 1024;
pub const MAX_NODE_EVENT_PROTO_BYTES: usize = 64 * 1024;

const MAX_SAFE_STRING_BYTES: usize = 256;
const MAX_JSON_NESTING: usize = 64;
const MAX_EVENT_TYPE_BYTES: usize = 128;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CurrentNodeEventJson<'a> {
    #[serde(rename = "type")]
    event_type: String,
    stream_id: Option<String>,
    message_id: Option<String>,
    question_id: Option<String>,
    #[serde(default, borrow, deserialize_with = "present_raw_value")]
    content: Option<&'a RawValue>,
    thinking: Option<String>,
    #[serde(default, borrow, deserialize_with = "present_raw_value")]
    response_metadata: Option<&'a RawValue>,
    #[serde(default, borrow, deserialize_with = "present_raw_value")]
    references: Option<&'a RawValue>,
    sio_event: Option<String>,
    created_at: Option<String>,
    parent_message_id: Option<String>,
    agent_name: Option<String>,
    execution_generation: Option<String>,
}

fn present_raw_value<'de, D>(deserializer: D) -> Result<Option<&'de RawValue>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    <&RawValue>::deserialize(deserializer).map(Some)
}

#[derive(Clone, Copy)]
enum FragmentKind {
    Any,
    ObjectOrNull,
    ArrayOrNull,
}

/// Decode one current browser-facing event without coercing arbitrary JSON
/// numbers or normalizing the embedded fragment wire representation.
///
/// # Errors
///
/// Returns a bounded [`ProtocolError`] for malformed JSON, duplicate or
/// unknown fields, invalid field shapes, or exhausted data-plane limits.
pub fn decode_current_node_event_json(raw: &[u8]) -> Result<NodeEventV1, ProtocolError> {
    validate_complete_json(raw)?;
    let wire: CurrentNodeEventJson<'_> =
        serde_json::from_slice(raw).map_err(|_| malformed_node_event())?;
    validate_event_type(&wire.event_type)?;
    validate_optional_safe_string(wire.stream_id.as_deref())?;
    validate_optional_safe_string(wire.message_id.as_deref())?;
    validate_optional_safe_string(wire.question_id.as_deref())?;
    validate_optional_string(wire.thinking.as_deref(), MAX_CURRENT_NODE_EVENT_JSON_BYTES)?;
    validate_optional_safe_string(wire.sio_event.as_deref())?;
    validate_optional_timestamp(wire.created_at.as_deref())?;
    validate_optional_safe_string(wire.parent_message_id.as_deref())?;
    validate_optional_safe_string(wire.agent_name.as_deref())?;
    validate_optional_safe_string(wire.execution_generation.as_deref())?;

    let event = NodeEventV1 {
        r#type: wire.event_type,
        stream_id: wire.stream_id,
        message_id: wire.message_id,
        question_id: wire.question_id,
        content: normalized_fragment(wire.content, b"null", FragmentKind::Any)?,
        thinking: wire.thinking,
        response_metadata: normalized_fragment(
            wire.response_metadata,
            b"{}",
            FragmentKind::ObjectOrNull,
        )?,
        references: normalized_fragment(wire.references, b"[]", FragmentKind::ArrayOrNull)?,
        sio_event: wire.sio_event,
        created_at: wire.created_at,
        parent_message_id: wire.parent_message_id,
        agent_name: wire.agent_name,
        execution_generation: wire.execution_generation,
    };
    if event.encoded_len() >= MAX_NODE_EVENT_PROTO_BYTES {
        return Err(ProtocolError::ResourceExhausted(
            "the current node event exceeds its protobuf limit",
        ));
    }
    Ok(event)
}

/// Decode only a closed, canonical `NodeEventV1` protobuf representation.
///
/// Prost deliberately discards unknown fields, so the closed-wire scan occurs
/// first and the deterministic re-encoding check prevents ambiguous replay
/// bytes from entering the output spool.
///
/// # Errors
///
/// Returns a bounded [`ProtocolError`] for unknown, duplicate, noncanonical,
/// malformed, or semantically invalid event bytes.
pub fn parse_node_event_proto(raw: &[u8]) -> Result<NodeEventV1, ProtocolError> {
    if raw.is_empty() || raw.len() >= MAX_NODE_EVENT_PROTO_BYTES {
        return Err(ProtocolError::ResourceExhausted(
            "the current node event exceeds its protobuf limit",
        ));
    }
    scan_message(raw, Schema::NodeEvent)?;
    let event = NodeEventV1::decode(raw).map_err(|_| malformed_node_event())?;
    if event.encode_to_vec() != raw {
        return Err(ProtocolError::InvalidInput(
            "the current node event is not canonical protocol v1",
        ));
    }
    encode_current_node_event_json(&event)?;
    Ok(event)
}

/// Encode all thirteen established fields in browser contract order using
/// Go `encoding/json` compatible HTML escaping.
///
/// # Errors
///
/// Returns a bounded [`ProtocolError`] when the protobuf event contains an
/// invalid fragment, string, timestamp, shape, or complete JSON representation.
pub fn encode_current_node_event_json(event: &NodeEventV1) -> Result<Vec<u8>, ProtocolError> {
    validate_event_type(&event.r#type)?;
    validate_optional_safe_string(event.stream_id.as_deref())?;
    validate_optional_safe_string(event.message_id.as_deref())?;
    validate_optional_safe_string(event.question_id.as_deref())?;
    validate_optional_string(event.thinking.as_deref(), MAX_CURRENT_NODE_EVENT_JSON_BYTES)?;
    validate_optional_safe_string(event.sio_event.as_deref())?;
    validate_optional_timestamp(event.created_at.as_deref())?;
    validate_optional_safe_string(event.parent_message_id.as_deref())?;
    validate_optional_safe_string(event.agent_name.as_deref())?;
    validate_optional_safe_string(event.execution_generation.as_deref())?;

    let content = normalized_fragment_bytes(&event.content, b"null", FragmentKind::Any)?;
    let response_metadata =
        normalized_fragment_bytes(&event.response_metadata, b"{}", FragmentKind::ObjectOrNull)?;
    let references =
        normalized_fragment_bytes(&event.references, b"[]", FragmentKind::ArrayOrNull)?;

    let mut output = Vec::with_capacity(
        event
            .encoded_len()
            .saturating_add(256)
            .min(MAX_CURRENT_NODE_EVENT_JSON_BYTES),
    );
    output.extend_from_slice(b"{\"type\":");
    append_json_string(&mut output, &event.r#type)?;
    append_optional_string(&mut output, b",\"stream_id\":", event.stream_id.as_deref())?;
    append_optional_string(
        &mut output,
        b",\"message_id\":",
        event.message_id.as_deref(),
    )?;
    append_optional_string(
        &mut output,
        b",\"question_id\":",
        event.question_id.as_deref(),
    )?;
    output.extend_from_slice(b",\"content\":");
    output.extend_from_slice(&content);
    append_optional_string(&mut output, b",\"thinking\":", event.thinking.as_deref())?;
    output.extend_from_slice(b",\"response_metadata\":");
    output.extend_from_slice(&response_metadata);
    output.extend_from_slice(b",\"references\":");
    output.extend_from_slice(&references);
    append_optional_string(&mut output, b",\"sio_event\":", event.sio_event.as_deref())?;
    append_optional_string(
        &mut output,
        b",\"created_at\":",
        event.created_at.as_deref(),
    )?;
    append_optional_string(
        &mut output,
        b",\"parent_message_id\":",
        event.parent_message_id.as_deref(),
    )?;
    append_optional_string(
        &mut output,
        b",\"agent_name\":",
        event.agent_name.as_deref(),
    )?;
    append_optional_string(
        &mut output,
        b",\"execution_generation\":",
        event.execution_generation.as_deref(),
    )?;
    output.push(b'}');

    let output = go_html_escape(&output);
    if output.len() > MAX_CURRENT_NODE_EVENT_JSON_BYTES || !valid_json_nesting(&output) {
        return Err(ProtocolError::ResourceExhausted(
            "the current node event exceeds its browser JSON limit",
        ));
    }
    Ok(output)
}

fn normalized_fragment(
    raw: Option<&RawValue>,
    fallback: &[u8],
    kind: FragmentKind,
) -> Result<Vec<u8>, ProtocolError> {
    normalized_fragment_bytes(
        raw.map_or(fallback, |value| value.get().as_bytes()),
        fallback,
        kind,
    )
}

fn normalized_fragment_bytes(
    raw: &[u8],
    fallback: &[u8],
    kind: FragmentKind,
) -> Result<Vec<u8>, ProtocolError> {
    let raw = if raw.is_empty() { fallback } else { raw };
    validate_complete_json(raw)?;
    let compact = compact_json(raw);
    if compact != b"null"
        && !matches!(
            (kind, compact.first()),
            (FragmentKind::Any, _)
                | (FragmentKind::ObjectOrNull, Some(b'{'))
                | (FragmentKind::ArrayOrNull, Some(b'['))
        )
    {
        return Err(malformed_node_event());
    }
    Ok(compact)
}

fn validate_complete_json(raw: &[u8]) -> Result<(), ProtocolError> {
    if raw.is_empty() || raw.len() > MAX_CURRENT_NODE_EVENT_JSON_BYTES {
        return Err(ProtocolError::ResourceExhausted(
            "the current node event exceeds its browser JSON limit",
        ));
    }
    if !valid_json_nesting(raw) {
        return Err(ProtocolError::ResourceExhausted(
            "the current node event exceeds its JSON nesting limit",
        ));
    }
    serde_json::from_slice::<&RawValue>(raw).map_err(|_| malformed_node_event())?;
    JsonMembers::new(raw).validate()
}

fn validate_event_type(value: &str) -> Result<(), ProtocolError> {
    let bytes = value.as_bytes();
    if bytes.is_empty()
        || bytes.len() > MAX_EVENT_TYPE_BYTES
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1..]
            .iter()
            .any(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_')
    {
        return Err(malformed_node_event());
    }
    Ok(())
}

fn validate_optional_safe_string(value: Option<&str>) -> Result<(), ProtocolError> {
    validate_optional_string(value, MAX_SAFE_STRING_BYTES)?;
    if value.is_some_and(|value| {
        value
            .bytes()
            .any(|byte| matches!(byte, b'\r' | b'\n' | b'\0'))
    }) {
        return Err(malformed_node_event());
    }
    Ok(())
}

fn validate_optional_string(value: Option<&str>, maximum: usize) -> Result<(), ProtocolError> {
    if value.is_some_and(|value| value.len() > maximum) {
        return Err(ProtocolError::ResourceExhausted(
            "a current node event string exceeds its limit",
        ));
    }
    Ok(())
}

fn validate_optional_timestamp(value: Option<&str>) -> Result<(), ProtocolError> {
    validate_optional_safe_string(value)?;
    if value.is_some_and(|value| value.len() > 64 || !valid_rfc3339(value)) {
        return Err(malformed_node_event());
    }
    Ok(())
}

fn valid_rfc3339(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return false;
    }
    let Some(year) = decimal(bytes, 0, 4) else {
        return false;
    };
    let Some(month) = decimal(bytes, 5, 2) else {
        return false;
    };
    let Some(day) = decimal(bytes, 8, 2) else {
        return false;
    };
    let Some(hour) = decimal(bytes, 11, 2) else {
        return false;
    };
    let Some(minute) = decimal(bytes, 14, 2) else {
        return false;
    };
    let Some(second) = decimal(bytes, 17, 2) else {
        return false;
    };
    if year == 0
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return false;
    }

    let mut cursor = 19;
    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        let fraction_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor == fraction_start || cursor - fraction_start > 9 {
            return false;
        }
    }
    match bytes.get(cursor) {
        Some(b'Z') => cursor + 1 == bytes.len(),
        Some(b'+' | b'-') => {
            bytes.len() == cursor + 6
                && bytes.get(cursor + 3) == Some(&b':')
                && decimal(bytes, cursor + 1, 2).is_some_and(|value| value <= 23)
                && decimal(bytes, cursor + 4, 2).is_some_and(|value| value <= 59)
        }
        _ => false,
    }
}

fn decimal(bytes: &[u8], start: usize, length: usize) -> Option<u32> {
    let end = start.checked_add(length)?;
    let digits = bytes.get(start..end)?;
    if digits.iter().any(|byte| !byte.is_ascii_digit()) {
        return None;
    }
    digits.iter().try_fold(0_u32, |value, byte| {
        value.checked_mul(10)?.checked_add(u32::from(byte - b'0'))
    })
}

const fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => 0,
    }
}

fn append_optional_string(
    output: &mut Vec<u8>,
    key: &[u8],
    value: Option<&str>,
) -> Result<(), ProtocolError> {
    output.extend_from_slice(key);
    if let Some(value) = value {
        append_json_string(output, value)
    } else {
        output.extend_from_slice(b"null");
        Ok(())
    }
}

fn append_json_string(output: &mut Vec<u8>, value: &str) -> Result<(), ProtocolError> {
    let encoded = serde_json::to_vec(value).map_err(|_| malformed_node_event())?;
    output.extend_from_slice(&encoded);
    Ok(())
}

fn go_html_escape(raw: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(raw.len());
    let mut cursor = 0;
    while cursor < raw.len() {
        match raw[cursor] {
            b'&' => output.extend_from_slice(b"\\u0026"),
            b'<' => output.extend_from_slice(b"\\u003c"),
            b'>' => output.extend_from_slice(b"\\u003e"),
            0xe2 if raw.get(cursor..cursor + 3) == Some("\u{2028}".as_bytes()) => {
                output.extend_from_slice(b"\\u2028");
                cursor += 2;
            }
            0xe2 if raw.get(cursor..cursor + 3) == Some("\u{2029}".as_bytes()) => {
                output.extend_from_slice(b"\\u2029");
                cursor += 2;
            }
            byte => output.push(byte),
        }
        cursor += 1;
    }
    output
}

fn compact_json(raw: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(raw.len());
    let mut in_string = false;
    let mut escaped = false;
    for &byte in raw {
        if in_string {
            output.push(byte);
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
        } else if byte == b'"' {
            in_string = true;
            output.push(byte);
        } else if !matches!(byte, b' ' | b'\t' | b'\r' | b'\n') {
            output.push(byte);
        }
    }
    output
}

fn valid_json_nesting(raw: &[u8]) -> bool {
    let mut depth = 0_usize;
    let mut in_string = false;
    let mut escaped = false;
    for &byte in raw {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' | b'[' => {
                depth += 1;
                if depth > MAX_JSON_NESTING {
                    return false;
                }
            }
            b'}' | b']' => {
                let Some(next) = depth.checked_sub(1) else {
                    return false;
                };
                depth = next;
            }
            _ => {}
        }
    }
    depth == 0 && !in_string && !escaped
}

/// Structural pass over already grammar-validated JSON. It rejects duplicate
/// object names after JSON unescaping, including differently escaped aliases.
struct JsonMembers<'a> {
    raw: &'a [u8],
    cursor: usize,
}

impl<'a> JsonMembers<'a> {
    const fn new(raw: &'a [u8]) -> Self {
        Self { raw, cursor: 0 }
    }

    fn validate(mut self) -> Result<(), ProtocolError> {
        self.skip_whitespace();
        self.value()?;
        self.skip_whitespace();
        if self.cursor != self.raw.len() {
            return Err(malformed_node_event());
        }
        Ok(())
    }

    fn value(&mut self) -> Result<(), ProtocolError> {
        self.skip_whitespace();
        match self.peek() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => self.string().map(|_| ()),
            Some(b't') => self.literal(b"true"),
            Some(b'f') => self.literal(b"false"),
            Some(b'n') => self.literal(b"null"),
            Some(b'-' | b'0'..=b'9') => {
                self.number();
                Ok(())
            }
            _ => Err(malformed_node_event()),
        }
    }

    fn object(&mut self) -> Result<(), ProtocolError> {
        self.cursor += 1;
        self.skip_whitespace();
        if self.take(b'}') {
            return Ok(());
        }
        let mut keys = HashSet::new();
        loop {
            let key = self.string()?;
            if !keys.insert(key) {
                return Err(ProtocolError::InvalidInput(
                    "the current node event contains a duplicate JSON member",
                ));
            }
            self.skip_whitespace();
            if !self.take(b':') {
                return Err(malformed_node_event());
            }
            self.value()?;
            self.skip_whitespace();
            if self.take(b'}') {
                return Ok(());
            }
            if !self.take(b',') {
                return Err(malformed_node_event());
            }
            self.skip_whitespace();
        }
    }

    fn array(&mut self) -> Result<(), ProtocolError> {
        self.cursor += 1;
        self.skip_whitespace();
        if self.take(b']') {
            return Ok(());
        }
        loop {
            self.value()?;
            self.skip_whitespace();
            if self.take(b']') {
                return Ok(());
            }
            if !self.take(b',') {
                return Err(malformed_node_event());
            }
            self.skip_whitespace();
        }
    }

    fn string(&mut self) -> Result<String, ProtocolError> {
        let start = self.cursor;
        if !self.take(b'"') {
            return Err(malformed_node_event());
        }
        let mut escaped = false;
        while let Some(byte) = self.peek() {
            self.cursor += 1;
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                return serde_json::from_slice(&self.raw[start..self.cursor])
                    .map_err(|_| malformed_node_event());
            }
        }
        Err(malformed_node_event())
    }

    fn literal(&mut self, expected: &[u8]) -> Result<(), ProtocolError> {
        let end = self.cursor.saturating_add(expected.len());
        if self.raw.get(self.cursor..end) != Some(expected) {
            return Err(malformed_node_event());
        }
        self.cursor = end;
        Ok(())
    }

    fn number(&mut self) {
        while self
            .peek()
            .is_some_and(|byte| !matches!(byte, b' ' | b'\t' | b'\r' | b'\n' | b',' | b']' | b'}'))
        {
            self.cursor += 1;
        }
    }

    fn skip_whitespace(&mut self) {
        while self
            .peek()
            .is_some_and(|byte| matches!(byte, b' ' | b'\t' | b'\r' | b'\n'))
        {
            self.cursor += 1;
        }
    }

    fn take(&mut self, expected: u8) -> bool {
        if self.peek() == Some(expected) {
            self.cursor += 1;
            true
        } else {
            false
        }
    }

    fn peek(&self) -> Option<u8> {
        self.raw.get(self.cursor).copied()
    }
}

const fn malformed_node_event() -> ProtocolError {
    ProtocolError::InvalidInput("the current node event is malformed")
}
