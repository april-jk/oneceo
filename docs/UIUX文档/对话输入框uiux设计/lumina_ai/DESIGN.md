# Design System Document: The Ethereal Intelligence

## 1. Overview & Creative North Star
**Creative North Star: The Digital Curator**
This design system moves away from the rigid, blocky layouts of early-gen AI tools toward an "editorial workspace" aesthetic. The goal is to feel less like a chat app and more like a high-end publishing tool. We achieve this through **Soft Minimalism**: a philosophy that prioritizes intentional whitespace, tonal depth over structural lines, and a "breathing" layout that adapts to the fluidity of AI-generated content.

By utilizing large radii (`16px+`), asymmetric content grouping, and a sophisticated hierarchy of grayscale, we create an experience that feels premium, professional, and undeniably modern—drawing inspiration from the precision of Linear and the clean execution of Vercel.

---

## 2. Colors
Our palette is rooted in a "Clean White" foundation, using vibrant purple only to signal intelligence and selection.

### Tone & Role
*   **Background (`#f8f9fa`):** The canvas. This is a deliberate "off-white" to reduce eye strain and provide a base for the brightest elements.
*   **Surface Lowest (`#ffffff`):** Reserved for primary content containers (cards, chat bubbles) to make them "pop" against the background.
*   **Primary (`#6b38d4`):** Our signature purple. Used sparingly for high-intent actions, active states, and highlights.
*   **On-Surface (`#191c1d`):** Deep gray (not pure black) for text, ensuring high legibility while maintaining a soft, premium feel.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to section off major areas of the UI. Sectioning must be achieved through:
1.  **Background Shifts:** Placing a `surface_container_low` sidebar against a `surface` main area.
2.  **Shadow Depth:** Using elevation to define the edge of a container.
3.  **Negative Space:** Using the Spacing Scale to create "gutters" of air that act as invisible boundaries.

### Signature Textures
To add "soul," use a subtle linear gradient on primary buttons or active chips:
*   **Direction:** 135deg
*   **From:** `primary` (#6b38d4) 
*   **To:** `primary_container` (#8455ef)

---

## 3. Typography
We utilize **Inter** for its neutral, mathematical precision. The hierarchy is designed to feel editorial.

*   **Display & Headline Scale:** Use `display-sm` (2.25rem) for empty states or welcome screens. Large type should have a slightly tighter letter-spacing (-0.02em) to feel authoritative.
*   **The Body-Label Relationship:** 
    *   **Body-lg:** Use for AI responses. It provides a comfortable reading rhythm.
    *   **Label-md:** Use for metadata, timestamps, and secondary UI elements. 
*   **Visual Soul:** Treat the typography as a structural element. Align text to a generous left margin to create an intentional asymmetric "spine" down the interface.

---

## 4. Elevation & Depth
In this system, depth is biological, not mechanical.

### The Layering Principle
Hierarchy is achieved by stacking surface tiers. A typical stack looks like this:
1.  **Level 0 (Base):** `surface` (#f8f9fa)
2.  **Level 1 (Sub-section):** `surface_container_low` (#f3f4f5)
3.  **Level 2 (Floating Element):** `surface_container_lowest` (#ffffff)

### Ambient Shadows
For floating panels (like a command menu or a prompt box), use the following shadow spec:
*   **X: 0, Y: 12, Blur: 40**
*   **Color:** `on_surface` (#191c1d) at **4% opacity**.
This mimics natural light and prevents the "dirty" look of heavy shadows.

### Glassmorphism & Ghost Borders
When an element overlaps content (e.g., a sticky header), use `surface_container_lowest` at 80% opacity with a `backdrop-blur: 12px`. 
If a border is required for accessibility, use a **Ghost Border**: `outline_variant` at 20% opacity. Never use 100% opaque borders.

---

## 5. Components

### Input Fields (The Prompt Box)
The "Heart" of the system.
*   **Style:** Large radius (`xl`: 1.5rem), `surface_container_lowest` background.
*   **Border:** Ghost Border (10% opacity `outline`).
*   **State:** On focus, the border transitions to a subtle glow using `primary` at 20% opacity.

### Buttons
*   **Primary:** Gradient fill (Primary to Primary-Container), white text, `xl` radius.
*   **Secondary:** Ghost Border with `on_surface` text.
*   **IconButton:** Use a `full` (9999px) radius for a circular, tool-like feel.

### Chips & Tags
Used for model selection (e.g., "GPT-4") or tags.
*   **Unselected:** `surface_container_high` background with `on_surface_variant` text.
*   **Selected:** `primary_fixed` background (#e9ddff) with `on_primary_fixed_variant` text (#5516be).

### Cards & Chat Bubbles
*   **No Dividers:** Never use lines between messages. Use vertical spacing (`1.5rem` to `2rem`) to separate AI and User turns.
*   **The User Bubble:** Use `surface_container_low` to distinguish from the AI's white `surface_container_lowest` background.

---

## 6. Do's and Don'ts

### Do
*   **DO** use plenty of "air." If a layout feels cramped, double the spacing.
*   **DO** use vertical asymmetry. Let content find its natural length rather than forcing everything into equal-height boxes.
*   **DO** use the `primary` accent color for "Intelligence Moments"—like an sparkle icon or a progress bar while the AI is thinking.

### Don't
*   **DON'T** use pure black (#000000) for text. It breaks the "Ethereal" softness of the system.
*   **DON'T** use 1px solid gray borders for every container. It makes the UI look like a spreadsheet.
*   **DON'T** use small corner radii. If it’s not rounded (`12px-16px`), it doesn't belong in this system.
*   **DON'T** clutter the interface with too many icons. Use clear typography first.