---
name: taste-skill
description: Frontend taste skill and anti-slop design framework. Guides layout composition, visual density, typography, and purposeful art direction based on high-end web design references (Awwwards, Linear, Vercel, Apple, Stripe) rather than generic AI templates. Use when crafting distinctive, production-grade landing pages and product frontends.
version: 2.0.0
---

# Taste Skill: Frontend Design & Anti-Slop Framework

A framework for crafting distinctive, memorable, and human frontends, preventing generic "AI slop" (warm cream clichés, purple glows, identical 3-card grids, and bloated pages).

## Core Principles

1. **Read the Room & Understand Subject Truth**:
   - Understand the product's actual domain, velocity, and user context.
   - For real-time transit and logistics: precision, high contrast, telemetry, speed, crisp lines, clear live indicators, and dependable usability under bright sunlight or mobile glare.
   - Do not force editorial museum/sepia aesthetics onto a live transport GPS tool.

2. **The Anti-Slop Ban List**:
   - **No card soup**: Do not wrap every single piece of information in identical rounded cards with subtle borders. Vary the container depth, use dividing rules, asymmetry, and full-width stages.
   - **No fake dashboard screenshots or bloated empty stages**: Use functional, high-fidelity UI components at true scale.
   - **No generic purple-indigo gradients or arbitrary warm stone backgrounds**: Choose palettes derived from the brand and operational domain (e.g., deep modern obsidian `#030712`, vibrant electric transit blue `#0284c7` / `#0ea5e9`, signal emerald `#10b981`, crisp dark slate).
   - **No decorative oversized controls**: Form elements, switches, and sliders must be functional and scaled to human ergonomic proportions, not 600px wide decorative artifacts.

3. **Hierarchy & Rhythm**:
   - Establish dramatic scale steps in typography (clear jump from Display/H1 to Body/Labels).
   - Tight groups, generous separation: keep related data compact (e.g., ETA + Stop name) while giving breathing room between thematic sections.
   - Keep page length proportionate to the information density (3–4 punchy, high-value screens rather than 8+ screens of empty fluff).

4. **Visual Density & Typography**:
   - Choose clean, authoritative typefaces (`Inter`, `SF Pro Display`, `Geist`, `Plus Jakarta Sans`) with tight display tracking (`-0.02em` to `-0.03em`) on large headings and neutral tracking on body.
   - Ensure AAA/AA contrast ratios (4.5:1 minimum for body text, 3:1 for large display elements).
   - Real data readouts: live badges, bus unit tags, official stops, and accurate route milestones.

5. **Motion with Intent (Emil Kowalski alignment)**:
   - Snappy transitions under 250ms with custom cubic bezier curves (`cubic-bezier(0.23, 1, 0.32, 1)`).
   - Micro-interactions that give instant tactile feedback on active states (`scale(0.98)`).
   - Never use `transition: all` or `ease-in` on UI entry points.
