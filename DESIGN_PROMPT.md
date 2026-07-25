# Figma AI design prompt

Copy everything below and paste it into Figma AI.

---

Design a production-ready responsive admin dashboard for a product named
"WhatsApp Status Auto-Viewer". This is an operational tool, not a marketing
landing page. It is used by one administrator to connect a WhatsApp session
through a QR code, manage tracked contacts, monitor viewed statuses, and inspect
real-time system logs.

## Visual direction

- Use a strict black, white, and red visual system.
- Primary background: near-black `#090909`.
- Secondary surfaces: `#111111` and `#181818`.
- Primary text: white `#F5F5F5`.
- Secondary text: neutral gray `#9A9A9A`.
- Primary accent and critical actions: vivid red `#E11D2E`.
- Success may use restrained green only for a small connected indicator.
- Do not use gradients, glassmorphism, glowing blobs, purple, blue accents,
  beige colors, stock photography, or decorative illustrations.
- Use thin neutral borders, subtle shadows, square geometry, and 6-8px corner
  radii.
- The result should feel fast, technical, controlled, premium, and suitable for
  repeated daily use.
- Use Inter or Geist typography with normal letter spacing.
- Use Lucide-style icons for logout, reset, remove, password visibility, and
  other familiar actions.

## Layout

- Create a 1440px desktop frame and a 390px mobile frame.
- Desktop content max-width should be approximately 1200px.
- Use a compact header with the product name on the left and connection status
  plus logout action on the right.
- Use a two-column operational dashboard on desktop and one column on mobile.
- Keep information dense, easy to scan, and consistently aligned.
- Do not put cards inside other cards.
- Avoid oversized headings and marketing-style hero composition.

## Screen 1: Login

- Centered compact login panel.
- Product name: "Status Bot".
- Username input.
- Password input with a show/hide icon.
- Red primary button: "Sign in".
- Inline invalid credentials state.
- Rate-limit state: "Too many attempts. Try again later."
- Loading and disabled states for the submit button.
- No illustration and no marketing copy.

## Screen 2: Dashboard waiting for QR

- Header title: "WhatsApp Status Auto-Viewer".
- Small status indicator: "Waiting for QR".
- Logout icon button with tooltip.
- Connection section containing a large square, high-contrast QR code.
- Secondary "Reset session" action with refresh icon.
- One short QR scanning instruction.
- Add target form with phone/JID input, optional name input, and red
  "Start tracking" button.
- Active target list with label, full JID, and remove icon action.
- Live feed with newest events first.
- Logs console with timestamp, severity, and message columns.

## Screen 3: Connected dashboard

- Compact connected indicator.
- Replace the QR code with a clear active-session state.
- Make it obvious that real-time status monitoring is running.
- Keep target management, live feed, and logs visible.

## Required states

- Empty targets: "Watching all contacts because the target list is empty."
- Empty feed: "No viewed statuses yet."
- Viewed status row: timestamp, contact name, phone/JID, read latency, and
  WhatsApp lag.
- Deleted status row with a distinct restrained red treatment.
- Log levels: info, success, warning, and error.
- Long JIDs and log messages must wrap or truncate safely.
- Confirmation dialog before resetting the WhatsApp session.
- Toast or inline feedback for successful and failed actions.

## Components

- Inputs: default, focus, error, and disabled.
- Buttons: primary, secondary, danger, icon-only, loading, and disabled.
- Connection status: disconnected, waiting for QR, connecting, and connected.
- Target row.
- Viewed feed row.
- Deleted feed row.
- Log row.
- Empty state.
- Login error.
- Reset confirmation dialog.

## Responsive requirements

- Nothing may overlap or overflow at 390px.
- Header actions must remain accessible on mobile.
- QR code must stay square and fully visible.
- Target form must become a vertical stack on mobile.
- Logs must remain readable without breaking the page width.
- Use stable dimensions so connection and loading states do not shift layout.

## Figma deliverables

- Desktop and mobile frames for all major screens.
- Auto Layout everywhere.
- Reusable components with variants and component properties.
- Variables for colors, typography, spacing, radii, and shadows.
- Clear layer and component naming.
- Hover, focus, active, disabled, loading, empty, error, and success states.
- Keep every design decision realistic for implementation in plain HTML, CSS,
  and JavaScript.

Do not invent additional product features. Preserve the existing information
architecture and functionality while making the visual design significantly
more polished and production-ready.

---
