"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type RealtimeTable =
  | "expenses"
  | "expense_splits"
  | "settlements"
  | "chores"
  | "room_members";

export type ChannelStatus = "connecting" | "live" | "offline";

let channelSeq = 0;

/**
 * Subscribes to Postgres changes for one room and calls `onChange` whenever
 * anything in `tables` moves.
 *
 * It deliberately signals "something changed" rather than handing back row
 * deltas. A single expense write touches `expenses` and several
 * `expense_splits` rows, and the UI shows values derived from both, so
 * refetching the tab's query is both simpler and less likely to drift out of
 * sync than reconciling two tables by hand. The debounce coalesces that burst
 * into one refetch.
 *
 * Three things trigger a refetch, because a websocket is not a guarantee:
 *   1. A change event arrives.
 *   2. The channel (re)subscribes — covers events missed while connecting, and
 *      events missed during a reconnect.
 *   3. The tab becomes visible again — phones suspend websockets when
 *      backgrounded, and a silently dead socket looks exactly like a quiet one.
 */
export function useRoomRealtime(
  roomId: string,
  tables: RealtimeTable[],
  onChange: () => void,
): ChannelStatus {
  const [status, setStatus] = useState<ChannelStatus>("connecting");

  // Keep the latest callback in a ref so a new closure each render doesn't tear
  // the subscription down and rebuild it. Written in an effect rather than
  // during render, which React forbids.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const tableKey = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;

    const schedule = () => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed) onChangeRef.current();
      }, 80);
    };

    async function connect() {
      /**
       * Load the session and hand its token to Realtime *before* subscribing.
       *
       * This is load-bearing. The browser client reads its session from
       * cookies asynchronously, so subscribing on mount races that read. If it
       * loses, Realtime evaluates the subscription as `anon` — which this
       * schema deliberately grants nothing — and the server replies "Unable to
       * subscribe to changes with given parameters". The channel still reports
       * SUBSCRIBED, so the UI looks connected and silently never updates.
       */
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (disposed) return;

      if (!session) {
        setStatus("offline");
        return;
      }

      await supabase.realtime.setAuth(session.access_token);
      if (disposed) return;

      // Unique topic per hook instance. Two components subscribing to the same
      // topic (a tab switch remounting, or React's development double-mount)
      // otherwise race a join against a leave on the same server-side channel.
      channelSeq += 1;
      channel = supabase.channel(`room:${roomId}:${channelSeq}`);

      for (const table of tableKey.split(",") as RealtimeTable[]) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `room_id=eq.${roomId}` },
          schedule,
        );
      }

      // The server reports a failed postgres_changes binding here rather than
      // through the subscribe callback, so surface it instead of showing "Live"
      // over a feed that will never deliver anything.
      channel.on("system", {}, (payload: { status?: string; message?: string }) => {
        if (disposed) return;
        if (payload?.status === "error") {
          setStatus("offline");
          console.error("Realtime subscription failed:", payload.message);
        }
      });

      channel.subscribe((state) => {
        if (disposed) return;
        if (state === "SUBSCRIBED") {
          setStatus("live");
          schedule();
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          setStatus("offline");
        } else if (state === "CLOSED") {
          setStatus("connecting");
        }
      });
    }

    void connect();

    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", schedule);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", schedule);
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId, tableKey]);

  return status;
}
