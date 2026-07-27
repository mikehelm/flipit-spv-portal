## What Next

This project is enrolled in Mike's What Next dashboard as "Flipit SPV Investor Portal".
Project view: http://127.0.0.1:4177/?project=flipit-spv-investor-portal

Treat What Next as the current source of truth for this project. Update it for every material work step: RUN before work; DONE, WAIT, or BLK when the step ends; one current recommendation for the next action; and a revision for each meaningful viewable or notes-only change.

Use these lifecycle commands:

```bash
node /Users/otto/Documents/STUFF/whatnext-dashboard/scripts/whatnext.js setup --project "Flipit SPV Investor Portal" --path "$PWD"
node /Users/otto/Documents/STUFF/whatnext-dashboard/scripts/whatnext.js event --project "Flipit SPV Investor Portal" --type RUN --status active --message "Short current status."
node /Users/otto/Documents/STUFF/whatnext-dashboard/scripts/whatnext.js event --project "Flipit SPV Investor Portal" --type DONE --status done --message "What was verified."
node /Users/otto/Documents/STUFF/whatnext-dashboard/scripts/whatnext.js recommend --project "Flipit SPV Investor Portal" --title "Recommended next step" --summary "Why this is next." --prompt "Exact Codex-ready prompt."
```

Enrollment modes: project-board, revision-viewer
