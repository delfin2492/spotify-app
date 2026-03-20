"use client";
import { useEffect, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

interface NowPlaying {
  album: string;
  albumImageUrl: string;
  artist: string;
  isPlaying: boolean;
  songUrl: string;
  title: string;
  progressMs: number;
  durationMs: number;
}

export default function Player() {
  const { data: session, status } = useSession();
  const [data, setData] = useState<NowPlaying | null>(null);

  useEffect(() => {
    if (!session) return;
    
    // Simpan refresh token secara otomatis agar bisa dibaca ESP8266
    if ((session as any).refreshToken) {
      fetch("/api/spotify/register-token", {
        method: "POST",
        body: JSON.stringify({ refreshToken: (session as any).refreshToken }),
      });
    }

    const fetchNowPlaying = async () => {
      try {
        const res = await fetch("/api/spotify/now-playing");
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (e) {
        console.error("Failed to fetch next track");
      }
    };

    fetchNowPlaying();
    const interval = setInterval(fetchNowPlaying, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, [session]);

  if (status === "loading") {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#121212] text-white">
        <div className="w-10 h-10 border-4 border-t-[#1DB954] border-gray-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-[#121212] text-white p-6">
        <div className="w-20 h-20 mb-6 bg-[#1DB954] rounded-full flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="black" className="w-10 h-10"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.35-1.434-5.305-1.76-8.786-.963-.335.077-.67-.133-.746-.47-.077-.334.132-.67.47-.745 3.808-.87 7.076-.496 9.712 1.115.293.18.386.563.207.856zm1.268-2.834c-.226.367-.714.48-1.08.254-2.686-1.65-6.78-2.13-9.965-1.166-.41.127-.84-.105-.966-.516-.126-.41.106-.84.516-.965 3.65-1.108 8.19-.57 11.24 1.312.368.226.482.714.255 1.08zm.106-2.953C14.73 8.71 8.544 8.5 4.98 9.584c-.496.15-1.01-.132-1.16-.628-.15-.495.13-1.01.627-1.16 4.103-1.245 10.957-1.002 14.88 1.328.448.266.595.845.33 1.293-.264.448-.844.595-1.293.33z"/></svg>
        </div>
        <h1 className="text-3xl font-extrabold mb-2 text-center tracking-tight">Vantara Player</h1>
        <p className="text-gray-400 text-center mb-10 max-w-xs">Hubungkan dengan Spotify untuk melihat lagu yang sedang Anda dengarkan.</p>
        <button
          onClick={() => signIn("spotify")}
          className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold py-3.5 px-8 rounded-full transition-all duration-300 hover:scale-105 active:scale-95 shadow-lg"
        >
          Masuk dengan Spotify
        </button>
      </div>
    );
  }

  const handleControl = async (action: string, value?: number) => {
    try {
      await fetch("/api/spotify/control", {
        method: "POST",
        body: JSON.stringify({ action, value }),
      });
      // Refresh data after small delay
      setTimeout(() => {
        const fetchNowPlaying = async () => {
          try {
            const res = await fetch("/api/spotify/now-playing");
            if (res.ok) {
              const json = await res.json();
              setData(json);
            }
          } catch (e) {}
        };
        fetchNowPlaying();
      }, 500);
    } catch (error) {
      console.error("Control error:", error);
    }
  };

  const progressPercent = data?.isPlaying ? (data.progressMs / data.durationMs) * 100 : 0;

  return (
    <div className="relative min-h-[100dvh] bg-[#121212] text-white flex flex-col items-center justify-center overflow-hidden p-6 sm:p-8 font-sans transition-colors duration-1000 ease-out">
      {/* Background blur from Album Image */}
      {data?.albumImageUrl && (
        <div
          className="absolute inset-0 z-0 transition-opacity duration-1000 ease-in-out opacity-40 mix-blend-screen scale-110"
          style={{
            backgroundImage: `url(${data.albumImageUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(60px)",
          }}
        />
      )}
      {/* Dark overlay for contrast */}
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-transparent to-[#121212] opacity-80" />

      <div className="z-10 w-full max-w-md flex flex-col items-center">
        {/* Top bar */}
        <div className="w-full flex justify-between items-center mb-10">
          <span className="text-xs font-bold tracking-widest text-[#1DB954] uppercase">Vantara Live Player</span>
          <button
            onClick={() => signOut()}
            className="text-xs font-medium text-gray-400 hover:text-white transition-colors"
          >
            Keluar
          </button>
        </div>

        {data?.isPlaying || (data && !data.isPlaying) ? (
          <div className="w-full flex flex-col items-center transition-all duration-700">
            {/* Album Cover */}
            <div className={`w-full max-w-[280px] sm:max-w-[320px] aspect-square rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] overflow-hidden mb-8 relative group ${!data.isPlaying ? 'opacity-50 grayscale-[0.5]' : ''}`}>
              <img
                src={data.albumImageUrl}
                alt={data.album}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
              />
            </div>

            {/* Song Info */}
            <div className="w-full flex justify-between items-end mb-6">
                <div className="flex-1 min-w-0 pr-4">
                  <h2 className="text-2xl sm:text-3xl font-bold text-white truncate max-w-full drop-shadow-md">
                    <a href={data.songUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {data.title}
                    </a>
                  </h2>
                  <p className="text-gray-300 text-base sm:text-lg truncate max-w-full font-medium mt-1 drop-shadow-sm">
                    {data.artist}
                  </p>
                </div>
                
                {/* Visualizer bars */}
                {data.isPlaying && (
                  <div className="flex items-end space-x-1 h-6 pb-1.5 opacity-80">
                    <div className="w-1 bg-[#1DB954] animate-[bounce_1s_infinite_ease-in-out] origin-bottom h-full" style={{ animationDelay: '0s' }}></div>
                    <div className="w-1 bg-[#1DB954] animate-[bounce_1s_infinite_ease-in-out] origin-bottom h-[60%]" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-1 bg-[#1DB954] animate-[bounce_1s_infinite_ease-in-out] origin-bottom h-[80%]" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                )}
            </div>

            {/* Progress Bar & Seek */}
            <div className="w-full mb-8">
              <input
                type="range"
                min="0"
                max={data.durationMs}
                value={data.progressMs}
                onChange={(e) => handleControl("seek", parseInt(e.target.value))}
                className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                title="Seek"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-2 font-medium">
                <span>{formatTime(data.progressMs)}</span>
                <span>{formatTime(data.durationMs)}</span>
              </div>
            </div>

            {/* Playback Controls */}
            <div className="flex items-center justify-center space-x-8 mb-8">
               <button onClick={() => handleControl("previous")} className="text-gray-300 hover:text-white transition-colors">
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M11.5 12l8.5 6V6l-8.5 6zM4 6h2v12H4z"/></svg>
               </button>
               
               <button 
                  onClick={() => handleControl(data.isPlaying ? "pause" : "play")}
                  className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform cursor-pointer text-black"
               >
                  {data.isPlaying ? (
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  ) : (
                    <svg className="w-8 h-8 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  )}
               </button>
               
               <button onClick={() => handleControl("next")} className="text-gray-300 hover:text-white transition-colors">
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12.5 12l-8.5-6v12l8.5-6zM20 6h-2v12h2z"/></svg>
               </button>
            </div>

            {/* Volume Control */}
            <div className="w-full max-w-[200px] flex items-center space-x-3 bg-white/5 py-2 px-4 rounded-full border border-white/5">
               <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
               <input
                type="range"
                min="0"
                max="100"
                defaultValue="50"
                onChange={(e) => handleControl("volume", parseInt(e.target.value))}
                className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-green-500"
                title="Volume"
              />
            </div>
          </div>
        ) : (
          <div className="text-center w-full flex flex-col items-center justify-center h-64">
            <div className="w-20 h-20 mb-6 text-gray-600">
               <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm2.062 14.545c-.21.344-.66.45-1.006.24C10.3 15.084 6.84 14.67 4.02 15.524c-.392.118-.783-.105-.902-.497-.117-.393.106-.783.497-.902 3.255-.98 7.227-.512 10.21 1.306.345.21.45.66.238 1.005zm1.487-3.32c-.264.43-.833.563-1.26.297-3.136-1.927-7.915-2.487-11.636-1.36-.503.153-.1.026-.14.037-.478.145-.986-.123-1.132-.602-.145-.48.123-.986.602-1.13 4.263-1.293 9.56-.665 13.12 1.522.427.265.56.83.298 1.258zm.12-3.447C11.332 7.03 4.102 6.786-.037 8.046c-.578.175-1.176-.153-1.353-.73-.176-.58.153-1.177.73-1.354 4.79-1.454 12.8-1.17 18.23 2.058.52.31.69 1.033.38 1.554-.31.52-1.033.69-1.553.38z"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-300">Tidak ada musik.</h2>
            <p className="text-gray-500 mt-2">Buka Spotify dan putar sebuah lagu untuk menampilkannya di sini.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
