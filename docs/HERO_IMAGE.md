# Homepage hero image: source and licence

The default homepage hero uses one photograph, stored **locally** in `frontend/public/images/` (nothing is hot-linked from a third party).

| Item | Detail |
| --- | --- |
| Subject | Skyline of the Porta Nuova business district, Milan |
| Photographer | Francesco Ungaro (published via Pexels) |
| Source page | https://commons.wikimedia.org/wiki/File:Milan_skyline_skyscrapers_of_Porta_Nuova_business_district_(cropped).jpg |
| Original photo page | https://www.pexels.com/photo/architecture-blue-sky-buildings-city-409127/ |
| Licence | **CC0 1.0 Universal (public-domain dedication)**: commercial use and modification are permitted and no attribution is required. Attribution is given here anyway. |
| Retrieved | 2026-10-10, at 3840 px wide from Wikimedia Commons |

## What was done to it
The 3840 × 1801 source was resized (Lanczos) and re-encoded locally:

| File | Use | Size |
| --- | --- | --- |
| `hero-640.webp` | phones | ~42 KB |
| `hero-1280.webp` / `hero-1280.jpg` | tablets / laptops (WebP preferred, JPEG fallback) | ~143 KB / ~158 KB |
| `hero-1920.webp` / `hero-1920.jpg` | large screens | ~281 KB / ~322 KB |

The page uses `<picture>` with `srcset`/`sizes`, so each device downloads one file. A navy gradient overlay (`--hero-overlay` in `tokens.css`) guarantees at least 4.5:1 contrast for the text over any part of the image in both themes; the contrast test in `src/test/contrast.test.js` checks it. If the image fails to load, the navy background remains and the text stays readable.

## Replacing it
Administrators can upload their own hero image under **Admin → Website → Homepage** (stored in the private `site-assets` bucket and served through the API). Only upload images you have the right to use. Clearing the upload returns to this bundled photograph.
