'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseBrowser';
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';

type Post = {
  id: string;
  trip_id: string;
  type: 'breadcrumb';
  lat: number;
  lng: number;
  accuracy_m: number | null;
  created_at: string;
  place_text: string | null;
  moment_id: string | null;
};

type Moment = {
  id: string;
  trip_id: string;
  user_id: string;
  text: string | null;
  photo_path: string | null;
  created_at: string;
};

type MomentMarker = {
  moment: Moment;
  post: Post; // breadcrumb created under the moment (gives lat/lng + place_text)
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildMomentIcon() {
  // Quiet, distinct marker: small ring with filled centre.
  return L.divIcon({
    className: 'pilgrim-moment-marker',
    html: `
      <div style="
        width: 16px;
        height: 16px;
        border-radius: 9999px;
        background: white;
        border: 2px solid #111;
        box-shadow: 0 1px 3px rgba(0,0,0,0.25);
        display: grid;
        place-items: center;
      ">
        <div style="
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: #111;
        "></div>
      </div>
    `,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default function MapSection({ tripId }: { tripId: string }) {
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [posts, setPosts] = useState<Post[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorText(null);

      // 1) Load footprints (posts)
      const postsRes = await supabase
        .from('posts')
        .select('id, trip_id, type, lat, lng, accuracy_m, created_at, place_text, moment_id')
        .eq('trip_id', tripId)
        .eq('type', 'breadcrumb')
        .order('created_at', { ascending: true });

      if (postsRes.error) {
        if (!cancelled) {
          setErrorText(`Could not load map locations: ${postsRes.error.message}`);
          setLoading(false);
        }
        return;
      }

      // 2) Load moments
      const momentsRes = await supabase
        .from('moments')
        .select('id, trip_id, user_id, text, photo_path, created_at')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true });

      if (momentsRes.error) {
        if (!cancelled) {
          setErrorText(`Could not load moments: ${momentsRes.error.message}`);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setPosts((postsRes.data ?? []) as Post[]);
        setMoments((momentsRes.data ?? []) as Moment[]);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const routeLatLngs = useMemo(() => {
    return posts.map((p) => [p.lat, p.lng] as [number, number]);
  }, [posts]);

  const momentMarkers = useMemo<MomentMarker[]>(() => {
    // post.moment_id links to moments.id
    const momentsById = new Map(moments.map((m) => [m.id, m]));
    const linkedPosts = posts.filter((p) => p.moment_id);

    const markers: MomentMarker[] = [];

    for (const p of linkedPosts) {
      const m = p.moment_id ? momentsById.get(p.moment_id) : null;
      if (!m) continue;
      markers.push({ moment: m, post: p });
    }

    return markers;
  }, [posts, moments]);

  const hasAnyPoints = posts.length > 0 || momentMarkers.length > 0;
  const momentIcon = useMemo(() => buildMomentIcon(), []);

  if (loading) {
    return (
      <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Map</div>
        <div style={{ opacity: 0.8 }}>Loading…</div>
      </div>
    );
  }

  if (errorText) {
    return (
      <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Map</div>
        <div style={{ opacity: 0.9 }}>{errorText}</div>
      </div>
    );
  }

  if (!hasAnyPoints) {
    return (
      <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Map</div>
        <div style={{ opacity: 0.8 }}>
          No locations yet. Add a moment to start your journey.
        </div>
      </div>
    );
  }

  const fallbackCentre: [number, number] = routeLatLngs[0] ?? [51.5072, -0.1276];

  return (
    <div style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
      <MapContainer
        style={{ height: 320, width: '100%' }}
        center={fallbackCentre}
        zoom={12}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Footprints: small dots */}
        {posts.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={3}
            pathOptions={{ weight: 1 }}
          />
        ))}

        {/* Route: connecting line */}
        {routeLatLngs.length >= 2 ? <Polyline positions={routeLatLngs} /> : null}

        {/* Moments: distinct markers */}
        {momentMarkers.map(({ moment, post }) => (
          <Marker
            key={`${moment.id}-${post.id}`}
            position={[post.lat, post.lng]}
            icon={momentIcon}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {post.place_text ? post.place_text : 'Moment'}
                </div>
                <div style={{ opacity: 0.8, marginBottom: 8 }}>
                  {formatDateTime(moment.created_at)}
                </div>
                {moment.text ? (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{moment.text}</div>
                ) : (
                  <div style={{ opacity: 0.75 }}>No text</div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        <FitToPoints posts={posts} momentMarkers={momentMarkers} />
      </MapContainer>
    </div>
  );
}

function FitToPoints({
  posts,
  momentMarkers,
}: {
  posts: Post[];
  momentMarkers: MomentMarker[];
}) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];

    for (const p of posts) points.push([p.lat, p.lng]);
    for (const mm of momentMarkers) points.push([mm.post.lat, mm.post.lng]);

    if (points.length === 0) return;

    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [map, posts, momentMarkers]);

  return null;
}
