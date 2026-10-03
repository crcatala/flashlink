import AppKit
import UserNotifications
import os

/// Receives the extension's hand-off and proves it: logs every path it got (exactly as received)
/// to ~/Library/Logs/r2fl-spike.log and posts a notification "would share N file(s) for 1h: ...".
/// It uploads nothing.
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private let log = Logger(subsystem: "dev.r2fastlink.spike", category: "app")
    private let logFile = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/r2fl-spike.log")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let log = self.log
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            log.info("notification authorization granted=\(granted) error=\(String(describing: error))")
        }
        log.info("launched")
    }

    // Called for every r2fl-spike:// URL, also when the app was started by the URL.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            guard let request = HandOff.parse(url) else {
                log.error("ignored URL: \(url.absoluteString, privacy: .public)")
                continue
            }
            log.info("hand-off ttl=\(request.ttl, privacy: .public) count=\(request.paths.count)")
            append(request.logBlock(at: Date()))
            notify(request.summary)
        }
    }

    private func append(_ text: String) {
        do {
            try FileManager.default.createDirectory(
                at: logFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: logFile.path) {
                FileManager.default.createFile(atPath: logFile.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: logFile)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: Data(text.utf8))
        } catch {
            log.error("could not write \(self.logFile.path, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    private func notify(_ body: String) {
        let content = UNMutableNotificationContent()
        content.title = "r2-fastlink"
        content.body = body
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        let log = self.log
        UNUserNotificationCenter.current().add(request) { error in
            if let error { log.error("notification failed: \(error.localizedDescription, privacy: .public)") }
        }
    }

    // Show banners even though this app is "frontmost" while handling the URL.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}
