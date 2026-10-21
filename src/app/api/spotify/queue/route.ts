import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getValidAccessToken } from '@/lib/auth';

export async function GET() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/queue', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ currently_playing: null, queue: [] });
    }

    const data = await res.json();
    return NextResponse.json({
      currently_playing: data.currently_playing || null,
      queue: data.queue || [],
    });
  } catch (error) {
    return NextResponse.json({ currently_playing: null, queue: [] }, { status: 500 });
  }
}
