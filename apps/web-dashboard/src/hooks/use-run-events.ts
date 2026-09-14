import type { RunResultRecord, RunSummary } from "@promptguard/shared-types";
import { useEffect, useRef, useState } from "react";

import { apiBaseUrl } from "../lib/env";

export interface RunEventsState {
  run: RunSummary | null;
  results: RunResultRecord[] | null;
  resultCount: number;
  /** True while the stream is open and the run has not reached a terminal state. */
  streaming: boolean;
  error: string | null;
}

/**
 * Subscribes to a run's server-sent event stream.
 *
 * Replaces interval polling: the server pushes a `progress` frame whenever the
 * status or result count changes, and a final `complete` frame carrying the
 * full result set. Terminal runs get one frame and the stream closes, so there
 * is no ongoing connection for finished runs.
 */
export function useRunEvents(runId: string | undefined, enabled: boolean): RunEventsState {
  const [state, setState] = useState<RunEventsState>({
    run: null,
    results: null,
    resultCount: 0,
    streaming: false,
    error: null
  });

  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId || !enabled) {
      return;
    }

    const source = new EventSource(`${apiBaseUrl}/runs/${runId}/events`);
    sourceRef.current = source;

    setState((previous) => ({ ...previous, streaming: true, error: null }));

    source.addEventListener("progress", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        run: RunSummary;
        resultCount: number;
      };

      setState((previous) => ({
        ...previous,
        run: payload.run,
        resultCount: payload.resultCount
      }));
    });

    source.addEventListener("complete", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        run: RunSummary;
        results: RunResultRecord[];
      };

      setState({
        run: payload.run,
        results: payload.results,
        resultCount: payload.results.length,
        streaming: false,
        error: null
      });

      source.close();
    });

    source.onerror = () => {
      // EventSource reconnects on its own; only surface an error if the browser
      // gave up entirely.
      if (source.readyState === EventSource.CLOSED) {
        setState((previous) => ({
          ...previous,
          streaming: false,
          error: "Lost connection to the run event stream."
        }));
      }
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [runId, enabled]);

  return state;
}
