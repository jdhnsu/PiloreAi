---
name: PiLore
description: Fluent (Microsoft)-inspired AI coding-education app - light gray canvas, white cards, blue accent, segmented teaching personas.
version: alpha
colors:
  primary: "#0067C0"
  accent: "#0067C0"
  accent-hover: "#1975C5"
  accent-light: "#E8F1FA"
  on-accent: "#FFFFFF"
  bg: "#F3F3F3"
  card: "#FFFFFF"
  border: "#E5E5E5"
  text: "#1A1A1A"
  text-secondary: "#616161"
  danger: "#C42B1C"
  danger-bg: "#FDE7E9"
  success: "#0E700E"
  success-bg: "#DFF6DD"
  warning: "#9D5D00"
  warning-bg: "#FFF4CE"
  persona: "#8661C5"
  persona-bg: "#F3EEFC"
  persona-border: "#DDD0F2"
  surface-muted: "#FAFAFA"
  surface-soft: "#F5F5F5"
  surface-raised: "#EFEFEF"
  neutral: "#F0F0F0"
  code-keyword: "#0033B3"
  code-string: "#A31515"
  code-comment: "#107C10"
  code-number: "#098658"
  code-function: "#795E26"
  code-constant: "#0070C1"
  code-attr: "#E50000"
typography:
  body-md:
    fontFamily: 'Segoe UI Variable Text, Segoe UI, Microsoft YaHei, system-ui, sans-serif'
    fontSize: 0.875rem
    lineHeight: 1.6
  heading-app:
    fontFamily: 'Segoe UI Variable Text, Segoe UI, Microsoft YaHei, system-ui, sans-serif'
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.2
  heading-panel:
    fontFamily: 'Segoe UI Variable Text, Segoe UI, Microsoft YaHei, system-ui, sans-serif'
    fontSize: 0.875rem
    fontWeight: 600
  caption:
    fontFamily: 'Segoe UI Variable Text, Segoe UI, Microsoft YaHei, system-ui, sans-serif'
    fontSize: 0.75rem
  mono-sm:
    fontFamily: 'Cascadia Code, Consolas, monospace'
    fontSize: 0.78125rem
  mono-block:
    fontFamily: 'Cascadia Code, Consolas, monospace'
    fontSize: 0.75rem
  badge:
    fontFamily: 'Segoe UI Variable Text, Segoe UI, Microsoft YaHei, system-ui, sans-serif'
    fontSize: 0.75rem
    fontWeight: 600
  label-button:
    fontFamily: 'Segoe UI Variable Text, Segoe UI, Microsoft YaHei, system-ui, sans-serif'
    fontSize: 0.875rem
    fontWeight: 600
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  pill: 999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
components:
  brand-logo:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.lg}"
    size: 36px
    typography: "{typography.heading-app}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "9px 22px"
    typography: "{typography.label-button}"
  button-danger:
    backgroundColor: "{colors.card}"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
    padding: "8px 22px"
    typography: "{typography.label-button}"
  chip:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  badge-persona:
    backgroundColor: "{colors.persona-bg}"
    textColor: "{colors.persona}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  badge-persona-pilore:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
---

## Overview

PiLore is an AI coding-education assistant web app. The UI follows Fluent
(Microsoft) conventions: a calm light-gray canvas, white elevated cards, and a
single blue accent reserved for interaction. The result should feel like a
professional developer tool - quiet, precise, and code-forward - while keeping
chat output and the student "workspace" sidebar immediately legible.

The signature layout is a two-column grid: the chat stream and composer on the
left, a live VFS file workspace on the right. Teaching personas (Feynman,
Socrates, Oris) appear as purple-tinted badges; code and tool output use a
fixed-width Cascadia Code face throughout.

## Colors

The palette is a neutral-first system with one blue accent and a secondary
purple persona accent. Warm and cool status tints appear only on small badges
and backgrounds, never as large surfaces.

