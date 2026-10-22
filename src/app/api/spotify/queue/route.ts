import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getValidAccessToken } from '@/lib/auth';
import { tokenCache, QueuedTrackItem } from '@/lib/spotify-cache';

function normalizeTrackToQueueItem(track: any): QueuedTrackItem | null {
  if (!track || !track.uri) return null;
  return {
    queueId: track.queueId || `${track.id || 't'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    id: track.id || track.uri.split(':')[2] || '',
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
 * Fetch track metadata from Spotify API if only a URI was provided
 */
async function fetchTrackByUri(accessToken: string, uri: string): Promise<QueuedTrackItem | null> {
  const parts = uri.split(':');
  const trackId = parts.length >= 3 ? parts[2] : uri;
  if (!trackId) return null;

  try {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const track = await res.json();
    return normalizeTrackToQueueItem(track);
  } catch {
    return null;
  }
}

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

    let currentlyPlaying: any = null;
    let spotifyQueue: any[] = [];

    if (res.ok) {
      const data = await res.json();
      currentlyPlaying = data.currently_playing || null;
      spotifyQueue = data.queue || [];
    }

    // Seed customQueue from Spotify's queue on first load if not yet initialized
    if (!tokenCache.customQueueInitialized && spotifyQueue.length > 0) {
      tokenCache.customQueue = spotifyQueue
        .map((t: any) => normalizeTrackToQueueItem(t))
        .filter((t): t is QueuedTrackItem => t !== null);
      tokenCache.customQueueInitialized = true;
    }

    // If the currently playing song matches the first item in customQueue (e.g. Spotify naturally advanced to the next song), pop it automatically
    if (
      currentlyPlaying?.uri &&
      tokenCache.customQueue.length > 0 &&
      tokenCache.customQueue[0].uri === currentlyPlaying.uri
    ) {
      tokenCache.customQueue.shift();
    }

    return NextResponse.json({
      currently_playing: currentlyPlaying,
      queue: tokenCache.customQueue,
    });
  } catch (error) {
    return NextResponse.json(
      { currently_playing: null, queue: tokenCache.customQueue || [] },
      { status: 200 }
    );
  }
}

/**
 * POST /api/spotify/queue
 * Create / Add a song (or multiple songs) to the Managed Queue (top or bottom)
 */
export async function POST(req: NextRequest) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { track, uri, position = 'bottom' } = body;

    tokenCache.customQueueInitialized = true;

    let item: QueuedTrackItem | null = null;
    if (track && track.uri) {
      item = normalizeTrackToQueueItem(track);
    } else if (uri) {
      item = await fetchTrackByUri(accessToken, uri);
    }

    if (!item) {
      return NextResponse.json({ error: 'Invalid track data' }, { status: 400 });
    }

    if (position === 'top' || position === 'next') {
      tokenCache.customQueue.unshift(item);
    } else {
      tokenCache.customQueue.push(item);
    }

    return NextResponse.json({
      success: true,
      item,
      queue: tokenCache.customQueue,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add to queue' }, { status: 500 });
  }
}

/**
 * PUT /api/spotify/queue
 * Update / Reorder / Replace / Move items in the Managed Queue
 * Supported actions:
 * - { action: 'move', fromIndex: number, toIndex: number }
 * - { action: 'replace', queue: any[] }
 * - { action: 'deduplicate' }
 * - { action: 'sync-from-spotify' }
 */
export async function PUT(req: NextRequest) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, fromIndex, toIndex, queue } = body;

    tokenCache.customQueueInitialized = true;

    if (action === 'move' && typeof fromIndex === 'number' && typeof toIndex === 'number') {
      if (
        fromIndex >= 0 &&
        fromIndex < tokenCache.customQueue.length &&
        toIndex >= 0 &&
        toIndex < tokenCache.customQueue.length
      ) {
        const [moved] = tokenCache.customQueue.splice(fromIndex, 1);
        tokenCache.customQueue.splice(toIndex, 0, moved);
      }
    } else if (action === 'replace' && Array.isArray(queue)) {
      tokenCache.customQueue = queue
        .map((t: any) => normalizeTrackToQueueItem(t))
        .filter((t): t is QueuedTrackItem => t !== null);
    } else if (action === 'deduplicate') {
      const seen = new Set<string>();
      tokenCache.customQueue = tokenCache.customQueue.filter((item) => {
        if (seen.has(item.uri)) return false;
        seen.add(item.uri);
        return true;
      });
    } else if (action === 'sync-from-spotify') {
      const res = await fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        tokenCache.customQueue = (data.queue || [])
          .map((t: any) => normalizeTrackToQueueItem(t))
          .filter((t: QueuedTrackItem | null): t is QueuedTrackItem => t !== null);
      }
    }

    return NextResponse.json({
      success: true,
      queue: tokenCache.customQueue,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update queue' }, { status: 500 });
  }
}

/**
 * DELETE /api/spotify/queue
 * Delete a specific item (by queueId or index) or clear the entire queue
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { queueId, index, clearAll } = body;

    tokenCache.customQueueInitialized = true;

    if (clearAll) {
      tokenCache.customQueue = [];
    } else if (queueId) {
      tokenCache.customQueue = tokenCache.customQueue.filter((it) => it.queueId !== queueId);
    } else if (typeof index === 'number' && index >= 0 && index < tokenCache.customQueue.length) {
      tokenCache.customQueue.splice(index, 1);
    }

    return NextResponse.json({
      success: true,
      queue: tokenCache.customQueue,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete from queue' }, { status: 500 });
  }
}
