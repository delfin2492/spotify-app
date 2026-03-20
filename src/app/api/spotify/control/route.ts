import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { action, value } = await req.json();
  const accessToken = (session as any).accessToken;

  let url = 'https://api.spotify.com/v1/me/player/';
  let method = 'POST';

  switch (action) {
    case 'play':
      url += 'play';
      method = 'PUT';
      break;
    case 'pause':
      url += 'pause';
      method = 'PUT';
      break;
    case 'next':
      url += 'next';
      method = 'POST';
      break;
    case 'previous':
      url += 'previous';
      method = 'POST';
      break;
    case 'volume':
      url += `volume?volume_percent=${value}`;
      method = 'PUT';
      break;
    case 'seek':
      url += `seek?position_ms=${value}`;
      method = 'PUT';
      break;
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 204 || response.status === 200) {
      return NextResponse.json({ success: true });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
