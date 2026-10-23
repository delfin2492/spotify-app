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
  const mode = searchParams.get('mode');

  try {
    if (playlistId) {
      const cleanId = (playlistId || '')
        .replace(/^spotify:playlist:/, '')
        .replace(/^https:\/\/open\.spotify\.com\/playlist\//, '')
        .split('?')[0]
        .trim();

      const res = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(cleanId)}?market=ID`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        return NextResponse.json({ error: 'Failed to fetch playlist' }, { status: res.status });
      }
      const data = await res.json();

      // Spotify API normalization: `tracks.items` or fallback to `/tracks` endpoint
      let rawItems = data.tracks?.items || data.items?.items || [];
      if (rawItems.length === 0) {
        const tracksRes = await fetch(
          `https://api.spotify.com/v1/playlists/${encodeURIComponent(cleanId)}/tracks?limit=100&market=ID`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
          }
        );
        if (tracksRes.ok) {
          const tracksData = await tracksRes.json();
          rawItems = tracksData.items || [];
        }
      }

      const normalizedItems = rawItems
        .map((entry: any) => ({
          ...entry,
          track: entry.track || entry.item || null,
        }))
        .filter((entry: any) => entry.track);

      return NextResponse.json({
        ...data,
        tracks: {
          total: data.tracks?.total ?? data.items?.total ?? normalizedItems.length,
          items: normalizedItems,
        },
      });
    }

    if (albumId) {
      const cleanAlbumId = (albumId || '')
        .replace(/^spotify:album:/, '')
        .replace(/^https:\/\/open\.spotify\.com\/album\//, '')
        .split('?')[0]
        .trim();

      const res = await fetch(`https://api.spotify.com/v1/albums/${encodeURIComponent(cleanAlbumId)}?market=ID`, {
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
    const normalizedPlaylists = (data.items || []).map((pl: any) => ({
      ...pl,
      tracks: pl.tracks || pl.items || { total: 0 },
    }));

    return NextResponse.json({ items: normalizedPlaylists });
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
      const payload = JSON.stringify({
        name: name || 'Playlist Baru',
        description: description || 'Dibuat dari Vantara Music Platform',
        public: isPublic ?? false,
      });

      // Spotify 2026 API: Use POST /v1/me/playlists instead of deprecated /v1/users/{id}/playlists
      let createRes = await fetch('https://api.spotify.com/v1/me/playlists', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });

      // Fallback if needed
      if (createRes.status === 404 || createRes.status === 405) {
        const meRes = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          createRes = await fetch(
            `https://api.spotify.com/v1/users/${encodeURIComponent(me.id)}/playlists`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: payload,
            }
          );
        }
      }

      const text = await createRes.text();
      let created: any = {};
      try {
        created = JSON.parse(text);
      } catch {
        created = { message: text };
      }

      if (!createRes.ok) {
        console.error('Create playlist failed:', createRes.status, text);
      }

      return NextResponse.json(created, { status: createRes.status });
    }

    if (action === 'add-tracks' && playlistId && uris) {
      const uriList = Array.isArray(uris) ? uris : [uris];

      // Spotify 2026 API: Try /items first, then fallback to /tracks
      let addRes = await fetch(
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: uriList }),
        }
      );

      if (!addRes.ok) {
        addRes = await fetch(
          `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ uris: uriList }),
          }
        );
      }

      const text = await addRes.text();
      let added: any = {};
      try {
        added = JSON.parse(text);
      } catch {
        added = { message: text };
      }
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

    // Spotify 2026 API: Try /items first, then fallback to /tracks
    let delRes = await fetch(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tracks: [{ uri }],
          items: [{ uri }],
        }),
      }
    );

    if (!delRes.ok) {
      delRes = await fetch(
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tracks: [{ uri }],
          }),
        }
      );
    }

    const text = await delRes.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
    return NextResponse.json(data, { status: delRes.status });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
