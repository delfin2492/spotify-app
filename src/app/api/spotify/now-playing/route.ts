import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getNowPlaying } from '@/lib/spotify';

export async function GET() {
  const session = await getServerSession(authOptions) as any;

  if (!session || !session.accessToken) {
    return NextResponse.json({ isPlaying: false, message: 'Not authenticated' }, { status: 401 });
  }

  try {
    const response = await getNowPlaying(session.accessToken);

    if (response.status === 204 || response.status > 400) {
      return NextResponse.json({ isPlaying: false });
    }

    const song = await response.json();

    if (song.item === null) {
      return NextResponse.json({ isPlaying: false });
    }

    const isPlaying = song.is_playing;
    const title = song.item.name;
    const artist = song.item.artists.map((_artist: any) => _artist.name).join(', ');
    const album = song.item.album.name;
    const albumImageUrl = song.item.album.images[0].url;
    const songUrl = song.item.external_urls.spotify;
    const progressMs = song.progress_ms;
    const durationMs = song.item.duration_ms;

    return NextResponse.json({
      album,
      albumImageUrl,
      artist,
      isPlaying,
      songUrl,
      title,
      progressMs,
      durationMs,
    });
  } catch (error) {
    return NextResponse.json(
      { isPlaying: false, message: 'Error retrieving now playing data' },
      { status: 500 }
    );
  }
}
