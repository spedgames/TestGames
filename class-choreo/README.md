# Classroom Choreographer

A browser-based tool for planning classroom layouts and student rotations, then watching the plan play out. No installation, no backend — it's three static files (HTML/CSS/JS) that save your work in the browser's local storage.

## Using it

1. **Layout** — Add areas (Work with Teacher, Work on Own, Leisure, Group Time, or Custom), drag them into place, resize by the corner handle, and label them. Add as many of each type as you need.
2. **Roster** — Add your students (each gets a colored initials avatar) and optionally group them (e.g. "Reading Group") for bulk scheduling.
3. **Choreography** — Pick a student and build their ordered list of stops (area + minutes). Use **Bulk assign to a group** to add the same step to every student in a group at once, instead of one at a time.
4. **Playback** — Hit Play to watch avatars move between areas in real time (at your chosen speed), or drag the scrubber to jump to any point in the rotation. Students not currently scheduled anywhere sit in the "Not currently placed" tray.
5. **Templates** — Save your whole plan (layout + roster + groups + choreography) under a name, e.g. "Monday Math Rotation," and reload it on a future day.

Everything autosaves to your browser's local storage as you work — it's tied to this device/browser, so it won't follow you to a different computer. There's no file export yet; if you outgrow that, it's a natural next feature to add.

## Hosting it on GitHub Pages

1. Create a new GitHub repository (or use an existing one).
2. Add these three files (`index.html`, `style.css`, `app.js`) to the root of the repo — or to a `/docs` folder if you'd rather keep them tucked away.
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to "Deploy from a branch," pick your branch (e.g. `main`), and the folder (`/root` or `/docs`, matching step 2).
5. Save. GitHub will give you a URL like `https://yourusername.github.io/your-repo-name/` within a minute or two.

That's it — share that link with yourself or other teachers. Each person's data stays local to their own browser.

## Ideas for later, if useful

- Export/import a plan as a JSON file, so it can move between devices or be shared with a colleague
- Print-friendly view of a student's or the whole class's daily plan
- A "random/balanced group generator" for mixing skill levels
- Capacity warnings if too many students land in one area at the same time
- A bell/chime sound on transitions during live playback
