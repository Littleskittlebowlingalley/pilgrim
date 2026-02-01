'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseBrowser';

type Moment = {
  id: string;
  trip_id: string;
  user_id: string;
  text: string;
  photo_path: string | null;
  created_at: string;
};

function randomId() {
  return crypto.randomUUID();
}

function calmErrorMessage(e: any) {
  const raw = (e?.message ?? '').toString();
  const msg = raw.toLowerCase();

  if (
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('network') ||
    msg.includes('fetcherror') ||
    msg.includes('the internet connection appears to be offline')
  ) {
    return 'Couldn’t reach the network. Your moment is still here — try again when you have signal.';
  }

  return raw || 'Something went wrong while saving.';
}

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

function getBrowserLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function MomentsSection({
  tripId,
  mode = 'both',
  onSaved,
  disabled = false,
  disabledReason = 'This journey is completed. You can still read moments, but you can’t add new ones.',
  embedded = false,
}: {
  tripId: string;
  mode?: 'compose' | 'list' | 'both';
  onSaved?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  embedded?: boolean;
}) {
  const showCompose = mode === 'compose' || mode === 'both';
  const showList = mode === 'list' || mode === 'both';

  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<string>('');

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const savedTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function clearSavedTimer() {
    if (savedTimerRef.current) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  }

  function showSavedBriefly() {
    clearSavedTimer();
    savedTimerRef.current = window.setTimeout(() => {
      setSaveStatus('idle');
      setSaveMessage('');
      savedTimerRef.current = null;
    }, 2500);
  }

  async function loadMoments(currentTripId: string) {
    setLoading(true);
    setListError('');

    const { data, error } = await supabase
      .from('moments')
      .select('id, trip_id, user_id, text, photo_path, created_at')
      .eq('trip_id', currentTripId)
      .order('created_at', { ascending: false });

    if (error) {
      setListError(error.message);
      setMoments([]);
    } else {
      setMoments((data ?? []) as Moment[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!tripId) return;
    if (!showList) return;
    loadMoments(tripId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, mode]);

  // Cleanup timer + preview blob URL
  useEffect(() => {
    return () => {
      clearSavedTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onFileSelected(next: File | null) {
    setFile(next);
    setUploadedPhotoUrl(null);

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (next) {
      const url = URL.createObjectURL(next);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }

  function removeSelectedPhoto() {
    setFile(null);
    setUploadedPhotoUrl(null);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function uploadPhotoIfAny(userId: string): Promise<string | null> {
    if (uploadedPhotoUrl) return uploadedPhotoUrl;
    if (!file) return null;

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${userId}/${tripId}/${randomId()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from('moments').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('moments').getPublicUrl(path);
    setUploadedPhotoUrl(data.publicUrl);
    return data.publicUrl;
  }

  async function addMoment() {
    if (disabled) return;

    const trimmed = text.trim();

    setListError('');
    setSaveMessage('');

    if (!trimmed && !file && !uploadedPhotoUrl) {
      setSaveStatus('error');
      setSaveMessage('Add a few words or a photo.');
      return;
    }

    setSaveStatus('saving');
    setSaveMessage('Saving…');

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const userId = userData.user?.id;
      if (!userId) {
        setSaveStatus('error');
        setSaveMessage('Please sign in to add a moment.');
        return;
      }

      const photoUrl = await uploadPhotoIfAny(userId);

      const { data: inserted, error: insertError } = await supabase
        .from('moments')
        .insert({
          trip_id: tripId,
          user_id: userId,
          text: trimmed || '',
          photo_path: photoUrl,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      const newMomentId = inserted.id as string;

      // Best-effort footprint (never block saving a moment)
      try {
        const loc = await getBrowserLocation();
        if (loc) {
          const placeText = await reverseGeocode(loc.lat, loc.lng);

          await supabase.from('posts').insert({
            trip_id: tripId,
            type: 'breadcrumb',
            lat: loc.lat,
            lng: loc.lng,
            accuracy_m: loc.accuracy,
            text: null,
            place_text: placeText,
            moment_id: newMomentId,
          });
        }
      } catch {
        // ignore
      }

      setText('');
      removeSelectedPhoto();

      setSaveStatus('saved');
      setSaveMessage('Saved ✓');
      showSavedBriefly();

      if (showList) await loadMoments(tripId);
      onSaved?.();
    } catch (e: any) {
      setSaveStatus('error');
      setSaveMessage(calmErrorMessage(e));
    }
  }

  function startEdit(m: Moment) {
    setListError('');
    setEditingId(m.id);
    setEditText(m.text ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  async function saveEdit(m: Moment) {
    const trimmed = editText.trim();
    if (!trimmed) {
      setListError('Moment text cannot be empty.');
      return;
    }

    setSavingEdit(true);
    setListError('');

    try {
      const { error: updErr } = await supabase.from('moments').update({ text: trimmed }).eq('id', m.id);
      if (updErr) throw updErr;

      cancelEdit();

      if (showList) await loadMoments(tripId);
      onSaved?.();
    } catch (e: any) {
      setListError(e?.message ?? 'Edit failed.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteMoment(m: Moment) {
    const ok = window.confirm('Delete this moment? (Its linked footprint will also be removed.)');
    if (!ok) return;

    setDeletingId(m.id);
    setListError('');

    try {
      const { error: fpErr } = await supabase.from('posts').delete().eq('moment_id', m.id);
      if (fpErr) throw fpErr;

      const { error: mErr } = await supabase.from('moments').delete().eq('id', m.id);
      if (mErr) throw mErr;

      if (editingId === m.id) cancelEdit();

      if (showList) await loadMoments(tripId);
      onSaved?.();
    } catch (e: any) {
      setListError(e?.message ?? 'Delete failed.');
    } finally {
      setDeletingId(null);
    }
  }

  const hasPhoto = !!file || !!uploadedPhotoUrl;

  // IMPORTANT: This is JSX-in-a-variable (stable). Not a component defined inline (unstable).
  const composeContent = (
    <>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Add a moment</h3>

      {disabled ? <p style={{ marginTop: 0, marginBottom: 10, opacity: 0.8 }}>{disabledReason}</p> : null}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="What happened?"
        disabled={disabled || saveStatus === 'saving'}
        style={{
          width: '100%',
          padding: 10,
          borderRadius: 10,
          border: '1px solid rgba(0,0,0,0.18)',
          fontFamily: 'inherit',
          opacity: disabled ? 0.6 : 1,
          resize: 'none',
          overflowY: 'auto',
          fontSize: 16,
          lineHeight: '1.4',
        }}
      />

      <div style={{ marginTop: 10, opacity: disabled ? 0.6 : 1 }}>
        <div style={{ fontSize: 14, marginBottom: 6, opacity: 0.85 }}>Add a photo</div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          disabled={disabled || saveStatus === 'saving'}
          onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
        />

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Selected photo preview"
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                objectFit: 'cover',
                border: '1px solid rgba(0,0,0,0.12)',
              }}
            />
          ) : null}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || saveStatus === 'saving'}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.18)',
              background: 'transparent',
              cursor: disabled || saveStatus === 'saving' ? 'default' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              fontSize: 14,
            }}
          >
            {hasPhoto ? 'Change photo' : 'Add photo'}
          </button>

          {hasPhoto && !disabled ? (
            <button
              type="button"
              onClick={removeSelectedPhoto}
              disabled={saveStatus === 'saving'}
              style={{
                padding: '8px 10px',
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.18)',
                background: 'transparent',
                cursor: saveStatus === 'saving' ? 'default' : 'pointer',
                opacity: saveStatus === 'saving' ? 0.6 : 0.9,
                fontSize: 14,
              }}
            >
              Remove photo
            </button>
          ) : null}

          {file ? (
            <div
              style={{
                fontSize: 13,
                opacity: 0.55,
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {file.name}
            </div>
          ) : null}
        </div>
      </div>

      <button
        onClick={addMoment}
        disabled={disabled || saveStatus === 'saving'}
        style={{
          marginTop: 10,
          padding: 10,
          borderRadius: 10,
          border: '1px solid rgba(0,0,0,0.18)',
          background: 'rgba(0,0,0,0.04)',
          cursor: disabled || saveStatus === 'saving' ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          width: '100%',
        }}
      >
        {saveStatus === 'saving' ? 'Saving…' : 'Save moment'}
      </button>

      {saveMessage ? (
        <p style={{ marginTop: 10, opacity: saveStatus === 'error' ? 0.95 : 0.8 }} aria-live="polite">
          {saveMessage}
        </p>
      ) : null}
    </>
  );

  return (
    <>
      {showCompose ? (
        embedded ? (
          composeContent
        ) : (
          <section
            style={{
              border: '1px solid rgba(0,0,0,0.12)',
              borderRadius: 12,
              padding: 12,
              marginTop: 12,
            }}
          >
            {composeContent}
          </section>
        )
      ) : null}

      {showList ? (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Moments</h3>

          {loading ? <p>Loading moments…</p> : null}
          {listError ? <p style={{ opacity: 0.95 }}>{listError}</p> : null}

          {!loading && !listError && moments.length === 0 ? <p>No moments yet.</p> : null}

          {moments.length > 0 ? (
            <ul style={{ paddingLeft: 18 }}>
              {moments.map((m) => {
                const isEditing = editingId === m.id;

                return (
                  <li key={m.id} style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        alignItems: 'baseline',
                      }}
                    >
                      <div>{new Date(m.created_at).toLocaleString()}</div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        {!isEditing ? (
                          <button
                            onClick={() => startEdit(m)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 10,
                              border: '1px solid rgba(0,0,0,0.18)',
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          >
                            Edit
                          </button>
                        ) : null}

                        <button
                          onClick={() => deleteMoment(m)}
                          disabled={deletingId === m.id}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 10,
                            border: '1px solid rgba(0,0,0,0.18)',
                            background: 'transparent',
                            cursor: deletingId === m.id ? 'default' : 'pointer',
                            opacity: deletingId === m.id ? 0.6 : 1,
                          }}
                        >
                          {deletingId === m.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </div>

                    {!isEditing ? (
                      <>
                        {m.text ? <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.text}</div> : null}

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
                      </>
                    ) : (
                      <div style={{ marginTop: 8 }}>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={4}
                          disabled={savingEdit}
                          style={{
                            width: '100%',
                            padding: 10,
                            borderRadius: 10,
                            border: '1px solid rgba(0,0,0,0.18)',
                            fontFamily: 'inherit',
                            opacity: savingEdit ? 0.7 : 1,
                          }}
                        />

                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button
                            onClick={() => saveEdit(m)}
                            disabled={savingEdit}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 10,
                              border: 'none',
                              cursor: savingEdit ? 'default' : 'pointer',
                            }}
                          >
                            {savingEdit ? 'Saving…' : 'Save'}
                          </button>

                          <button
                            onClick={cancelEdit}
                            disabled={savingEdit}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(0,0,0,0.18)',
                              background: 'transparent',
                              cursor: savingEdit ? 'default' : 'pointer',
                              opacity: savingEdit ? 0.6 : 1,
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
