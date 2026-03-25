# Design System Strategy: The Precision Workbench

## 1. Overview & Creative North Star
**Creative North Star: The Technical Curator**

In the world of Enterprise O&M (Operations & Maintenance), "high density" often leads to "high anxiety." This design system rejects the cluttered, line-heavy aesthetic of legacy consoles in favor of **The Technical Curator**. Our goal is to present complex runtime data with the calm, authoritative clarity of a high-end architectural blueprint. 

We break the "enterprise template" look by utilizing **Tonal Architecture**. Instead of separating modules with rigid borders, we use subtle shifts in surface luminosity and intentional white space. This creates an environment that feels expansive and breathable, even when displaying thousands of data points. The layout is purposefully asymmetrical—leveraging a heavy left-aligned navigation to anchor the eye, while the "workbench" area uses layered surfaces to prioritize real-time flows.

---

## 2. Colors & Surface Philosophy
The palette is rooted in professional stability, using `primary` (#003d9b) and `secondary` (#006c47) to denote action and health, set against a sophisticated grayscale that leans into cool, architectural blues.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to define sections. 
*   **The Alternative:** Boundaries must be established through background shifts. A `surface_container_low` sidebar (#f3f4f6) sitting against a `background` (#f8f9fb) creates a sophisticated, "borderless" transition that reduces visual noise in high-density tables.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of materials:
*   **Level 0 (Base):** `background` (#f8f9fb) – The desk surface.
*   **Level 1 (Panels):** `surface_container_low` (#f3f4f6) – The primary workbench area.
*   **Level 2 (Active Cards):** `surface_container_lowest` (#ffffff) – Critical data modules or metric cards.
*   **Level 3 (Overlays):** `surface_bright` – Modals and popovers that require the highest focus.

### The "Glass & Gradient" Rule
To elevate the "Business Light" style, floating elements (like hover tooltips or global search) should utilize **Glassmorphism**. Use `surface_container_lowest` at 85% opacity with a `20px` backdrop blur. 
*   **Signature Texture:** For primary CTAs or the Header background, use a subtle linear gradient from `primary` (#003d9b) to `primary_container` (#0052cc) at a 135-degree angle. This adds a "lithographic" depth that flat colors lack.

---

## 3. Typography: Editorial Precision
We use **Inter** for its neutral, highly legible glyphs, paired with a specialized Monospace scale for technical veracity.

*   **Headlines (headline-sm/md):** Use these sparingly for major module titles. They should feel authoritative, using `on_surface` (#191c1e) with tight letter-spacing (-0.02em).
*   **The Data Layer (body-sm/label-md):** This is the workhorse. High-density tables must use `body-sm` (0.75rem). It provides the necessary "air" between rows while maintaining readability.
*   **Technical Monospace:** All IDs, JSON snippets, and Log entries must use a monospace font (e.g., JetBrains Mono or Roboto Mono) at `label-sm` (0.6875rem). This differentiates "system output" from "UI instruction."

---

## 4. Elevation & Depth
We eschew "Drop Shadows" in favor of **Tonal Layering** and **Ambient Light**.

*   **The Layering Principle:** Depth is achieved by stacking. A `surface_container_lowest` card placed on a `surface_container_low` background creates a natural lift.
*   **Ambient Shadows:** For floating modals (like the 1440px Workbench), use a shadow: `0 24px 48px -12px rgba(25, 28, 30, 0.08)`. The shadow color is derived from `on_surface`, not pure black, ensuring it feels like part of the environment.
*   **The Ghost Border:** If a separator is required for accessibility (e.g., in a high-density table header), use the `outline_variant` (#c3c6d6) at 20% opacity. It should be felt, not seen.

---

## 5. Components

### High-Density Tables
*   **Style:** No vertical lines. Horizontal lines are "Ghost Borders" (10% opacity `outline_variant`). 
*   **Row Height:** 32px or 36px.
*   **Interaction:** On hover, change the row background to `surface_container_high` (#e7e8ea).

### Status Tags (Chips)
*   **Success:** `secondary_container` background with `on_secondary_container` text.
*   **Error:** `error_container` background with `on_error_container` text.
*   **Neutral:** `surface_variant` background with `on_surface_variant` text.
*   **Geometry:** Use `roundedness.sm` (2px) for a more industrial, professional look—avoid "pill" shapes for status unless it's a clickable filter.

### Metric Cards & Sparklines
*   **Container:** `surface_container_lowest` (White).
*   **Shadow:** None. Use a 1px "Ghost Border" at 10% opacity.
*   **Sparklines:** Use `primary` for the stroke. Fill the area under the sparkline with a gradient from `primary` (10% opacity) to transparent.

### Fixed-Height Log Areas
*   **Background:** `inverse_surface` (#2e3132).
*   **Text:** `inverse_on_surface` (#f0f1f3).
*   **Padding:** Use `spacing.4` (0.9rem) for internal gutters to ensure the code "breathes" against the dark background.

---

## 6. Do's and Don'ts

### Do
*   **Do** use asymmetrical layouts. Let the 240px nav be a solid block of `surface_container_low`, while the main workbench remains `surface_container_lowest`.
*   **Do** use `spacing.2` (0.4rem) as your baseline for internal card padding to maintain high information density.
*   **Do** use `surface_tint` at 5% opacity for hover states on subtle buttons to maintain color harmony.

### Don't
*   **Don't** use 100% black text. Always use `on_surface` (#191c1e) to reduce eye strain during long O&M sessions.
*   **Don't** use standard "Material Design" rounded corners (8px+). Stick to `DEFAULT` (0.25rem) or `sm` (0.125rem) to keep the "Technical Workbench" aesthetic sharp and precise.
*   **Don't** use divider lines between list items. Use a `spacing.1` gap and a slight background color shift on the container.