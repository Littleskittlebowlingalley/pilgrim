'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseBrowser';

type Footprint = {
  id: string;
  trip_id: string;
  type: string; // 'breadcrumb'
  lat: number;
  lng: number;
  accuracy_m: number;
  place_text: string | null;
  created_at: string;
};

type Moment = {
  id: string;
  trip_id: string;
  user_id: string;
  text: string;
  photo_path: string | null;
  created_at: string;
};

type TimelineEntry =
  | {
      kind: 'combined';
      created_at: string; // use moment time
      moment: Moment;
      footprint: Footprint;
    }
  | {
      kind: 'moment';
      created_at: string;
      moment: Moment;
    }
  | {
      kind: 'footprint';
      created_at: string;
      footprint: Footprint;
    };

function dayKey(iso: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function ms(iso: string) {
  return new Date(iso).getTime();
}

export default function TimelineSection({
  tripId,
  tripStatus,
}: {
  tripId: string;
  tripStatus?: string | null;
}) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [footprints, setFootprints] = useState<Footprint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isEnded = tripStatus === 'ended';

  async function loadTimeline(currentTripId: string) {
    setLoading(true);
    setError('');

    const momentsQuery = supabase
      .from('moments')
      .select('id, trip_id, user_id, text, photo_path, created_at')
      .eq('trip_id', currentTripId)

    const footprintsQuery = supabase
      .from('posts')
      .select('id, trip_id, type, lat, lng, accuracy_m, place_text, created_at')
      .eq('trip_id', currentTripId)
      .eq('type', 'breadcrumb')
    
    const [momentsRes, footprintsRes] = await Promise.all([momentsQuery, footprintsQuery]);

    if (momentsRes.error) {
      setError(momentsRes.error.message);
      setLoading(false);
      return;
    }

    if (footprintsRes.error) {
      setError(footprintsRes.error.message);
      setLoading(false);
      return;
    }

    setMoments((momentsRes.data ?? []) as Moment[]);
    setFootprints((footprintsRes.data ?? []) as Footprint[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!tripId) return;
    loadTimeline(tripId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, isEnded]); // reload if trip flips between active/ended

  const entries = useMemo(() => {
    // We’ll merge a moment + footprint if they happen within this window.
    // (Moments now create footprints, so they should usually match.)
    const MATCH_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

    // For matching, it’s easiest to work with footprints sorted newest-first internally.
    // (The final sort is handled below.)
    const fpsForMatching = [...footprints].sort((a, b) => ms(b.created_at) - ms(a.created_at));
    const usedFootprints = new Set<string>();

    const out: TimelineEntry[] = [];

    for (const m of moments) {
      const t = ms(m.created_at);

      // Find the closest footprint within the window that hasn't been used yet
      let best: Footprint | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;

      for (const f of fpsForMatching) {
        if (usedFootprints.has(f.id)) continue;
        const dt = Math.abs(ms(f.created_at) - t);
        if (dt <= MATCH_WINDOW_MS && dt < bestDelta) {
          best = f;
          bestDelta = dt;
        }
      }

      if (best) {
        usedFootprints.add(best.id);
        out.push({ kind: 'combined', created_at: m.created_at, moment: m, footprint: best });
      } else {
        out.push({ kind: 'moment', created_at: m.created_at, moment: m });
      }
    }

    // Add remaining unmatched footprints
    for (const f of fpsForMatching) {
      if (usedFootprints.has(f.id)) continue;
      out.push({ kind: 'footprint', created_at: f.created_at, footprint: f });
    }

    // Final sort:
    // - active => newest first
    // - ended  => oldest first
    out.sort((a, b) => (isEnded ? ms(a.created_at) - ms(b.created_at) : ms(b.created_at) - ms(a.created_at)));

    return out;
  }, [moments, footprints, isEnded]);

  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const it of entries) {
      const key = dayKey(it.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return map;
  }, [entries]);

  const dayKeys = useMemo(() => {
    // - active => newest days first
    // - ended  => oldest days first
    return Array.from(grouped.keys()).sort((a, b) => {
      if (a === b) return 0;
      if (isEnded) return a > b ? 1 : -1;
      return a > b ? -1 : 1;
    });
  }, [grouped, isEnded]);

  function footprintWhere(f: Footprint) {
    return f.place_text ? f.place_text : `${f.lat}, ${f.lng}`;
  }

  return (
    <>
      <hr style={{ margin: '24px 0' }} />

      <h3 style={{ marginBottom: 8 }}>Timeline</h3>
 

      {loading ? <p>Loading timeline…</p> : null}
      {error ? <p>Error: {error}</p> : null}

      {!loading && !error && entries.length === 0 ? <p>Nothing yet.</p> : null}

      {!loading && !error && entries.length > 0 ? (
        <div style={{ display: 'grid', gap: 16 }}>
          {dayKeys.map((dk) => {
            const dayItems = grouped.get(dk) ?? [];
            const firstIso = dayItems[0]?.created_at ?? dk;

            return (
              <section
                key={dk}
                style={{
                  border: '1px solid rgba(0,0,0,0.12)',
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 10 }}>{dayLabel(firstIso)}</div>

                <div style={{ display: 'grid', gap: 12 }}>
                  {[...dayItems]
  .sort((a, b) =>
    isEnded
      ? ms(a.created_at) - ms(b.created_at)   // oldest first
      : ms(b.created_at) - ms(a.created_at)   // newest first
  )
  .map((it) => {

                    const containerStyle: React.CSSProperties = {
                      paddingLeft: 10,
                      borderLeft: '3px solid rgba(0,0,0,0.12)',
                    };

                    if (it.kind === 'combined') {
                      const m = it.moment;
                      const f = it.footprint;

                      return (
                        <div key={`c-${m.id}-${f.id}`} style={containerStyle}>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>
                            {timeLabel(m.created_at)} · Moment
                          </div>

                          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.text}</div>

                          {m.photo_path ? (
                            <div style={{ marginTop: 8 }}>
                              <img
                                src={m.photo_path}
                                alt="Moment photo"
                                style={{
                                  width: '100%',
                                  maxWidth: 600,
                                  height: 'auto',
                                  borderRadius: 10,
                                  border: '1px solid rgba(0,0,0,0.12)',
                                }}
                              />
                            </div>
                          ) : null}

                          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
                            Footprint: {footprintWhere(f)}
                          </div>
                        </div>
                      );
                    }

                    if (it.kind === 'moment') {
                      const m = it.moment;
                      return (
                        <div key={`m-${m.id}`} style={containerStyle}>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>
                            {timeLabel(m.created_at)} · Moment
                          </div>
                          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.text}</div>
                          {m.photo_path ? (
                            <div style={{ marginTop: 8 }}>
                              <img
                                src={m.photo_path}
                                alt="Moment photo"
                                style={{
                                  width: '100%',
                                  maxWidth: 600,
                                  height: 'auto',
                                  borderRadius: 10,
                                  border: '1px solid rgba(0,0,0,0.12)',
                                }}
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    }

                    const f = it.footprint;
                    return (
                      <div key={`f-${f.id}`} style={containerStyle}>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                          {timeLabel(f.created_at)} · Footprint
                        </div>
                        <div style={{ marginTop: 4, opacity: 0.85 }}>{footprintWhere(f)}</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
