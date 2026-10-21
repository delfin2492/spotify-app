import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getValidAccessToken } from '@/lib/auth';

export async function GET(req: Request) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const playlistId = searchParams.get('id');
  const albumId = searchParams.get('albumId');

  try {
    if (playlistId) {
      const res = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        return NextResponse.json({ error: 'Failed to fetch playlist' }, { status: res.status });
      }
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (albumId) {
      const res = await fetch(`https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        return NextResponse.json({ error: 'Failed to fetch album' }, { status: res.status });
      }
      const data = await res.json();
      return NextResponse.json(data);
    }

    // Fetch current user's playlists
    const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch playlists' }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ items: data.items || [] });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, name, description, isPublic, playlistId, uris } = body;

    if (action === 'create') {
      // Get current user ID first
      const meRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!meRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch user profile' }, { status: meRes.status });
      }
      const me = await meRes.json();

      const createRes = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(me.id)}/playlists`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name || 'Playlist Baru',
          description: description || 'Dibuat dari Vantara Music Platform',
          public: isPublic ?? false,
        }),
      });

      const created = await createRes.json();
      return NextResponse.json(created, { status: createRes.status });
    }

    if (action === 'add-tracks' && playlistId && uris) {
      const addRes = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: Array.isArray(uris) ? uris : [uris],
        }),
      });

      const added = await addRes.json();
      return NextResponse.json(added, { status: addRes.status });
    }

    return NextResponse.json({ error: 'Invalid playlist action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { playlistId, uri } = body;

    if (!playlistId || !uri) {
      return NextResponse.json({ error: 'Missing playlistId or uri' }, { status: 400 });
    }

    const delRes = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tracks: [{ uri }],
      }),
    });

    const data = await delRes.json();
    return NextResponse.json(data, { status: delRes.status });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
