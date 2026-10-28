import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getValidAccessToken } from '@/lib/auth';
import { getFallbackDeviceId } from '../control/route';

export interface QueuedTrackItem {
  queueId: string;
  id: string;
  uri: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string }[];
  };
  duration_ms: number;
}

function normalizeTrack(track: any, index: number = 0): QueuedTrackItem | null {
  if (!track || !track.uri) return null;
  const trackId = track.id || track.uri.split(':')[2] || '';
  return {
    queueId: `${trackId}-${index}-${track.uri}`,
    id: trackId,
    uri: track.uri,
    name: track.name || 'Unknown Track',
    artists: Array.isArray(track.artists)
      ? track.artists.map((a: any) => ({ name: a.name || String(a) }))
      : [{ name: String(track.artist || 'Spotify') }],
    album: {
      name: track.album?.name || '',
      images: Array.isArray(track.album?.images) ? track.album.images : [],
    },
    duration_ms: track.duration_ms || 0,
  };
}

/**
 * GET /api/spotify/queue
 * Ambil antrean langsung 100% dari Spotify Cloud API (Single Source of Truth)
 * Tidak lagi bergantung pada memori lokal atau /tmp sehingga TIDAK BERKEDIP di Vercel
 */
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

    if (res.status === 204 || !res.ok) {
      return NextResponse.json({
        currently_playing: null,
        queue: [],
        spotify_queue: [],
      });
    }

    const data = await res.json();
    const rawCurrentlyPlaying = data.currently_playing || null;
    const rawQueue = Array.isArray(data.queue) ? data.queue : [];

    const currentlyPlaying = rawCurrentlyPlaying ? normalizeTrack(rawCurrentlyPlaying, 0) : null;

    // Normalisasi antrean dan pastikan lagu yang sedang diputar tidak terduplikasi di antrean berikutnya
    const currentUri = currentlyPlaying?.uri;
    const currentId = currentlyPlaying?.id;

    const seenKeys = new Set<string>();
    if (currentUri) seenKeys.add(currentUri);
    if (currentId) seenKeys.add(currentId);

    const queue: QueuedTrackItem[] = [];
    rawQueue.forEach((item: any, idx: number) => {
      const normalized = normalizeTrack(item, idx + 1);
      if (normalized && !seenKeys.has(normalized.uri) && !seenKeys.has(normalized.id)) {
        seenKeys.add(normalized.uri);
        seenKeys.add(normalized.id);
        queue.push(normalized);
      }
    });

    return NextResponse.json({
      currently_playing: currentlyPlaying,
      queue,
      spotify_queue: queue,
    });
  } catch (error) {
    return NextResponse.json(
      { currently_playing: null, queue: [], spotify_queue: [] },
      { status: 200 }
    );
  }
}

/**
 * POST /api/spotify/queue
 * Tambahkan lagu langsung ke antrean resmi Spotify Cloud
 */
