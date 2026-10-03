import AppKit

// A background app (LSUIElement in Info.plist): no Dock icon, no windows. It only waits for
// r2fl-spike:// URLs from the Finder Sync extension.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
