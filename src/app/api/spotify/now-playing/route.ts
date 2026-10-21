import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getValidAccessToken } from '@/lib/auth';

export async function GET() {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    return NextResponse.json({ isPlaying: false, message: 'Not authenticated' }, { status: 401 });
  }

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });

    if (response.status === 204 || response.status > 400) {
      return NextResponse.json({ isPlaying: false });
    }

    const state = await response.json();

    if (!state || !state.item) {
      return NextResponse.json({
        isPlaying: false,
        device: state?.device || null,
        shuffleState: state?.shuffle_state ?? false,
        repeatState: state?.repeat_state ?? 'off',
      });
    }

    const isPlaying = state.is_playing;
    const trackId = state.item.id;
    const trackUri = state.item.uri;
    const title = state.item.name;
    const artist = state.item.artists.map((_artist: any) => _artist.name).join(', ');
    const album = state.item.album.name;
    const albumImageUrl = state.item.album.images?.[0]?.url || '';
    const songUrl = state.item.external_urls?.spotify || '#';
    const progressMs = state.progress_ms || 0;
    const durationMs = state.item.duration_ms || 1;
    const shuffleState = state.shuffle_state ?? false;
    const repeatState = state.repeat_state ?? 'off';
    const device = state.device || null;

    return NextResponse.json({
      trackId,
      trackUri,
      album,
      albumImageUrl,
      artist,
      isPlaying,
      songUrl,
      title,
      progressMs,
      durationMs,
      shuffleState,
      repeatState,
      device,
    });
  } catch (error) {
    return NextResponse.json(
      { isPlaying: false, message: 'Error retrieving now playing data' },
      { status: 500 }
    );
  }
}
