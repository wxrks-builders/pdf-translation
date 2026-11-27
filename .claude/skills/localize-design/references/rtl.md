# Right-to-left layouts

Arabic, Hebrew, Persian (Farsi), Urdu, Pashto, Sindhi, Uyghur, Yiddish,
Dhivehi and Central Kurdish are written right to left. A right-to-left
interface is the left-to-right one seen in a mirror: the start of everything
moves to the right.

## Turning it on

- Set `dir="rtl"` and `lang` on `<html>` from the active locale. Don't set
  direction with CSS (`direction: rtl`) on the page; use the attribute, so
  the browser, assistive technology and form controls all know.
- One stylesheet for both directions, written with logical properties (the
  table in `SKILL.md`). Override with `[dir="rtl"]` or Tailwind's `rtl:`
  variant only for what logical properties can't express.

## What mirrors

- Page layout: navigation start, sidebars, the side a drawer or sheet slides
  in from, column order in grids and tables, form label alignment.
- Reading-direction icons: back and forward arrows, chevrons on list rows
  and breadcrumbs, next and previous, undo and redo, reply and forward,
  indentation and alignment icons.
- Progress that fills along a line (a step indicator, an upload bar).
- Carousels and sliders: the first item is on the right, and "next" moves
  left. Swipe directions follow.
- Animations that slide in from the start side.
- Shadows and offsets that imply a light source are fine either way; keep
  them if they are decorative.

## What stays

- Logos, brand marks, and wordmarks.
- Icons of real objects (a camera, a headset, a phone), unless the object
  itself implies direction in a way users would read as wrong.
- Clocks and anything that turns clockwise.
- Numbers, phone numbers, prices, dates written in digits, and code. They
  stay left to right inside right-to-left text.
- Media playback controls and their timeline are commonly left unmirrored.
- Charts: decide per chart with someone who reads the language. Time axes
  and bar order are not always mirrored.

Android's guidance, which applies anywhere: if mirroring an image changes
what it means, mirror its parts by hand, and check with someone who reads
the language.

## Text inside text

The Unicode bidirectional algorithm orders mixed text automatically, and
gets it wrong when a direction-neutral value (a number, a username, a
product name) sits at the edge of a phrase.

- Wrap inserted values in `<bdi>`: `<bdi>{username}</bdi> commented`.
- Give user-generated content and text inputs `dir="auto"`.
- Phone numbers and other values that start with digits or `+` need an
  isolate (`<bdi>`, `dir="ltr"` on the element, or `BidiFormatter` on
  Android) or they render out of order.
- Don't insert Unicode control characters (RLM, LRM) by hand in messages
  unless a translator asks for them.

## Platform notes

- **Tailwind**: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`,
  `text-start`, `text-end`, `border-s`, `border-e`, `rounded-s`, `rounded-e`
  and the `rtl:` and `ltr:` variants.
- **shadcn/ui**: the CLI converts components to logical classes when RTL is
  enabled (added January 2026).
- **React Native**: `marginStart`, `paddingEnd`, `start`, `end`; enable RTL
  in the app config, read `I18nManager.isRTL`, and reload the app after
  changing direction.
- **Flutter**: `EdgeInsetsDirectional`, `AlignmentDirectional`,
  `PositionedDirectional`; direction follows the locale.
- **SwiftUI and UIKit**: leading and trailing mirror automatically; images
  flip with `.flipsForRightToLeftLayoutDirection(true)`.
- **Android**: `start` and `end` attributes, `android:supportsRtl="true"`,
  and `android:autoMirrored="true"` on drawables whose meaning is a simple
  mirror image.

## Testing

- Switch to an Arabic or Hebrew locale, or set `dir="rtl"` on `<html>` and
  use the pseudo-locale with `--bidi`.
- Android: Developer options, "Force RTL layout direction".
- Look for: anything still anchored to the left, arrows pointing into the
  content instead of along it, numbers rendering out of order, carousels
  moving the wrong way, and focus order that no longer matches the visual
  order.
