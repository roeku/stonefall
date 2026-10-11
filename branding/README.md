# Branding

Everything here except the icon is rendered from the game itself, through `tools/promo/` (see its
README): the game's materials, bloom, floor and simulation, checked against frames of the live
game. The featuring set is cut from the launch video in `brag-output/` (made with /brag and
Hyperframes over plates the promo stage rendered, scored with the game's own music for the video's
exact drops). The type is the video's: the wordmark over a cyan rim, as a block's rim sits under a
streak name.

The icon is drawn, not rendered, because a render of the game blurs at the 32 px Reddit shows icons
at: an exact axonometric mark of the run's summit, a course just landed flush, its seam lit white
and the landing ring spreading in gold.

To rebuild all of it, `node tools/promo/build.mjs` (about a minute; the featuring job needs
`brag-output/brag.mp4`).

| File                              | Size                                   | Where it goes                                                                                             |
| --------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `icon.png`                        | 1024 x 1024                            | App icon: `marketingAssets.icon` in `devvit.json`, and the in-app catalog. A new one needs a new review.  |
| `community-icon.png`              | 256 x 256                              | r/stonefall's community icon: the same mark, drawn at 256. Reads in a circle down to 32 px.               |
| `icon.svg`                        | vector                                 | The icon's source, drawn by `tools/promo/icon.mjs`.                                                       |
| `logo.png`                        | 1600 x 480                             | The lockup: the wordmark over its rim, as the video ends.                                                 |
| `featuring/featured.mp4`          | 1200 x 800, 15 s, 30 fps, 2.7 MB       | Featuring asset (video), silent. Frame 0 is the poster, for when autoplay is off.                         |
| `featuring/featured-fallback.gif` | 1002 x 668, 6.8 s loop, 1.9 MB         | Fallback asset: the poster, the word tower building as the drops land, then ORBIT.                        |
| `featuring/featured.png`          | 1500 x 1000, 1.1 MB                    | The poster, lossless: PNG as Reddit prefers, under the 3 MB cap but over the 800 KB guideline.            |
| `featuring/featured.jpg`          | 1500 x 1000, 0.5 MB                    | The same picture under 800 KB (q95; no visible difference). Use whichever the portal takes.               |
| `featuring/tile.png`              | 560 x 256                              | Tile image. No type: Reddit says small placements crop or scale, and sets the tile tagline beside it.     |
| `banners/banner-1920x384.png`     | 1920 x 384                             | Community banner, desktop.                                                                                |
| `banners/banner-2160x256.png`     | 2160 x 256                             | Community banner, short (the 128 px minimum height, at 2x).                                               |
| `banners/banner-1600x480.png`     | 1600 x 480                             | Community banner, mobile app.                                                                             |

All of it follows Reddit's media guidelines: 3:2 video and GIF, the video under 3 MB and 15 s, the
GIF under 2 MB. Every line of the video's text passes WCAG AA (`hyperframes check`); the banners'
wordmark keeps at least 8:1 in greyscale against the brightest 1% of what is right behind it
(`tools/promo/contrast.py`; Reddit asks for about 3:1). The video has no full-screen flashes (its
biggest change is one hard cut) and no fast pans: the camera moves are slow, and the ladder of
streak names rolls at under half the frame's width a second (`tools/promo/flashcheck.py`).

Catalog copy (the portal allows 35 characters for the featuring description, 20 for the tile
tagline):

- Featuring description: Stack high. Claim today's map. (the video's closing lines, joined)
- Tile tagline: Daily tower stacker (it reads as a subtitle beside the icon)
- A caption for sharing the video: `brag-output/share-copy.txt`.

The vector set these renders replaced (September 2026) is in `archive/assets/branding-2026-09/`.
