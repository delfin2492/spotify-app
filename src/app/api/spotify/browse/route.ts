import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getValidAccessToken } from '@/lib/auth';

export async function GET(req: Request) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'home';

  try {
    if (section === 'liked') {
      const likedRes = await fetch('https://api.spotify.com/v1/me/tracks?limit=50', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (!likedRes.ok) {
        return NextResponse.json({ items: [] });
      }
      const likedData = await likedRes.json();
      return NextResponse.json({
        items: (likedData.items || []).map((item: any) => ({
          added_at: item.added_at,
          track: item.track,
        })),
        total: likedData.total || 0,
      });
    }

    // Fetch Top Tracks & Recently Played in parallel for Home dashboard
    const [topRes, recentRes, meRes] = await Promise.all([
      fetch('https://api.spotify.com/v1/me/top/tracks?limit=12&time_range=short_term', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }),
      fetch('https://api.spotify.com/v1/me/player/recently-played?limit=12', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }),
      fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }),
    ]);

    const topData = topRes.ok ? await topRes.json() : { items: [] };
    const recentData = recentRes.ok ? await recentRes.json() : { items: [] };
    const meData = meRes.ok ? await meRes.json() : null;

    // Deduplicate recently played tracks by track ID
    const seenIds = new Set<string>();
    const recentTracks: any[] = [];
    for (const item of recentData.items || []) {
      if (item.track && !seenIds.has(item.track.id)) {
        seenIds.add(item.track.id);
        recentTracks.push(item.track);
      }
    }

    return NextResponse.json({
      topTracks: topData.items || [],
      recentTracks,
      profile: meData,
      accessToken, // Useful for initializing Web Playback SDK in browser
    });
  } catch (error) {
    return NextResponse.json({ topTracks: [], recentTracks: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { trackId, action } = await req.json();
    if (!trackId) return NextResponse.json({ error: 'Missing trackId' }, { status: 400 });

    const res = await fetch(`https://api.spotify.com/v1/me/tracks?ids=${encodeURIComponent(trackId)}`, {
      method: action === 'remove' ? 'DELETE' : 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    return NextResponse.json({ success: res.ok }, { status: res.ok ? 200 : res.status });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
