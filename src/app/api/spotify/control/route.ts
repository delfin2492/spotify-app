import { NextResponse } from 'next/server';
import { getValidAccessToken } from '@/lib/auth';

export async function POST(req: Request) {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    console.error("DEBUG: No valid accessToken found for control request!");
    return NextResponse.json(
      { error: 'Unauthorized - Sesi kedaluwarsa, silakan Keluar dan Masuk kembali.' },
      { status: 401 }
    );
  }

  const body = await req.json();
  const { action, value, uris, context_uri, offset, deviceId, uri } = body;

  const deviceQuery = deviceId ? `device_id=${encodeURIComponent(deviceId)}` : '';
  const appendQuery = (base: string, param: string) =>
    base.includes('?') ? `${base}&${param}` : `${base}?${param}`;

  let url = 'https://api.spotify.com/v1/me/player/';
  let method = 'POST';
  let payload: any = undefined;

  switch (action) {
    case 'play':
      url += 'play';
      if (deviceQuery) url = appendQuery(url, deviceQuery);
      method = 'PUT';
      if (uris || context_uri || offset) {
        payload = {};
        if (uris) payload.uris = uris;
        if (context_uri) payload.context_uri = context_uri;
        if (offset) payload.offset = offset;
      }
      break;
    case 'pause':
      url += 'pause';
      if (deviceQuery) url = appendQuery(url, deviceQuery);
      method = 'PUT';
      break;
    case 'next':
      url += 'next';
      if (deviceQuery) url = appendQuery(url, deviceQuery);
      method = 'POST';
      break;
    case 'previous':
      url += 'previous';
      if (deviceQuery) url = appendQuery(url, deviceQuery);
      method = 'POST';
      break;
    case 'volume':
      url += `volume?volume_percent=${value}`;
      if (deviceQuery) url = appendQuery(url, deviceQuery);
      method = 'PUT';
      break;
    case 'seek':
      url += `seek?position_ms=${value}`;
      if (deviceQuery) url = appendQuery(url, deviceQuery);
      method = 'PUT';
      break;
    case 'shuffle':
      url += `shuffle?state=${Boolean(value)}`;
      if (deviceQuery) url = appendQuery(url, deviceQuery);
      method = 'PUT';
      break;
    case 'repeat':
      url += `repeat?state=${value}`; // 'track', 'context', or 'off'
      if (deviceQuery) url = appendQuery(url, deviceQuery);
      method = 'PUT';
      break;
    case 'transfer':
      url = 'https://api.spotify.com/v1/me/player';
      method = 'PUT';
      payload = {
        device_ids: [deviceId || value],
        play: true,
      };
      break;
    case 'queue':
      url += `queue?uri=${encodeURIComponent(uri || value)}`;
      if (deviceQuery) url = appendQuery(url, deviceQuery);
      method = 'POST';
      break;
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    };

    const response = await fetch(url, fetchOptions);

    if (response.status === 204 || response.status === 200) {
      return NextResponse.json({ success: true });
    }

    const text = await response.text();
    let data: any = { error: text || 'Spotify API error' };
    try {
      data = JSON.parse(text);
    } catch {}
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
