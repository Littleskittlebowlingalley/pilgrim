'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseBrowser';
import MomentsSection from './MomentsSection';
import TimelineSection from './TimelineSection';
import MapSection from './MapSectionClient';

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lng)}&zoom=14&addressdetails=1`;

    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;

    const json: any = await res.json();
    const a = json?.address ?? {};
    const parts: string[] = [];

    const locality =
      a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.hamlet;
    const city = a.city || a.town || a.village;
    const county = a.county;
    const state = a.state;

    if (locality) parts.push(locality);
    if (city && city !== locality) parts.push(city);
    else if (!city && county) parts.push(county);
    else if (!city && !county && state) parts.push(state);

    const label = parts.filter(Boolean).join(', ');
    return label || json?.display_name || null;
  } catch {
    return null;
  }
}

export default function TripPage() {
  const params = useParams<{ id: string }>();
  const tripId = params?.id;

  const [trip, setTrip] = useState<any>(null);
  const [loadingTrip, setLoadingTrip] = useState(true);
  const [tripError, setTripError] = useState('');

  const [updatingTrip, setUpdatingTrip] = useState(false);
  const [tripStatusMsg, setTripStatusMsg] = useState('');

  const [footprintMsg, setFootprintMsg] = useState('');
  const [leavingFootprint, setLeavingFootprint] = useState(false);

  const [footprints, setFootprints] = useState<any[]>([]);
  const [loadingFootprints, setLoadingFootprints] = useState(false);
  const [footprintsError, setFootprintsError] = useState('');

  const [refreshTick, setRefreshTick] = useState(0);
  function bumpRefresh() {
    setRefreshTick((t) => t + 1);
  }

  // ✅ Clear success messages after a short moment (like moments do)
  const footprintMsgTimerRef = useRef<number | null>(null);
  function clearFootprintMsgTimer() {
    if (footprintMsgTimerRef.current) {
      window.clearTimeout(footprintMsgTimerRef.current);
      footprintMsgTimerRef.current = null;
    }
  }
  function showFootprintSuccessBriefly(message: string) {
    clearFootprintMsgTimer();
    setFootprintMsg(message);
    footprintMsgTimerRef.current = window.setTimeout(() => {
      setFootprintMsg('');
      footprintMsgTimerRef.current = null;
    }, 2500);
  }

  async function loadFootprints(currentTripId: string) {
    setLoadingFootprints(true);
    setFootprintsError('');

    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('trip_id', currentTripId)
      .eq('type', 'breadcrumb')
      .order('created_at', { ascending: false });

    if (error) {
      setFootprintsError(error.message);
      setFootprints([]);
    } else {
      setFootprints(data ?? []);
    }

    setLoadingFootprints(false);
  }

  useEffect(() => {
    async function loadTripAndFootprints() {
      if (!tripId) return;

      setLoadingTrip(true);
      setTripError('');

      const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single();

      if (error) {
        setTripError(error.message);
        setTrip(null);
        setLoadingTrip(false);
        return;
      }

      setTrip(data);
      setLoadingTrip(false);

      await loadFootprints(tripId);
      bumpRefresh();
    }

    loadTripAndFootprints();

    return () => {
      clearFootprintMsgTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  async function setTripStatus(newStatus: 'active' | 'ended') {
    if (!tripId) return;

    setUpdatingTrip(true);
    setTripStatusMsg('');

    const { data, error } = await supabase
      .from('trips')
      .update({ status: newStatus })
      .eq('id', tripId)
      .select('*')
      .single();

    if (error) {
      setTripStatusMsg(`Error: ${error.message}`);
    } else {
      setTrip(data);
      setTripStatusMsg(newStatus === 'ended' ? 'Journey marked ended.' : 'Journey re-opened.');
      bumpRefresh();
    }

    setUpdatingTrip(false);
  }

  async function leaveFootprint() {
    if (!tripId) return;

    clearFootprintMsgTimer();
    setFootprintMsg('Getting location…');
    setLeavingFootprint(true);

    if (!navigator.geolocation) {
      setFootprintMsg('Geolocation is not available in this browser.');
      setLeavingFootprint(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;

        const placeText = await reverseGeocode(latitude, longitude);

        const { error } = await supabase.from('posts').insert({
          trip_id: tripId,
          type: 'breadcrumb',
          lat: latitude,
          lng: longitude,
          accuracy_m: accuracy,
          text: null,
          place_text: placeText,
          moment_id: null,
        });

        if (error) {
          setFootprintMsg(`Error: ${error.message}`);
        } else {
          await loadFootprints(tripId);
          bumpRefresh();
          showFootprintSuccessBriefly('Footprint left ✓');
        }

        setLeavingFootprint(false);
      },
      (err) => {
        setFootprintMsg(`Location error: ${err.message}`);
        setLeavingFootprint(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <main style={{ maxWidth: 700, margin: '40px auto', padding: 16, fontFamily: 'system-ui' }}>
      <a href="/" style={{ textDecoration: 'none' }}>
        ← Back
      </a>

      <h1 style={{ fontSize: 28, marginTop: 12 }}>Journey</h1>

      {loadingTrip ? <p>Loading…</p> : null}
      {tripError ? <p>Error: {tripError}</p> : null}

      {trip ? (
        <>
          <h2 style={{ marginTop: 20, marginBottom: 6 }}>{trip.title}</h2>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <p style={{ marginTop: 0, marginBottom: 0 }}>Status: {trip.status}</p>

            {trip.status === 'ended' ? (
              <button
                onClick={() => setTripStatus('active')}
                disabled={updatingTrip}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.18)',
                  background: 'transparent',
                  cursor: updatingTrip ? 'default' : 'pointer',
                  opacity: updatingTrip ? 0.6 : 1,
                }}
              >
                {updatingTrip ? 'Updating…' : 'Re-open journey'}
              </button>
            ) : (
              <button
                onClick={() => setTripStatus('ended')}
                disabled={updatingTrip}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.18)',
                  background: 'transparent',
                  cursor: updatingTrip ? 'default' : 'pointer',
                  opacity: updatingTrip ? 0.6 : 1,
                }}
              >
                {updatingTrip ? 'Updating…' : 'Mark journey complete'}
              </button>
            )}
          </div>

          {tripStatusMsg ? <p style={{ marginTop: 8 }}>{tripStatusMsg}</p> : null}

          <hr style={{ margin: '24px 0' }} />

          {trip.status === 'ended' ? (
            <section
              style={{
                border: '1px solid rgba(0,0,0,0.12)',
                borderRadius: 12,
                padding: 12,
                marginTop: 12,
              }}
            >
              <p style={{ marginTop: 0, marginBottom: 0, opacity: 0.8 }}>
                This journey is completed. Re-open it if you want to add more moments or footprints.
              </p>
            </section>
          ) : (
            <section
              style={{
                border: '1px solid rgba(0,0,0,0.12)',
                borderRadius: 12,
                padding: 12,
              }}
            >
              <MomentsSection
                tripId={tripId as string}
                mode="compose"
                embedded={true}
                onSaved={async () => {
                  await loadFootprints(tripId as string);
                  bumpRefresh();
                }}
              />

              <div style={{ marginTop: 14 }}>

                <button
                  onClick={leaveFootprint}
                  disabled={leavingFootprint}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.18)',
                    background: 'transparent',
                    cursor: leavingFootprint ? 'default' : 'pointer',
                    opacity: leavingFootprint ? 0.6 : 0.85,
                    fontSize: 14,
                  }}
                >
                  {leavingFootprint ? 'Leaving footprint…' : "Leave a footprint (I’m here)"}
                </button>

                {footprintMsg ? (
                  <p style={{ marginTop: 10, opacity: 0.8, fontSize: 14 }} aria-live="polite">
                    {footprintMsg}
                  </p>
                ) : null}
              </div>
            </section>
          )}

          {tripId ? (
            <TimelineSection
              key={`timeline-${tripId}-${refreshTick}`}
              tripId={tripId as string}
              tripStatus={trip?.status}
            />
          ) : null}

          {tripId ? <MapSection key={`map-${tripId}-${refreshTick}`} tripId={tripId as string} /> : null}

          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer' }}>Details</summary>

            <div style={{ marginTop: 12 }}>
              <h3 style={{ marginBottom: 8 }}>Moments (list)</h3>
              <MomentsSection tripId={tripId as string} mode="list" />
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 8 }}>Footprints (raw list)</h3>

              {loadingFootprints ? <p>Loading footprints…</p> : null}
              {footprintsError ? <p>Error: {footprintsError}</p> : null}

              {!loadingFootprints && !footprintsError && footprints.length === 0 ? (
                <p>No footprints yet.</p>
              ) : null}

              {footprints.length > 0 ? (
                <ul style={{ paddingLeft: 18 }}>
                  {footprints.map((fp) => (
                    <li key={fp.id} style={{ marginBottom: 12 }}>
                      <div>{new Date(fp.created_at).toLocaleString()}</div>
                      <div style={{ opacity: 0.8 }}>
                        {fp.place_text ? fp.place_text : `${fp.lat}, ${fp.lng}`} (±
                        {Math.round(fp.accuracy_m)}m)
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        </>
      ) : null}
    </main>
  );
}
