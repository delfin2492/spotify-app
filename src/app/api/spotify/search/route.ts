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
  // Spotify 2026 API update caps /v1/search limit to max 10 in Development Mode
  const rawLimit = parseInt(searchParams.get('limit') || '10', 10);
  const limit = Math.min(Math.max(rawLimit, 1), 10);

  if (!q || !q.trim()) {
    return NextResponse.json({ tracks: [], artists: [], albums: [], playlists: [] });
  }

  try {
    let res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(q.trim())}&type=${encodeURIComponent(type)}&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      }
    );

    // Fallback to track-only search if multi-type search is restricted
    if (!res.ok) {
      res = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(q.trim())}&type=track&limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          cache: 'no-store',
        }
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error('Spotify Search Error:', res.status, errText);
      return NextResponse.json(
        { error: 'Failed to search Spotify', details: errText },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      tracks: data.tracks?.items?.filter(Boolean) || [],
      artists: data.artists?.items?.filter(Boolean) || [],
      albums: data.albums?.items?.filter(Boolean) || [],
      playlists: data.playlists?.items?.filter(Boolean) || [],
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