export async function POST(req: NextRequest) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { track, uri, position = 'bottom' } = body;
    const targetUri = uri || track?.uri;

    if (!targetUri) {
      return NextResponse.json({ error: 'Missing track URI' }, { status: 400 });
    }

    // 1. Cek antrean saat ini untuk mencegah lagu duplikat
    const queueRes = await fetch('https://api.spotify.com/v1/me/player/queue', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });

    let currentQueueUris: string[] = [];
    if (queueRes.ok) {
      const queueData = await queueRes.json();
      const currentTrackUri = queueData.currently_playing?.uri;
      const rawQueue = Array.isArray(queueData.queue) ? queueData.queue : [];
      currentQueueUris = rawQueue.map((t: any) => t?.uri).filter(Boolean);

      // Cek apakah lagu sedang diputar atau sudah ada di antrean
      if (currentTrackUri === targetUri) {
        return NextResponse.json(
          {
            error: 'Lagu ini sedang aktif diputar saat ini.',
            duplicate: true,
          },
          { status: 409 }
        );
      }

      if (currentQueueUris.includes(targetUri)) {
        return NextResponse.json(
          {
            error: 'Lagu ini sudah ada di dalam antrean.',
            duplicate: true,
          },
          { status: 409 }
        );
      }
    }

    // 2. Jika "top" (Putar Berikutnya / Masuk ke antrean paling atas):
    if (position === 'top') {
      try {
        const playerRes = await fetch('https://api.spotify.com/v1/me/player', {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        });

        if (playerRes.ok && playerRes.status !== 204) {
          const playerData = await playerRes.json();
          const playingUri = playerData.item?.uri;
          const progressMs = playerData.progress_ms || 0;
          const isPlaying = Boolean(playerData.is_playing);

          if (playingUri) {
            // Susun antrean baru: lagu aktif saat ini -> lagu target baru -> sisa antrean lama
            const remainingUris = currentQueueUris.filter((u) => u !== targetUri);
            const fullSequence = [playingUri, targetUri, ...remainingUris].slice(0, 100);

            const playRes = await fetch('https://api.spotify.com/v1/me/player/play', {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                uris: fullSequence,
                offset: { uri: playingUri },
                position_ms: isPlaying ? progressMs : 0,
              }),
            });

            if (playRes.ok || playRes.status === 204) {
              return NextResponse.json({ success: true, position: 'top' });
            }
          }
        }
      } catch {}
    }

    // 3. Posisi default ("bottom" / Tambah ke Antrean paling bawah):
    // Kirim ke endpoint resmi Spotify Queue: POST /v1/me/player/queue?uri=...
    let addRes = await fetch(
      `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(targetUri)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    // Jika 404 (tidak ada perangkat aktif), aktifkan perangkat Host dan ulangi
    if (addRes.status === 404) {
      const fallbackDeviceId = await getFallbackDeviceId(accessToken);
      if (fallbackDeviceId) {
        await fetch('https://api.spotify.com/v1/me/player', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            device_ids: [fallbackDeviceId],
            play: false,
          }),
        });

        await new Promise((r) => setTimeout(r, 450));

        addRes = await fetch(
          `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(targetUri)}&device_id=${encodeURIComponent(fallbackDeviceId)}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
      } else {
        return NextResponse.json(
          {
            error:
              'Tidak ada perangkat Spotify yang aktif. Silakan buka aplikasi Spotify di HP/Laptop Host terlebih dahulu.',
          },
          { status: 404 }
        );
      }
    }

    if (addRes.ok || addRes.status === 204) {
      return NextResponse.json({ success: true, position: position === 'top' ? 'top' : 'bottom' });
    }

    const errText = await addRes.text();
    return NextResponse.json(
      { error: errText || 'Gagal menambahkan lagu ke antrean Spotify' },
      { status: addRes.status }
    );
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * PUT /api/spotify/queue
 * Reorder atau sinkronkan antrean pemutar Spotify
 */
export async function PUT(req: NextRequest) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, queue, fromIndex, toIndex } = body;

    if (action === 'replace' && Array.isArray(queue)) {
      const uris = queue.map((t: any) => t?.uri).filter(Boolean).slice(0, 100);
      if (uris.length > 0) {
        await fetch('https://api.spotify.com/v1/me/player/play', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris }),
        });
      }
      return NextResponse.json({ success: true });
    }

    if ((action === 'move' || action === 'reorder') && Array.isArray(queue)) {
      let uris = queue.map((t: any) => t?.uri).filter(Boolean);
      if (
        action === 'move' &&
        typeof fromIndex === 'number' &&
        typeof toIndex === 'number' &&
        fromIndex >= 0 &&
        fromIndex < uris.length &&
        toIndex >= 0 &&
        toIndex < uris.length
      ) {
        const [moved] = uris.splice(fromIndex, 1);
        uris.splice(toIndex, 0, moved);
      }

      // Dapatkan lagu yang sedang aktif diputar agar audio TIDAK terpotong saat reorder
      try {
        const playerRes = await fetch('https://api.spotify.com/v1/me/player', {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        });

        if (playerRes.ok && playerRes.status !== 204) {
          const playerData = await playerRes.json();
          const playingUri = playerData.item?.uri;
          const progressMs = playerData.progress_ms || 0;
          const isPlaying = Boolean(playerData.is_playing);

          if (playingUri) {
            const queueWithoutCurrent = uris.filter((u: string) => u !== playingUri);
            const fullSequence = [playingUri, ...queueWithoutCurrent].slice(0, 100);

            await fetch('https://api.spotify.com/v1/me/player/play', {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                uris: fullSequence,
                offset: { uri: playingUri },
                position_ms: isPlaying ? progressMs : 0,
              }),
            });
            return NextResponse.json({ success: true });
          }
        }
      } catch {}

      if (uris.length > 0) {
        await fetch('https://api.spotify.com/v1/me/player/play', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: uris.slice(0, 100) }),
        });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update queue' }, { status: 500 });
  }
}

/**
 * DELETE /api/spotify/queue
 * Hapus lagu dari antrean pemutar Spotify
 */
export async function DELETE(req: NextRequest) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { index, remainingQueue } = body;

    // Jika diberikan sisa antrean, update pemutar Spotify langsung dengan sisa lagu tersebut
    if (Array.isArray(remainingQueue)) {
      const uris = remainingQueue.map((t: any) => t?.uri).filter(Boolean).slice(0, 100);
      if (uris.length > 0) {
        await fetch('https://api.spotify.com/v1/me/player/play', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris }),
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete from queue' }, { status: 500 });
  }
}
