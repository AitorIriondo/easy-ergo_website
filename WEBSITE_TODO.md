# Website TODO — for Aitor to action before / after publish

These are things I (Claude) couldn't decide on or that need a human in the loop.

## Before publishing

- [ ] **Verify the contact form endpoint.** I wired it to
      `https://formsubmit.co/aitor.easyergo@gmail.com` (no signup needed —
      the first submission triggers a confirmation email, click the link to
      activate). Swap to Formspree, Netlify Forms, or your own backend if
      you prefer a different provider.
- [ ] **Compress the demo GLB.** `img/demo-mesh.glb` is **56 MB** — fine
      for GitHub Pages (file limit 100 MB) but heavy on first load. Two
      options:
  1. Draco-compress in place (typically 5–10× smaller):
     ```bash
     npx -y gltf-pipeline -i img/demo-mesh.glb -o img/demo-mesh.glb -d
     ```
  2. Or move it off-repo to GitHub Releases / a CDN and point
     `data-load-model` in `index.html` at the new URL.
- [ ] **Confirm exporter format list.** `index.html` and `PRODUCT.md`
      claim JSON, CSV, GLB, PDF, OSIM, MOT and MVNX as export formats.
      Confirm all are in the dashboard today; remove any that aren't.
- [ ] **Concrete licence pricing / pilot terms.** The site now uses
      "simple licensing" framing only — no per-video, no per-seat, but
      no specific tiers either. If there's a public price list / pilot
      offer, swap the framing-only copy for it.
- [ ] **Build a real OG / Twitter share card.** Currently using
      `img/field-forms.jpg` as a placeholder (the old
      `easyergo_dashboard.jpg` was outdated). A purpose-built 1200×630
      card with the wordmark + a still of the 3D model + the headline
      would look far better when shared on LinkedIn / Twitter.
- [ ] **Confirm `EasyErgo AB` is the legal entity** referenced in the
      privacy notice. If it's not registered yet, change to "EasyErgo" or
      similar.

## After publishing

- [ ] **Submit the new sitemap to Google Search Console** at
      `https://www.easy-ergo.co/sitemap.xml`.
- [ ] **Test on real devices** — phone (Safari iOS, Chrome Android),
      tablet, and desktop. Especially check the 3D viewer load button and
      the demo videos auto-play behavior.
- [ ] **Run Lighthouse** in Chrome DevTools → expect 90+ on Performance,
      Accessibility, Best Practices, SEO. If Performance is below 80, the
      culprit is almost certainly the 56 MB GLB — fix per first item
      above.
- [ ] **Create a real OG share image** as noted above.

## Deferred — work to do later

- [ ] **Privacy page** still needs a closer review. We did the minimum
      to remove fictional product references and apply the new branding,
      but Aitor flagged a fuller pass for later.

## Things I deliberately did NOT do

- **Did not commit or push** — you asked to review first.
- **Did not delete the legacy template assets** in `lib/`, `scss/`, the
  template `style.css`, or the legacy images in `img/` (e.g.
  `easysense-*`, `app-*`, `easyergo_app*`, `tablet_easyergo.png`,
  `dashboard-*.png`, `demo-skeleton-*`, `demo-walking-*`,
  `demo-video-evaluation-*`, `demo-3d-model.mp4`,
  `easyergo_dashboard.jpg`, `background.png`, `app-*.jpg`,
  `app-splash.jpg`). Nothing in the new HTML/CSS references them, so
  they're effectively dead weight. Safe to delete in a follow-up
  cleanup commit. (Kept `field-*.jpg` and `easyergo_pcb*.jpg` since
  you flagged those as still relevant.)
- **Did not change `CNAME`** (still `www.easy-ergo.co`).
- **Did not touch `LICENSE.txt` or `READ-ME.txt`** (both empty).

## Image / video inventory after redesign

**Used by the new site:**
- `img/easyergo_no_background.png` — logo (JSON-LD + manifest)
- `img/favicon.ico`
- `img/field-forms.jpg` — manual ergonomics ("Before" panel + OG image placeholder)
- `img/demo-source-video.mp4` — source recording (hero + science + demo)
- `img/demo-mesh.glb` — animated 3D body model (hero + demo, via the custom Three.js viewer)
- `img/team-0.jpg`, `img/team-1.jfif` — team portraits (about page)

**Unreferenced — safe to delete in cleanup:**
- All `easysense-*`, `easysense_*`, `app-*`, `easyergo_app*`,
  `tablet_easyergo*`, `background.png` — fictional Android app +
  EasySense hardware that don't exist
- All `dashboard-*.png` — old dashboard UI screenshots
- All `demo-skeleton-*`, `demo-walking-*`, `demo-video-evaluation-*`,
  `demo-3d-model.mp4` — old skeleton animations
- `easyergo_dashboard.jpg` — old dashboard hero
- `easyergo_pcb*.jpg` — kept in repo per your earlier flag, not
  currently referenced; reintroduce if you want a "hardware ancestry"
  callout later

## What's new in this redesign

| File | Status |
| --- | --- |
| `index.html` | Rewritten — single-product narrative, hero with live demo, 6 methods, interactive 3D, dashboard preview, integrations, CTA |
| `about.html` | Rewritten — same team + publications preserved, brand-aligned |
| `contact.html` | Rewritten — form + map preserved, brand-aligned |
| `privacy.html` | Rewritten — same legal substance, removed references to fictional Android app + EasySense |
| `404.html` | Rewritten — brand-aligned |
| `css/site.css` | New — mirrors dashboard's `--ee-*` tokens |
| `js/site.js` | New — vanilla JS, no jQuery / WOW / Owl / Easing / Counterup |
| `sitemap.xml` | New |
| `robots.txt` | New |
| `site.webmanifest` | New |
| `img/demo-mesh.glb` | Added (from `website_material/`) — 56 MB, see compression note |
| `img/demo-source-video.mp4` | Added (from `website_material/`) — paired with demo-mesh.glb |

## Stack changes

**Removed (no longer required):**
- jQuery 3.4.1
- WOW.js
- Owl Carousel
- Easing
- Counterup
- Animate.css (also bundled inside the old `style.css`)
- Tempus Dominus
- HTML Codex template footer attribution
- Customised `css/bootstrap.min.css` (we now load vanilla Bootstrap 5.3.3 from jsDelivr)

**Added:**
- Bootstrap 5.3.3 (CDN)
- Bootstrap Icons 1.11.3 (CDN)
- Google `<model-viewer>` 3.5.0 (CDN, lazy-loaded only when user clicks the demo)
- Brand-aligned `css/site.css` (≈ 13 KB)
- Vanilla `js/site.js` (≈ 2 KB)

Net effect: page weight on first load drops from ~1.2 MB of JS+CSS to
about 250 KB (excluding the optional 56 MB GLB which only loads on user
opt-in).
