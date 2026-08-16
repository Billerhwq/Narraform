# Design System - Narraform AI 文案助手

## Component System

- ByteDance Arco Design React is the UI and icon library.
- Use library buttons, inputs, selects, drawers, modals, alerts, tags, messages and loading states.
- Do not recreate standard controls with custom HTML when Arco provides them.

## Visual Direction

- Intercom-inspired conversational clarity combined with Notion-inspired document editing.
- Primary `#175CD3`, cool white work surfaces, quiet gray canvas and charcoal text.
- Intercom principles drive the assistant, feedback and composer; Notion principles drive the editable document, history and versions.
- Use 7-8px rectangular controls, restrained hairline borders and almost no elevation.
- The conversation and editable copy are the visual focus.
- Avoid dashboards, marketing heroes, colorful feature-card grids, gradients and dark sidebars.

## Information Architecture

Desktop navigation contains only:

- 新建文案
- 开始创作
- 内容记录
- 最近内容

The creation screen contains:

- AI conversation
- Editable title, summary, body and topics when required by the platform
- One persistent composer
- Progressive drawers for materials, quality and versions

Do not show image previews, platform publishing controls, Skill names or internal execution steps.

## Interaction

- Enter sends; Shift+Enter inserts a line break.
- Materials are added through one drawer: upload, paste text or webpage URL.
- Generated copy remains editable in place.
- Quick rewrite creates a version before replacing the current result.
- Save and copy rerun quality and source-isolation checks.
- Unsaved edits trigger navigation protection and recover from local draft storage.

## Responsive Rules

- Desktop uses a quiet 220px navigation rail with a soft-blue active state.
- Under 900px, navigation moves into a left drawer.
- Mobile keeps the composer visible and stacks result actions.
- No horizontal overflow at 320px and above.
- Respect reduced-motion preferences and visible keyboard focus.
