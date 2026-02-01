'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseBrowser';

type TripStatusFilter = 'active' | 'ended';

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);

  const [tripFilter, setTripFilter] = useState<TripStatusFilter>('active');

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  async function signOut() {
  await supabase.auth.signOut();
  window.location.reload();
}

  async function loadTrips(userId: string, filter: TripStatusFilter) {
    setLoadingTrips(true);

    const { data: tripsData, error } = await supabase
      .from('trips')
      .select('*')
      .eq('owner_id', userId)
      .eq('status', filter)
      .order('created_at', { ascending: false });

    if (!error && tripsData) {
      setTrips(tripsData);
    } else {
      setTrips([]);
    }

    setLoadingTrips(false);
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase.auth.getUser();
      setUser(data.user);

      if (data.user) {
        await loadTrips(data.user.id, tripFilter);
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function reloadIfSignedIn() {
      if (!user?.id) return;
      await loadTrips(user.id, tripFilter);
    }

    reloadIfSignedIn();
  }, [tripFilter, user?.id]);

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setMessage('');

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }

    setStatus('sent');
    setMessage(
      'We’ve emailed you a secure sign-in link. You can close this page while you wait.'
    );
  }

  if (user) {
    return (
      <main style={{ maxWidth: 420, margin: '40px auto', padding: 16, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 28 }}>Pilgrim</h1>

        <p style={{ marginTop: 12 }}>You are signed in as:</p>
        <p style={{ fontWeight: 'bold' }}>{user.email}</p>
        

        <hr style={{ margin: '24px 0' }} />

        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Start a journey</h2>

        <TripCreator
          userId={user.id}
          onCreated={async () => {
            setTripFilter('active');
            await loadTrips(user.id, 'active');
          }}
        />

        <hr style={{ margin: '24px 0' }} />

        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Your journeys</h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button
            onClick={() => setTripFilter('active')}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.18)',
              background: tripFilter === 'active' ? 'rgba(0,0,0,0.06)' : 'transparent',
              cursor: 'pointer',
            }}
          >
            Active
          </button>

          <button
            onClick={() => setTripFilter('ended')}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.18)',
              background: tripFilter === 'ended' ? 'rgba(0,0,0,0.06)' : 'transparent',
              cursor: 'pointer',
            }}
          >
            Completed
          </button>
        </div>

        {loadingTrips ? <p>Loading trips…</p> : null}

        {!loadingTrips && trips.length === 0 ? (
          <p>{tripFilter === 'active' ? 'No active journeys yet.' : 'No completed journeys yet.'}</p>
        ) : null}

        {trips.length > 0 ? (
          <ul>
            {trips.map((t) => (
              <li key={t.id} style={{ marginBottom: 6 }}>
                <a href={`/trip/${t.id}`}>{t.title}</a>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 420, margin: '40px auto', padding: 16, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Sign in to Pilgrim</h1>

      <p style={{ marginTop: 0, marginBottom: 20, opacity: 0.85 }}>
        We’ll email you a secure sign-in link.  
        This keeps Pilgrim simple and private — no passwords to remember.
      </p>

      <form onSubmit={signInWithEmail}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: '100%',
              padding: 10,
              marginTop: 6,
              borderRadius: 8,
              border: '1px solid #ccc',
            }}
            placeholder="you@example.com"
          />
        </label>

        <button
          type="submit"
          disabled={status === 'sending'}
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 10,
            border: 'none',
            cursor: status === 'sending' ? 'default' : 'pointer',
          }}
        >
          {status === 'sending' ? 'Sending sign-in link…' : 'Email me a sign-in link'}
        </button>

        <p style={{ marginTop: 12, fontSize: 14, opacity: 0.7 }}>
          If you’ve used Pilgrim before, this will just sign you back in.
        </p>
      </form>

      {message ? <p style={{ marginTop: 16 }}>{message}</p> : null}
    </main>
  );
}

function TripCreator({ userId, onCreated }: { userId: string; onCreated?: () => void }) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  async function createTrip(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg('');

    const { error } = await supabase.from('trips').insert({
      owner_id: userId,
      title,
      status: 'active',
    });

    if (error) {
      setMsg(`Error: ${error.message}`);
      setSaving(false);
      return;
    }

    setMsg('Trip created.');
    setTitle('');
    setSaving(false);

    onCreated?.();
  }

  return (
    <form onSubmit={createTrip}>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Journey name
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          style={{
            width: '100%',
            padding: 10,
            marginTop: 6,
            borderRadius: 8,
            border: '1px solid #ccc',
          }}
          placeholder="e.g. Pyrenees 2026"
        />
      </label>

      <button
        type="submit"
        disabled={saving}
        style={{
  padding: 12,
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.18)',
  background: 'rgba(0,0,0,0.04)',
  cursor: saving ? 'default' : 'pointer',
  width: '100%',
}}

      >
        {saving ? 'Creating…' : 'Start a journey'}
      </button>

      {msg ? <p style={{ marginTop: 12 }}>{msg}</p> : null}
    </form>
  );
}
