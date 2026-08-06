/**
 * executionEvents.test.tsx — issue #93, the durable execution-replay stream.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfigForTests } from '@/shared/config/get-config';

import {
  EXECUTION_EVENT_FAILED,
  EXECUTION_EVENT_INDEX_INGEST_COMPLETED,
  EXECUTION_EVENT_NODE,
  parseExecutionEventData,
  resolveExecutionEventsUrl,
  useExecutionEventStream,
  useExecutionEvents,
  type UseExecutionEventsParams,
} from './executionEvents';
import { installTestEventSource, type TestEventSourceRegistry } from './testing';

const globals = globalThis as unknown as Record<string, unknown>;
let registry: TestEventSourceRegistry;

function setConfig(serverUrl?: string): void {
  if (serverUrl === undefined) {
    delete globals['elitea_ui_config'];
  } else {
    globals['elitea_ui_config'] = { vite_server_url: serverUrl, vite_base_uri: '/', vite_public_project_id: 'public-1' };
  }
  resetConfigForTests();
}

function Probe(params: UseExecutionEventsParams): null {
  useExecutionEvents(params);
  return null;
}

beforeEach(() => {
  registry = installTestEventSource();
  setConfig('/api/v2');
});

afterEach(() => {
  registry.restore();
  setConfig(undefined);
});

describe('parseExecutionEventData', () => {
  it('parses a JSON object frame', () => {
    expect(parseExecutionEventData(new MessageEvent('m', { data: '{"a":1}' }))).toEqual({ a: 1 });
  });

  it('returns undefined — never throws — for malformed, empty, non-string, or non-object frames', () => {
    expect(parseExecutionEventData(new MessageEvent('m', { data: 'not json' }))).toBeUndefined();
    expect(parseExecutionEventData(new MessageEvent('m', { data: '' }))).toBeUndefined();
    expect(parseExecutionEventData(new MessageEvent('m', { data: 42 }))).toBeUndefined();
    expect(parseExecutionEventData(new MessageEvent('m', { data: '[1,2]' }))).toBeUndefined();
    expect(parseExecutionEventData(new MessageEvent('m', { data: 'null' }))).toBeUndefined();
  });
});

describe('useExecutionEvents', () => {
  it('opens the runtime events route for the given project and execution', () => {
    render(
      <Probe
        projectId="7"
        executionId="exec-1"
      />,
    );
    expect(registry.getSources()[0]?.url).toBe('/api/v2/executions/7/exec-1/events');
    expect(registry.getSources()[0]?.withCredentials).toBe(true);
  });

  it('dispatches each event name to its own callback with the parsed frame', () => {
    const onNodeEvent = vi.fn();
    const onIndexIngestCompleted = vi.fn();
    const onFailed = vi.fn();
    render(
      <Probe
        projectId={7}
        executionId="exec-1"
        onNodeEvent={onNodeEvent}
        onIndexIngestCompleted={onIndexIngestCompleted}
        onFailed={onFailed}
      />,
    );

    act(() => {
      registry.emit(EXECUTION_EVENT_NODE, '{"type":"chunk"}');
      registry.emit(EXECUTION_EVENT_INDEX_INGEST_COMPLETED, '{"status":"ok"}');
      registry.emit(EXECUTION_EVENT_FAILED, '{"message":"boom"}');
    });

    expect(onNodeEvent).toHaveBeenCalledWith({ type: 'chunk' });
    expect(onIndexIngestCompleted).toHaveBeenCalledWith({ status: 'ok' });
    expect(onFailed).toHaveBeenCalledWith({ message: 'boom' });
  });

  it('drops an unparseable frame instead of invoking the callback', () => {
    const onNodeEvent = vi.fn();
    render(
      <Probe
        projectId="7"
        executionId="exec-1"
        onNodeEvent={onNodeEvent}
      />,
    );

    act(() => {
      registry.emit(EXECUTION_EVENT_NODE, 'not json');
    });
    expect(onNodeEvent).not.toHaveBeenCalled();
  });

  it('registers every event name even when its callback is absent, so a frame with no consumer is a harmless no-op', () => {
    render(
      <Probe
        projectId="7"
        executionId="exec-1"
      />,
    );
    expect(() =>
      act(() => {
        registry.emit(EXECUTION_EVENT_FAILED, '{"message":"boom"}');
      }),
    ).not.toThrow();
  });

  it('keeps ONE connection when only the callbacks change identity', () => {
    const { rerender } = render(
      <Probe
        projectId="7"
        executionId="exec-1"
        onNodeEvent={vi.fn()}
      />,
    );
    rerender(
      <Probe
        projectId="7"
        executionId="exec-1"
        onNodeEvent={vi.fn()}
      />,
    );
    expect(registry.getSources()).toHaveLength(1);
  });

  it('opens nothing without an execution id, without a project id, or with an empty project id', () => {
    const { rerender } = render(
      <Probe
        projectId="7"
        executionId={undefined}
      />,
    );
    rerender(
      <Probe
        projectId={undefined}
        executionId="exec-1"
      />,
    );
    rerender(
      <Probe
        projectId=""
        executionId="exec-1"
      />,
    );
    expect(registry.getSources()).toHaveLength(0);
  });

  it('opens nothing when the runtime config never resolved', () => {
    setConfig(undefined);
    render(
      <Probe
        projectId="7"
        executionId="exec-1"
      />,
    );
    expect(registry.getSources()).toHaveLength(0);
  });

  it('closes the previous stream when the execution id changes, and on unmount', () => {
    const { rerender, unmount } = render(
      <Probe
        projectId="7"
        executionId="exec-1"
      />,
    );
    rerender(
      <Probe
        projectId="7"
        executionId="exec-2"
      />,
    );
    expect(registry.getSources()[0]?.closed).toBe(true);
    expect(registry.getOpen()).toHaveLength(1);

    unmount();
    expect(registry.getOpen()).toHaveLength(0);
  });
});


describe('resolveExecutionEventsUrl', () => {
  it('returns null for an absent url', () => {
    expect(resolveExecutionEventsUrl('/api/v2', undefined)).toBeNull();
    expect(resolveExecutionEventsUrl('/api/v2', null)).toBeNull();
    expect(resolveExecutionEventsUrl('/api/v2', '')).toBeNull();
  });

  it('leaves the server-built absolute PATH alone when the API is same-origin (compose/dev: vite_server_url is "/api/v2")', () => {
    // Prefixing here would produce /api/v2/api/v2/executions/... — the bug
    // this function exists to prevent.
    expect(resolveExecutionEventsUrl('/api/v2', '/api/v2/executions/7/e1/events')).toBe('/api/v2/executions/7/e1/events');
  });

  it('re-homes the path onto the API origin when vite_server_url names a different one', () => {
    expect(resolveExecutionEventsUrl('https://api.example.com/api/v2', '/api/v2/executions/7/e1/events')).toBe(
      'https://api.example.com/api/v2/executions/7/e1/events',
    );
  });

  it('passes an already-absolute events_url through untouched', () => {
    expect(resolveExecutionEventsUrl('https://api.example.com/api/v2', 'https://other.example/stream')).toBe('https://other.example/stream');
  });

  it('falls back to the raw path when vite_server_url does not parse as a URL', () => {
    expect(resolveExecutionEventsUrl('https://', '/api/v2/executions/7/e1/events')).toBe('/api/v2/executions/7/e1/events');
  });
});

describe('useExecutionEventStream', () => {
  function StreamProbe({ eventsUrl, onFailed }: { readonly eventsUrl: string | null; readonly onFailed?: () => void }): null {
    useExecutionEventStream(eventsUrl, onFailed ? { onFailed } : {});
    return null;
  }

  it('opens the server-supplied events_url and delivers the failure frame', () => {
    const onFailed = vi.fn();
    render(
      <StreamProbe
        eventsUrl="/api/v2/executions/7/exec-1/events"
        onFailed={onFailed}
      />,
    );
    expect(registry.getSources()[0]?.url).toBe('/api/v2/executions/7/exec-1/events');

    act(() => {
      registry.emit(EXECUTION_EVENT_FAILED, '{"message":"boom"}');
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('opens nothing for a null url, and closes when the url is cleared', () => {
    const { rerender } = render(<StreamProbe eventsUrl={null} />);
    expect(registry.getSources()).toHaveLength(0);

    rerender(<StreamProbe eventsUrl="/api/v2/executions/7/exec-1/events" />);
    expect(registry.getOpen()).toHaveLength(1);

    rerender(<StreamProbe eventsUrl={null} />);
    expect(registry.getOpen()).toHaveLength(0);
  });
});
