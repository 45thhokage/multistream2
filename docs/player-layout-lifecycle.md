# Player layout and lifecycle fixes

Layout switches move and resize existing tiles together over 300 ms, using the same easing as the Multiview reference. Rapid switches cancel the previous move and continue from the current position. Reduced-motion preferences apply the new layout immediately. Native player bounds follow each animation frame instead of waiting for the periodic bounds check.

Embedded providers manage their own network reconnection. An app connectivity probe no longer forces iframe navigation. The reload button remains available; native HLS recovery still receives the existing reconnect event.

Twitch quality discovery follows React component props and player wrappers. Quality changes wait for the player to confirm its rendition, and automatic mode is reported separately from the rendition currently playing.

Removed native players enter the same graveyard lifetime as their grid owners. They hide, mute, suspend nested media, and stay mounted until collection. Final native closure suspends media and waits 250 ms before closing the WebView.

The reported Kick Pusher warning recovered successfully before shutdown. These changes address an unsafe player teardown path; they do not establish the cause of the reported process exit. Live Windows playback and crash reproduction must be checked in the desktop app.

When adding a stream exceeds a built-in layout's capacity, the selected layout grows to the smallest compact preset that fits (Solo, Duo, Quad, Wall, then larger grids). Stack, Wide, and 2x3 are hard-coded manual-only choices. Automatic layout mode also skips these shapes. Adding a duplicate or a rejected stream does not change the layout; replacements count only the retained streams. Manual choices stay selected while they still have room.

Twitch quality requests support both string/group APIs and IVS rendition objects, including players hosted on Twitch domains. Frames that only forward a request cannot report a player failure; failure reporting belongs to frames that discovered an actual player.
