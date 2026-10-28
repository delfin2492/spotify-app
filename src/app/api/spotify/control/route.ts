import { NextResponse } from 'next/server';
import { getValidAccessToken } from '@/lib/auth';

export async function getFallbackDeviceId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const devices: any[] = data.devices || [];
    if (devices.length === 0) return null;

    // Prioritaskan device yang sedang aktif, atau Vantara Web Player, atau device pertama yang tersedia
    const active = devices.find((d) => d.is_active);
    if (active) return active.id;

    const webPlayer = devices.find((d) =>
      (d.name || '').toLowerCase().includes('vantara')
    );
    if (webPlayer) return webPlayer.id;

    return devices[0].id;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    return NextResponse.json(
      { error: 'Unauthorized - Sesi kedaluwarsa, silakan sinkronkan ulang akun Spotify.' },
      { status: 401 }
    );
  }

  const body = await req.json();
  const { action, value, uris, context_uri, offset, deviceId, uri } = body;

  // Jangan restart atau re-buffer pemutaran lagu yang sedang berjalan
  if (action === 'sync-playback-queue') {
    return NextResponse.json({ success: true });
  }

  const clientQueueUris: string[] = Array.isArray(body.queueUris) ? body.queueUris : [];

  const buildRequest = (targetDeviceId?: string | null) => {
    const deviceQuery = targetDeviceId ? `device_id=${encodeURIComponent(targetDeviceId)}` : '';
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
          if (uris) {
            if (!body.ignoreCustomQueue && clientQueueUris.length > 0) {
              const combined = [...uris, ...clientQueueUris].slice(0, 100);
              payload.uris = combined;
            } else {
              payload.uris = uris;
            }
          }
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
        url += `repeat?state=${value}`;
        if (deviceQuery) url = appendQuery(url, deviceQuery);
        method = 'PUT';
        break;
      case 'transfer':
        url = 'https://api.spotify.com/v1/me/player';
        method = 'PUT';
        payload = {
          device_ids: [targetDeviceId || value],
          play: true,
        };
        break;
      case 'queue':
        url += `queue?uri=${encodeURIComponent(uri || value)}`;
        if (deviceQuery) url = appendQuery(url, deviceQuery);
        method = 'POST';
        break;
      default:
        return null;
    }

    return { url, method, payload };
  };

  const initialReq = buildRequest(deviceId);
  if (!initialReq) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  try {
    let response = await fetch(initialReq.url, {
      method: initialReq.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(initialReq.payload ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(initialReq.payload ? { body: JSON.stringify(initialReq.payload) } : {}),
    });

    // Jika 404 (No active device found), cari device yang tersedia dan otomatis aktifkan!
    if (response.status === 404) {
      const fallbackDeviceId = deviceId || (await getFallbackDeviceId(accessToken));

      if (!fallbackDeviceId) {
        return NextResponse.json(
          {
            error: 'NO_ACTIVE_DEVICE',
            message:
              'Tidak ada perangkat Spotify yang aktif. Silakan buka aplikasi Spotify di HP/Laptop Anda atau aktifkan Web Player di browser.',
          },
          { status: 404 }
        );
      }

      // Aktifkan / transfer ke device tersebut terlebih dahulu
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

      // Beri jeda 450ms agar device Spotify Connect siap menerima perintah pemutaran
      await new Promise((r) => setTimeout(r, 450));

      // Ulangi perintah dengan fallbackDeviceId
      const retryReq = buildRequest(fallbackDeviceId);
      if (retryReq) {
        response = await fetch(retryReq.url, {
          method: retryReq.method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(retryReq.payload ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(retryReq.payload ? { body: JSON.stringify(retryReq.payload) } : {}),
        });

        // Jika masih 404 atau 502, tunggu 400ms lagi lalu coba kembali
        if (response.status === 404 || response.status === 502) {
          await new Promise((r) => setTimeout(r, 400));
          response = await fetch(retryReq.url, {
            method: retryReq.method,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ...(retryReq.payload ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(retryReq.payload ? { body: JSON.stringify(retryReq.payload) } : {}),
          });
        }
      }
    }

    if (response.status === 204 || response.status === 200) {
      // Whenever the user plays a song or reorders, ensure Shuffle is OFF if we are following customQueue order
      if (
        (action === 'play' || action === 'next' || action === 'sync-playback-queue') &&
        clientQueueUris.length > 0
      ) {
        const devParam = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : '';
        fetch(`https://api.spotify.com/v1/me/player/shuffle?state=false${devParam}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => {});
      }
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
