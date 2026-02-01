'use client';

import dynamic from 'next/dynamic';

const MapSection = dynamic(() => import('./MapSection'), {
  ssr: false,
  loading: () => <p>Loading map…</p>,
});

export default MapSection;
