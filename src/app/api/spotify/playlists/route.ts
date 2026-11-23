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

      // Helper fallback: extract public playlist tracks from Spotify Embed when Web API Development Mode hides third-party/editorial playlist items
      const fetchPlaylistFromEmbed = async (id: string, fallbackMeta?: any) => {
        try {
          const embedRes = await fetch(`https://open.spotify.com/embed/playlist/${encodeURIComponent(id)}`, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            },
            cache: 'no-store',
          });
          if (!embedRes.ok) return null;
          const html = await embedRes.text();
          const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
          if (!match?.[1]) return null;

          const nextData = JSON.parse(match[1]);
          const entity = nextData?.props?.pageProps?.state?.data?.entity;
          if (!entity) return null;

          const coverImages = Array.isArray(entity.coverArt?.sources)
            ? entity.coverArt.sources.map((s: any) => ({ url: s.url }))
            : [];
          const defaultImages =
            Array.isArray(fallbackMeta?.images) && fallbackMeta.images.length > 0
              ? fallbackMeta.images
              : coverImages;
          const playlistTitle = fallbackMeta?.name || entity.title || entity.name || 'Spotify Playlist';

          const trackList = Array.isArray(entity.trackList) ? entity.trackList : [];
          const items = trackList
            .map((item: any, idx: number) => {
              const uri = item?.uri || '';
              const trackId = uri.startsWith('spotify:track:') ? uri.split(':')[2] : item?.uid || `track-${idx}`;
              if (!item?.title && !uri) return null;
              const artistNames = (item.subtitle || 'Spotify')
                .replace(/\u00a0/g, ' ')
                .split(/,\s*/)
                .map((s: string) => s.trim())
                .filter(Boolean);

              return {
                added_at: null,
                track: {
                  id: trackId,
                  uri: uri || `spotify:track:${trackId}`,
                  name: item.title || 'Unknown Track',
                  artists: artistNames.length > 0 ? artistNames.map((name: string) => ({ name })) : [{ name: 'Spotify' }],
                  album: {
                    name: playlistTitle,
                    images: defaultImages,
                  },
                  duration_ms: item.duration || 0,
                },
              };
            })
            .filter(Boolean);

          return {
            id: fallbackMeta?.id || entity.id || id,
            name: playlistTitle,
            description: fallbackMeta?.description || '',
            uri: fallbackMeta?.uri || entity.uri || `spotify:playlist:${id}`,
            images: defaultImages,
            owner: fallbackMeta?.owner || {
              display_name: entity.subtitle || 'Spotify',
            },
            tracks: {
              total: items.length,
              items,
            },
          };
        } catch {
          return null;
        }
      };

      let res = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(cleanId)}?market=ID`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        res = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(cleanId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        });
      }
      if (!res.ok) {
        const embedFallback = await fetchPlaylistFromEmbed(cleanId);
        if (embedFallback) {
          return NextResponse.json(embedFallback);
        }
        return NextResponse.json({ error: 'Failed to fetch playlist' }, { status: res.status });
      }
      const data = await res.json();

      const extractNormalizedItems = (list: any[]) => {
        if (!Array.isArray(list)) return [];
        return list
          .map((entry: any) => {
            if (!entry) return null;
            const trackObj =
              entry.track ||
              entry.item ||
              (entry.id && entry.name && (entry.uri || entry.artists) ? entry : null);
            if (!trackObj || (!trackObj.id && !trackObj.uri && !trackObj.name)) return null;
            return {
              ...entry,
              track: trackObj,
            };
          })
          .filter(Boolean);
      };

      // Check all possible item containers from GET /v1/playlists/{id} (both 2026 `items` and legacy `tracks`)
      const candidateLists = [
        data.items?.items,
        data.tracks?.items,
        Array.isArray(data.items) ? data.items : null,
        Array.isArray(data.tracks) ? data.tracks : null,
      ];

      let normalizedItems: any[] = [];
      for (const candidate of candidateLists) {
        if (Array.isArray(candidate) && candidate.length > 0) {
          const extracted = extractNormalizedItems(candidate);
          if (extracted.length > 0) {
            normalizedItems = extracted;
            break;
          }
        }
      }

      // Fallback 1: explicitly fetch playlist items via Spotify 2026 `/items` endpoint, then legacy `/tracks`
      if (normalizedItems.length === 0) {
        const fallbackUrls = [
          `https://api.spotify.com/v1/playlists/${encodeURIComponent(cleanId)}/items?limit=50&market=ID`,
          `https://api.spotify.com/v1/playlists/${encodeURIComponent(cleanId)}/items?limit=50`,
          `https://api.spotify.com/v1/playlists/${encodeURIComponent(cleanId)}/tracks?limit=50&market=ID`,
          `https://api.spotify.com/v1/playlists/${encodeURIComponent(cleanId)}/tracks?limit=50`,
        ];

        for (const url of fallbackUrls) {
          try {
            const fallbackRes = await fetch(url, {
              headers: { Authorization: `Bearer ${accessToken}` },
              cache: 'no-store',
            });
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              const rawList =
                fallbackData.items ||
                fallbackData.tracks?.items ||
                (Array.isArray(fallbackData) ? fallbackData : []);
              const extracted = extractNormalizedItems(rawList);
              if (extracted.length > 0) {
                normalizedItems = extracted;
                break;
              }
            }
          } catch {}
        }
      }

      // Fallback 2: If Spotify Web API returns 0 tracks because the playlist belongs to another user or Spotify Editorial (Development Mode restriction), extract tracks from Spotify Embed
      if (normalizedItems.length === 0) {
        const embedFallback = await fetchPlaylistFromEmbed(cleanId, data);
        if (embedFallback && embedFallback.tracks.items.length > 0) {
          normalizedItems = embedFallback.tracks.items;
        }
      }

      const totalCount =
        Math.max(data.tracks?.total ?? 0, data.items?.total ?? 0, normalizedItems.length);

      return NextResponse.json({
        ...data,
        tracks: {
          total: totalCount,
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