- **Accent (#0067C0):** The only interaction color - primary buttons, links,
  active states, focus rings, and the brand logo. Hover uses `accent-hover`;
  `accent-light` is its tinted fill for hover backgrounds and selected rows.
- **Neutrals:** `bg` (#F3F3F3) is the page canvas; `card` (#FFFFFF) is every
  elevated surface; `border` (#E5E5E5) separates cards and rows; `text`
  (#1A1A1A) carries primary copy and `text-secondary` (#616161) carries
  captions, metadata, and placeholder text.
- **Persona (#8661C5):** Reserved for teaching-persona accents - the active
  persona badge, the reset chip, and the "teacher" footer tag. Its light fill
  is `persona-bg` with `persona-border` on badges.
- **Status:** `danger` for errors and abort, `success` for tool `ok`, `warning`
  for demo mode. Each has a matching pale background token (`danger-bg`,
  `success-bg`, `warning-bg`).
- **Code syntax:** VS Code Light token colors (`code-keyword`, `code-string`,
  `code-comment`, `code-number`, `code-function`, `code-constant`,
  `code-attr`) are shared between chat code blocks and the file viewer so
  syntax looks identical everywhere.

Rule of thumb: background tints are only ever paired with their semantic text
color and occupy small badge or row surfaces. Do not introduce large colored
panels or gradients.

## Typography

- **Body:** Segoe UI Variable Text with Segoe UI, Microsoft YaHei, and
  system-ui fallbacks. Body text is 0.875rem (14px) at 1.6 line height.
- **Code:** Cascadia Code with Consolas fallback for every code block, inline
  code, tool name/args, file listing, and syntax output. Chat content renders
  markdown; code blocks get a language-tag header.
- **Headings:** The app title is 1rem/600; panel and chat-internal headings are
  0.875rem/600. Markdown headings inside a message do not escalate above body
  size - they stay 0.875rem/600 so the chat stream feels compact.
- **Badges and captions:** 0.75rem. Badges additionally set weight 600.

## Layout

The app is a full-height flex column (`100vh`): a 60px top bar, then a grid
main area, then the composer card docked at the bottom of the chat column.

- **Top bar:** 60px, white background, 1px bottom border, 20px horizontal
  padding. Left holds the brand (36px logo + title + subtitle); right holds
  badges and model info.
- **Main grid:** `minmax(0, 1fr) 300px` with 16px gap and 16/20px padding.
  The workspace sidebar is fixed at 300px.
- **Composer:** A card containing teacher chips, then a flexible textarea and a
  stacked send/abort button column. Textarea grows from 42px to 40vh.
- **Responsive:** Below 900px the grid collapses to one column and the
  workspace sidebar is hidden.

Use 8px-based spacing throughout (4/8/12/16/20/24). Cards and the chat column
use `xs` (8px) internal gaps; the page grid uses `md` (16px).

## Elevation & Depth

Elevation is deliberately shallow. Cards use a single subtle shadow and a 1px
border rather than layered shadows:

- Card shadow: `0 1px 2px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)`.
- Focus states use an outline ring (`0 0 0 2px accent-light`) plus a 1px
  `accent` border - no glow.
- Hover feedback is tinted background or border change only (e.g. `accent-light`
  fills, `accent` borders), never elevation jumps.

## Shapes

- **Radius scale:** sm 4px, md 6px, lg 8px, pill 999px.
- Cards use `lg` (8px); inputs, buttons, tool cards, and code blocks use `md`
  (6px); inline code uses `sm` (4px).
- Pills are reserved for badges, tags, status, chips, and scrollbar thumbs.
- User message bubbles use asymmetric corner treatment:
  `12px 12px 4px 12px`.
- The brand logo is a 36px accent square with `lg` radius holding the "π" glyph.

## Components

- **Top bar:** white, 60px, 1px bottom border. Brand left, badge/model right.
- **Cards:** white background, 1px `border`, `lg` radius, card shadow. Used for
  the welcome panel, composer, and workspace sidebar.
- **Primary button:** `accent` fill, white text, 6px radius, weight 600.
  Disabled state is flat #A9A9A9.
- **Danger button:** white fill, 1px `danger` border, `danger` text.
- **Chips (teacher selector):** white pill with `border`, secondary text; hover
  shifts to persona palette. The reset chip is persona-outlined.
- **Badges:** pill tokens - `persona` purple for teacher tags, `neutral` gray
  for the PiLore (auto) tag, `warning` for demo mode.
- **Messages:** user messages are right-aligned blue bubbles (max-width 72%,
  `12px 12px 4px 12px`); assistant messages are left-aligned full-width cards
  with a `persona-line` banner and a footer persona tag.
- **Tool cards:** bordered muted surface (`surface-muted`) with a header row
  (glyph, mono name, ellipsized mono args, status pill) and a bordered mono
  output region (max-height 220px, scrollable).
- **File workspace:** file list items are mono 12.5px; active item gets
  `accent-light` fill + `accent` border. The file view is a bordered block with
  a `surface-raised` header (name + copy button) and a full mono body.

## Do's and Don'ts

- Do keep the interaction accent as the single blue driver; use persona purple
  only for teaching-persona indicators.
- Do use Cascadia Code (mono) for all code, tool names, file paths, and syntax
  output - never render code in a proportional font.
- Do reserve pills for status and identity tags; use 6–8px radii for controls
  and surfaces.
- Do show syntax highlighting with the shared VS Code Light token set in both
  chat and the file viewer so colors stay consistent.
- Do keep elevation flat: 1px borders + one subtle shadow, focus rings not
  glows.
- Do keep the chat stream compact - markdown headings inside messages must not
  outsize the body text.
- Don't add large colored panels, gradients, or vignettes; the canvas stays
  flat #F3F3F3 with white cards.
- Don't invent new semantic hues; use the status tokens (danger/success/
  warning) only with their matching pale backgrounds.
- Don't place `accent` on large passive surfaces - it is for interactive
  elements and their states.
