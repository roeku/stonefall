# Branding

Everything here is rendered from the game itself, from presets in `tools/promo/` (see its README):
the game's materials, bloom, floor and simulation, checked against frames of the live game. To
rebuild all of it, `node tools/promo/build.mjs` (about two minutes).

| File                              | Size                             | Where it goes                                                                                            |
| --------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `icon.png`                        | 1024 x 1024                      | App icon: `marketingAssets.icon` in `devvit.json`, and the in-app catalog. A new one needs a new review. |
| `community-icon.png`              | 256 x 256                        | r/stonefall's community icon. Reads in a circle down to 32 px.                                           |
| `logo.png`                        | 1600 x 480                       | Icon and wordmark side by side.                                                                          |
| `featuring/featured.png`          | 1500 x 1000, 0.77 MB             | Featuring asset (still), and the fallback image for the video.                                           |
| `featuring/featured.mp4`          | 1200 x 800, 12 s, 30 fps, 2.8 MB | Featuring asset (video). Its first frame is the still's composition with the wordmark.                   |
| `featuring/featured-fallback.gif` | 1002 x 668, 4.5 s loop, 2.0 MB   | Fallback asset for the video: eight perfect drops that loop seamlessly.                                  |
| `featuring/tile.png`              | 560 x 256                        | Tile image. No type, since small placements crop.                                                        |
| `banners/banner-1920x384.png`     | 1920 x 384                       | Community banner, desktop.                                                                               |
| `banners/banner-2160x256.png`     | 2160 x 256                       | Community banner, short (the 128 px minimum height, at 2x).                                              |
| `banners/banner-1600x480.png`     | 1600 x 480                       | Community banner, mobile app.                                                                            |

All of it follows Reddit's media guidelines: 3:2 featuring video and GIF, video under 3 MB and 15 s,
GIF under 2 MB, still under 800 KB. The wordmark keeps at least 8:1 contrast in greyscale against the
brightest 1% of what is right behind it (`tools/promo/contrast.py`; Reddit asks for about 3:1). The
video has no full-screen flashes, and its one camera move peaks at about a third of the frame width
a second (`tools/promo/flashcheck.py`).

Suggested copy for the catalog, to adjust:

- Tile tagline: Stack high. Claim the map. (the video's closing line)
- Featuring description: Drop sliding blocks to build a tower, then raise it on your community's
  map to claim ground for your colour. A new map and relay every day.

The vector set this replaced (September 2026) is in `archive/assets/branding-2026-09/`.
