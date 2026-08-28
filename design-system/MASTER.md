# MusicFreeTV Design System

## Direction

MusicFreeTV is a ten-foot music interface for Android TV. It keeps MusicFree's
content-first structure while replacing the phone-density presentation with an
"Obsidian Stage" visual language: restrained dark surfaces, generous spacing,
large type, crisp artwork, and a single vivid play accent.

The interface must feel premium and quiet. Avoid decorative gradients, noisy
glass effects, excessive shadows, small controls, dense text, touch-only
gestures, and animation without navigational meaning.

## Semantic colors

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#080A0F` | App background |
| `surface` | `#11151D` | Navigation and cards |
| `surfaceRaised` | `#181E29` | Focused/active surfaces |
| `surfaceSoft` | `#202735` | Secondary controls |
| `textPrimary` | `#F8FAFC` | Main text |
| `textSecondary` | `#A7B0C0` | Metadata |
| `textMuted` | `#707A8C` | Disabled/supporting text |
| `brand` | `#8B7CFF` | Selection and brand identity |
| `play` | `#22C55E` | Play state and primary play action |
| `focus` | `#E9E7FF` | D-pad focus ring |
| `danger` | `#FB7185` | Destructive actions |
| `scrim` | `rgba(0,0,0,0.64)` | Dialog isolation |

Primary text must maintain at least 4.5:1 contrast. Focus is never communicated
by color alone: every focused element also gains a 3dp ring, raised surface,
and subtle scale.

## Typography

Use the Android system sans-serif family so Chinese and Latin text render
consistently without network fonts.

| Role | Size | Weight | Line height |
| --- | --- | --- | --- |
| Hero | 44sp | 700 | 52sp |
| Page title | 32sp | 700 | 40sp |
| Section title | 24sp | 600 | 32sp |
| Card title | 20sp | 600 | 28sp |
| Body | 18sp | 400 | 27sp |
| Metadata | 16sp | 400 | 23sp |
| Label | 15sp | 600 | 20sp |

Use at most two lines on cards and prefer wrapping to unexplained truncation.
Timers use tabular figures.

## Layout

- Design baseline: 1920x1080 landscape; remain usable from 1280x720 upward.
- Screen safe area: 64dp horizontal and 48dp vertical.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64dp.
- Persistent navigation rail: 224dp expanded, 88dp compact.
- Content grid: adaptive 4-6 columns, minimum card width 224dp.
- Bottom now-playing rail: 104dp; scroll content reserves its full height.
- Avoid nested vertical scroll regions. Horizontal carousels must expose their
  direction and restore the last focused child.

## Remote interaction

- D-pad: spatial navigation in the visual direction.
- Center/Enter: activate or play.
- Back: close overlay, then navigate up, then request app exit at root.
- Play/Pause media key: toggle playback from every screen.
- Next/Previous media keys: change track.
- Menu key or long center: open contextual actions where available.
- Every action reachable by touch must also be reachable by the remote.
- Initial focus is deterministic. Returning to a page restores its last focus.
- Never trap focus inside a list or behind a modal.

## Focus and motion

- Default target size is at least 64dp high; icon controls at least 56x56dp.
- Focus transition: 160ms ease-out using opacity/transform only.
- Focused cards scale to 1.035, use `surfaceRaised`, a 3dp `focus` ring, and a
  restrained elevation. Layout bounds do not change.
- Pressed cards scale to 0.985 for 90ms.
- Page transitions are 180-240ms and express hierarchy.
- Loading beyond 300ms uses skeletons or a visible progress indicator.
- Respect reduced-motion settings by disabling scale and large transitions.

## Component rules

- Use one outline icon family throughout; never use emoji as structural icons.
- Cards prioritize artwork, title, artist, and one state indicator.
- One primary action per surface. Secondary actions are quieter but focusable.
- Dialogs use a 64% scrim, contain a predictable focus loop, and restore focus
  to their trigger when closed.
- Errors state the cause and a remote-focusable recovery action.
- Empty states explain what is missing and expose one clear next step.

## Core screen composition

- Home: navigation rail, hero now-playing area, recent/recommended rows, and
  persistent mini player.
- Sheet/album/artist: artwork and metadata on the left, focusable track list on
  the right, with Play All as the first action.
- Search: remote-friendly search entry, recent terms, then a result grid; never
  force an on-screen keyboard before the user selects the field.
- Player: large artwork, title/artist, progress, primary controls, and readable
  synchronized lyrics with no phone-only swipes.
- Settings: two-pane categories and values; destructive actions separated.

## Acceptance checklist

- All visible actions are reachable with D-pad and have a visible focus state.
- Back behavior is predictable and overlays restore prior focus.
- Text and focus contrast pass WCAG AA.
- No content is hidden behind the now-playing rail or TV overscan safe area.
- Long lists remain virtualized and remote response feedback begins under 100ms.
- Android TV launcher, banner, landscape mode, and media-key behavior work.
- Phone-origin features remain available unless Android TV lacks the underlying
  hardware or system capability; unavailable features explain why.
