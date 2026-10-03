import Cocoa
import FinderSync
import os

/// Root-level Finder context menu:
///
///     Share via r2-fastlink >  15 minutes | 1 hour | 1 day | 7 days
///
/// A click collects the selected items and opens `r2fl-spike://share?ttl=..&path=..` for the host app.
/// The extension itself only needs the App Sandbox entitlement; it never reads the files.
final class ShareFinderSync: FIFinderSync {
    private let log = Logger(subsystem: "dev.r2fastlink.spike", category: "extension")

    override init() {
        super.init()
        updateWatchedDirectories()
        // External and network volumes come and go; keep the watched set current.
        let nc = NSWorkspace.shared.notificationCenter
        nc.addObserver(self, selector: #selector(volumesChanged), name: NSWorkspace.didMountNotification, object: nil)
        nc.addObserver(self, selector: #selector(volumesChanged), name: NSWorkspace.didUnmountNotification, object: nil)
    }

    @objc private func volumesChanged(_ note: Notification) {
        updateWatchedDirectories()
    }

    /// Finder shows the menu only inside `directoryURLs`. Default: "/" (everything). Build with
    /// `WATCH=home ./run.sh` to try the home folder plus every mounted volume instead; the spike
    /// records which of the two covers Desktop, Documents, Downloads, subfolders and other volumes.
    private func updateWatchedDirectories() {
        #if WATCH_HOME
        var dirs: Set<URL> = []
        if let pw = getpwuid(getuid()), let home = pw.pointee.pw_dir {
            // NSHomeDirectory() is the sandbox container here, so ask the user database.
            dirs.insert(URL(fileURLWithPath: String(cString: home), isDirectory: true))
        }
        let volumes = FileManager.default.mountedVolumeURLs(
            includingResourceValuesForKeys: nil, options: [.skipHiddenVolumes]) ?? []
        for v in volumes where v.path != "/" { dirs.insert(v) }
        let mode = "home+volumes"
        #else
        let dirs: Set<URL> = [URL(fileURLWithPath: "/", isDirectory: true)]
        let mode = "root"
        #endif
        FIFinderSyncController.default().directoryURLs = dirs
        log.info("watching (\(mode, privacy: .public)): \(dirs.map(\.path).sorted().joined(separator: ", "), privacy: .public)")
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        // Right-click on selected items only (not the folder background, sidebar or toolbar).
        guard menuKind == .contextualMenuForItems else { return nil }
        let submenu = NSMenu(title: "")
        for (index, lifetime) in HandOff.lifetimes.enumerated() {
            let item = submenu.addItem(
                withTitle: lifetime.label, action: #selector(share(_:)), keyEquivalent: "")
            item.tag = index
            item.target = self
        }
        let menu = NSMenu(title: "")
        let root = menu.addItem(withTitle: "Share via r2-fastlink", action: nil, keyEquivalent: "")
        root.submenu = submenu
        return menu
    }

    @objc func share(_ sender: AnyObject?) {
        let item = sender as? NSMenuItem
        // The tag is what we set; the title is a fallback in case Finder's proxy item drops it.
        let lifetime = item.flatMap { i in
            HandOff.lifetimes.indices.contains(i.tag) ? HandOff.lifetimes[i.tag] : nil
        } ?? HandOff.lifetimes.first { $0.label == item?.title }
        let paths = (FIFinderSyncController.default().selectedItemURLs() ?? []).map(\.path)
        log.info("clicked tag=\(item?.tag ?? -1) title=\(item?.title ?? "?", privacy: .public) items=\(paths.count)")

        guard let lifetime, !paths.isEmpty, let url = HandOff.url(ttl: lifetime.ttl, paths: paths) else {
            log.error("nothing to hand off (lifetime=\(lifetime?.ttl ?? "nil", privacy: .public), items=\(paths.count))")
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false // keep Finder in front
        let log = self.log
        NSWorkspace.shared.open(url, configuration: configuration) { _, error in
            if let error {
                log.error("could not open host app: \(error.localizedDescription, privacy: .public)")
            } else {
                log.info("handed off \(paths.count) item(s), ttl=\(lifetime.ttl, privacy: .public)")
            }
        }
    }
}
