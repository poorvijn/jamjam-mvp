# Jam Jam — shared listening MVP

A responsive web app for listening to YouTube videos together in a shared room. Everyone in the room can add/remove/reorder videos and control shared play/pause, seek, previous, and next. Uses the official YouTube IFrame Player API and Socket.IO for real-time room state.

## Requirements
- Node.js 18 or newer
- Internet access (the app loads Socket.IO from its own server and the YouTube iframe API from YouTube)

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000. Enter your name and leave the room code blank to create a room. Share the invite link/code with friends. For local multi-device testing, make sure devices can reach the host computer's LAN IP and allow port 3000 through the firewall.

## Music source and keys

- Songs are added by pasting YouTube video URLs. The server extracts and validates the video ID; it does not download or proxy media.
- Playback uses the official YouTube IFrame Player API. No YouTube Data API key, Spotify account, Spotify Premium subscription, or other API key is needed for this URL-paste MVP.
- The YouTube embedded player remains visible and its standard playback UI/ads are not suppressed. Some videos cannot be embedded, and browsers may block autoplay until each listener interacts with the player.
- The YouTube IFrame Player API controls playback, but YouTube playback can have ads, regional restrictions, owner embed restrictions, and timing differences. This is best-effort synchronization, not guaranteed sample-accurate sync.

## Deploy for friends

Deploy this Node app to a host that supports a long-running Node process and WebSockets (for example, a small Render/Fly.io/Railway-style service). Set the start command to `npm start`; no environment variables are required except optional `PORT` supplied by the host. Use HTTPS in production. Do not deploy multiple server replicas without adding shared storage/pub-sub; the MVP keeps rooms in process memory.

## MVP limitations

- Rooms and queues are held in memory and disappear when the server restarts; there is no database or account system.
- Room codes are short and intended for private friend groups, not as a security boundary.
- Anyone with the room link can control the player and queue, as requested.
- The UI shows YouTube's player so users can interact with it. For best room synchronization, use the in-app transport controls; if someone changes playback directly inside the YouTube player, the app tries to reflect play/pause, but arbitrary manual seeks are not guaranteed to propagate.
- Video titles are fetched from the embedded player after playback starts; no YouTube Data API is used.

## Next production steps
1. Add Redis/Postgres-backed room state and persistence.
2. Add rate limits and longer/unpredictable invite tokens.
3. Improve playback leadership/command sequencing to avoid duplicate end events and race conditions under high latency.
4. Add optional title lookup using YouTube Data API v3 (requires a Google Cloud project and API key), if desired.
5. Add automated browser tests and production monitoring.

## Legal/product notes
Use YouTube's official embedded player and comply with YouTube's API Services Terms and Developer Policies. Do not extract/download audio, remove ads, or obscure the YouTube player. Spotify is not the recommended fallback for this particular synchronized-listening use case: Spotify's Web Playback SDK requires Premium and Spotify's platform rules restrict synchronizing recordings with visual media and non-interactive broadcasting.
