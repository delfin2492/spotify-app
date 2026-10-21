import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getValidAccessToken } from '@/lib/auth';

export async function GET() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ devices: [] });
    }

    const data = await res.json();
    return NextResponse.json({ devices: data.devices || [] });
  } catch (error) {
    return NextResponse.json({ devices: [] }, { status: 500 });
  }
}
