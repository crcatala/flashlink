# Findings: Finder Sync spike (rf-og97)

Fill this in on the Mac. Delete lines that do not apply. Paste exact error text when something fails.

## Environment

- macOS version / build:
- Mac (Apple Silicon / Intel):
- Xcode version:
- Signing mode that worked: ad hoc / personal team / neither (circle one). `codesign -dvv` shows `Signature=` and `TeamIdentifier=`:
- Did the extension load with ad hoc signing? yes / no (error text if no):

## Results

| #   | Step                                                    | Result (pass / fail / notes) |
| --- | ------------------------------------------------------- | ---------------------------- |
| 1   | `test-handoff.sh` passes, notification from r2-fastlink |                              |
| 2   | Root-level menu with submenu (screenshot)               |                              |
| 3   | Desktop                                                 |                              |
| 3   | Documents                                               |                              |
| 3   | Downloads                                               |                              |
| 3   | A subfolder                                             |                              |
| 3   | External volume                                         |                              |
| 3   | Network volume                                          |                              |
| 3   | iCloud Drive                                            |                              |
| 3   | Same list with `WATCH=home`                             |                              |
| 4   | One file → log + notification                           |                              |
| 4   | Several files → all paths in the log                    |                              |
| 4   | All four lifetimes map to 15m / 1h / 1d / 7d            |                              |
| 5   | Names with spaces, quotes, unicode, leading dash        |                              |
| 6   | 200+ files in one selection                             |                              |
| 7   | Survives logout/login without extra commands            |                              |
| 7   | Rebuild: new build loads without `killall Finder`       |                              |
| 7   | Hand-off relaunches the host app if it is quit          |                              |
| 8   | Gatekeeper / privacy prompts                            |                              |

## Which `directoryURLs` setting is needed

(`/` covers everything / only home + volumes / other)

## Verdict

VIABLE / VIABLE WITH CAVEATS / NOT VIABLE

Caveats or evidence (error messages):

## Recommendation

Design the real Finder-only app / stay with the Quick Action / try an Apple Shortcut, because:
