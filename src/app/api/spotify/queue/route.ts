import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getValidAccessToken } from '@/lib/auth';
import {
  QueuedTrackItem,
  loadPersistedQueue,
  savePersistedQueue,
} from '@/lib/spotify-cache';

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

  const persisted = loadPersistedQueue();
  let customQueue = persisted.queue;

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
      spotifyQueue = Array.isArray(data.queue) ? data.queue : [];
    }

    // If customQueue is empty but Spotify has upcoming tracks from current context,
    // adopt Spotify's native queue so all users immediately share the active queue session
    if (customQueue.length === 0 && spotifyQueue.length > 0) {
      customQueue = spotifyQueue
        .map((t: any) => normalizeTrackToQueueItem(t))
        .filter((t: QueuedTrackItem | null): t is QueuedTrackItem => t !== null);
      savePersistedQueue(customQueue, true);
    }

    // If the currently playing song matches the first item in customQueue (e.g. Spotify naturally advanced to the next song), pop it automatically
    if (
      currentlyPlaying?.uri &&
      customQueue.length > 0 &&
      customQueue[0].uri === currentlyPlaying.uri
    ) {
      customQueue = customQueue.slice(1);
      savePersistedQueue(customQueue, true);
    }

    return NextResponse.json({
      currently_playing: currentlyPlaying,
      queue: customQueue,
      spotify_queue: spotifyQueue.slice(0, 20),
    });
  } catch (error) {
    return NextResponse.json(
      { currently_playing: null, queue: customQueue || [] },
      { status: 200 }
    );
  }
}

/**
 * POST /api/spotify/queue
 * Create / Add a song to the Managed Queue (bottom by default, or top)
 */
export async function POST(req: NextRequest) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { track, uri, position = 'bottom', currentQueue } = body;

    let item: QueuedTrackItem | null = null;
    if (track && track.uri) {
      item = normalizeTrackToQueueItem(track);
    } else if (uri) {
      item = await fetchTrackByUri(accessToken, uri);
    }

    if (!item) {
      return NextResponse.json({ error: 'Invalid track data' }, { status: 400 });
    }

    // Build the updated queue using client's authoritative currentQueue if sent,
    // otherwise fallback to persisted cache. This completely prevents serverless
    // instance isolation from wiping out existing songs!
    let updatedQueue: QueuedTrackItem[] = [];
    if (Array.isArray(currentQueue)) {
      updatedQueue = currentQueue
        .map((t: any) => normalizeTrackToQueueItem(t))
        .filter((t: QueuedTrackItem | null): t is QueuedTrackItem => t !== null);
    } else {
      const persisted = loadPersistedQueue();
      updatedQueue = [...persisted.queue];
    }

    if (position === 'top' || position === 'next') {
      updatedQueue.unshift(item);
    } else {
      // Append to the very bottom of the queue (never replace top or previous tracks)
      updatedQueue.push(item);
    }

    savePersistedQueue(updatedQueue, true);

    // Also forward to Spotify Connect player's native queue endpoint
    if (item.uri) {
      fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(item.uri)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      item,
      queue: updatedQueue,
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

    const persisted = loadPersistedQueue();
    let updatedQueue = [...persisted.queue];

    if (action === 'move' && typeof fromIndex === 'number' && typeof toIndex === 'number') {
      if (
        fromIndex >= 0 &&
        fromIndex < updatedQueue.length &&
        toIndex >= 0 &&
        toIndex < updatedQueue.length
      ) {
        const [moved] = updatedQueue.splice(fromIndex, 1);
        updatedQueue.splice(toIndex, 0, moved);
      }
    } else if (action === 'replace' && Array.isArray(queue)) {
      updatedQueue = queue
        .map((t: any) => normalizeTrackToQueueItem(t))
        .filter((t: QueuedTrackItem | null): t is QueuedTrackItem => t !== null);
    } else if (action === 'deduplicate') {
      const seen = new Set<string>();
      updatedQueue = updatedQueue.filter((item) => {
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
        updatedQueue = (data.queue || [])
          .map((t: any) => normalizeTrackToQueueItem(t))
          .filter((t: QueuedTrackItem | null): t is QueuedTrackItem => t !== null);
      }
    }

    savePersistedQueue(updatedQueue, true);

    return NextResponse.json({
      success: true,
      queue: updatedQueue,
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

    const persisted = loadPersistedQueue();
    let updatedQueue = [...persisted.queue];

    if (clearAll) {
      updatedQueue = [];
    } else if (queueId) {
      updatedQueue = updatedQueue.filter((it) => it.queueId !== queueId);
    } else if (typeof index === 'number' && index >= 0 && index < updatedQueue.length) {
      updatedQueue.splice(index, 1);
    }

    savePersistedQueue(updatedQueue, true);

    return NextResponse.json({
      success: true,
      queue: updatedQueue,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete from queue' }, { status: 500 });
  }
}
