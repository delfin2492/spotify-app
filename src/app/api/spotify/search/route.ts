import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getValidAccessToken } from '@/lib/auth';

export async function GET(req: Request) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  const type = searchParams.get('type') || 'track,artist,album,playlist';
  const limit = searchParams.get('limit') || '20';

  if (!q || !q.trim()) {
    return NextResponse.json({ tracks: [], artists: [], albums: [], playlists: [] });
  }

  try {
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to search Spotify' }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({
      tracks: data.tracks?.items || [],
      artists: data.artists?.items || [],
      albums: data.albums?.items || [],
      playlists: data.playlists?.items?.filter(Boolean) || [],
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
