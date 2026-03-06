# Glitter Map — Project Context & UX/UI Analysis

## What Is This Project?

**Glitter Map** is a 2D browser-based festival exploration game built with **Phaser 3**, **TypeScript**, and **Vite**. Players navigate a tiled festival venue map as an avatar character, walk up to vendor/exhibitor booths, and view detailed information about each stand (participants, categories, social media handles).

It is an interactive digital festival guide wrapped in a lightweight game experience — ideal for events like Festival Glitter where attendees can discover artisans, vendors, and exhibitors through exploration rather than a static list.

---

## Tech Stack

| Technology | Version | Role |
|------------|---------|------|
| Phaser | 3.90.0 | 2D game engine (scenes, sprites, tilemaps, physics, input) |
| TypeScript | 5.7.2 | Type-safe development |
| Vite | 6.3.1 | Build tool and dev server |
| Arcade Physics | built-in | Collision and overlap detection |
| Tiled JSON | — | Map format (`public/assets/map_glitter.json`) |
| REST API | — | Stand/participant data via `VITE_API_BASE_URL` |

---

## Architecture

### Scene Flow (linear)
```
FestivalSelect → CharacterSelect → Game (exploration)
```

### Key Files

| File | Role |
|------|------|
| `src/game/main.ts` | Phaser game config and scene registry |
| `src/game/scenes/FestivalSelect.ts` | Festival picker screen |
| `src/game/scenes/CharacterSelect.ts` | Character picker screen |
| `src/game/scenes/Game.ts` | Main game: map, player, stands, popup (~741 lines) |
| `src/types/stands.ts` | `FestivalStand` TypeScript type definition |
| `public/assets/map_glitter.json` | Tiled map data (40x30 tiles, 1280x960px) |
| `public/assets/tileset.png` | Floor/environment tiles |
| `public/assets/mesas.png` | Booth/table tiles |
| `public/assets/entities/` | Character spritesheets (federico.png, theo.png) |

### Environment Variables
```
VITE_API_BASE_URL=http://localhost:3000/api
VITE_FESTIVAL_ID=1
```

### API
- Endpoint: `GET /festivals/{festivalId}/stands`
- Returns: list of stands, each with participants (name, category, socials, image)

---

## Core Mechanics

- **Movement**: WASD / Arrow keys + touch drag with momentum decay (0.12/frame)
- **Camera**: 1.5x zoomed main cam following player (0.1 easing) + fixed UI cam
- **Stand detection**: physics overlap zones placed from Tiled object layer "Stands"
- **Stand popup**: appears at screen bottom when player enters a zone; shows participants, categories, and social handles fetched from the API
- **Map size**: 40×30 tiles at 32px = 1280×960 world pixels
- **Player speed**: 160 px/s; hitbox 20×16px (feet-positioned for better feel)
- **Responsive**: scales to full viewport, popup width clamps to `min(480, screen-32)`

### Data Flow
```
HTML entry → main.ts → Phaser config → FestivalSelect
→ CharacterSelect → Game.preload() (loads tilemap + API)
→ Game.create() (spawns player, places stand zones)
→ Game.update() (movement, overlap detection, animation)
```

### Stand Data Cache
Stand data is memoized by key (`stand_{label}{number}`) to avoid redundant lookups when a player re-enters a zone.

---

## Visual Design System

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#f7f5fa` | Pale canvas and scene backgrounds |
| Surface | `#ffffff` | Cards, buttons, and popup panels |
| Surface muted | `#f1edf8` | Hover states and soft UI fills |
| Border | `#bfaae4` | Default card and panel outlines |
| Primary accent | `#6822e2` | Main Glitter purple for titles, borders, selected states, and action labels |
| Accent soft | `#e6dbfb` | Hover fills and soft selected-state tint |
| Text default | `#372654` | Body text on light surfaces |
| Text secondary | `#675a7c` | Supporting labels and metadata |
| Overlay | `#231736` at 18% | Popup backdrop over the map |

---

## UX/UI Improvement Opportunities

### P1 — High impact, low/medium effort

| # | Issue | Suggestion |
|---|-------|------------|
| 1 | **No visual cue that booths are interactable** | Floating label or pulsing "!" icon above stand zones when the player is nearby. Guides discovery without cluttering the map. |
| 2 | **Popup appears and disappears instantly** | Slide-in from bottom on open (200–300ms tween Y from off-screen), fade/slide-out on close. Makes interactions feel polished. |
| 7 | **Social handles are display-only text** | Make them tappable links that open the profile URL in a new tab. Users naturally expect social info to be actionable. |

### P2 — Medium impact

| # | Issue | Suggestion |
|---|-------|------------|
| 4 | **Loading screen is just pulsing text** | Add festival logo/name and a real progress bar using Phaser's `this.load.on('progress')` callback. |
| 5 | **Empty popup when stand has no participants** | Show a friendly placeholder ("No hay información disponible para este stand") instead of a blank panel. |
| 6 | **Back button exits game without confirmation** | Add a confirmation dialog ("¿Salir del festival?") to prevent accidental fat-finger exits. |
| 11 | **No feedback when entering a stand zone** | Briefly flash/highlight the zone on overlap to signal the interaction trigger. Show an inline spinner if API data is still loading. |
| 12 | **Festival select screen always shown, even with one option** | If the API returns only one festival, skip the selection screen and auto-proceed. Removes a redundant click. |

### P3 — Lower priority or higher effort

| # | Issue | Suggestion |
|---|-------|------------|
| 3 | **Input doesn't resume cleanly after popup close** | Clear stale touch/drag state on popup close so the player can move immediately on mobile. |
| 8 | **Character selection cards have no descriptions** | Add a one-line flavor text per character. Makes the choice feel intentional even if it's cosmetic. |
| 9 | **No map overview / minimap** | A corner minimap with player dot and stand markers would dramatically improve orientation on larger festivals. |
| 10 | **Drag indicator is hard to see** | The white circle at 25% opacity disappears on light tiles. Add a drop shadow or dark outline, or replace with a directional arrow sprite. |
| 13 | **No keyboard navigation inside the popup** | Tab through participants/links, Enter to open a social link, ESC to close. Improves accessibility. |
| 14 | **Generic system font** | Load a custom or Google font to match the festival's visual identity. Even one display font for headings would elevate the brand feel significantly. |

---

## Development Commands

```bash
npm run dev          # Dev server (port 8080)
npm run dev-nolog    # Dev server without analytics
npm run build        # Production build to /dist
npm run build-nolog  # Production build without analytics
```
