// HoloStage — 3D 模型线框全息查看器（WKWebView + three.js 薄壳）
// macOS 12+ · swiftc 直编 · 单文件

import Cocoa
import WebKit

// MARK: - 自定义 scheme 文件服务（holo://f/<绝对路径>）
// WKWebView 禁止 JS 对 file:// 发 XHR/fetch，用 scheme handler 给 three.js 供字节

final class HoloSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let url = urlSchemeTask.request.url!
        // holo://f/<percent-encoded 绝对路径>
        guard url.absoluteString.hasPrefix("holo://f/") else {
            finishTask(urlSchemeTask, data: Data(), status: 404)
            return
        }
        var p = String(url.absoluteString.dropFirst("holo://f/".count))
        // 去掉可能的 ?query
        if let q = p.firstIndex(of: "?") { p = String(p[..<q]) }
        let path = p.removingPercentEncoding ?? p
        guard FileManager.default.fileExists(atPath: path),
              let data = FileManager.default.contents(atPath: path) else {
            finishTask(urlSchemeTask, data: Data(), status: 404)
            return
        }
        finishTask(urlSchemeTask, data: data, status: 200, path: path)
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func finishTask(_ task: WKURLSchemeTask, data: Data, status: Int, path: String? = nil) {
        let mime: String
        switch (path.map { URL(fileURLWithPath: $0 ).pathExtension.lowercased() } ?? "") {
        case "obj", "gltf", "json", "js": mime = "text/plain"
        case "png": mime = "image/png"      // 1.3.3: 整窗快照 + 自定义背景图
        case "jpg", "jpeg": mime = "image/jpeg"
        case "webp": mime = "image/webp"
        case "gif": mime = "image/gif"
        default: mime = "application/octet-stream"
        }
        let rsp = HTTPURLResponse(url: task.request.url!, statusCode: status,
                                  httpVersion: "HTTP/1.1",
                                  headerFields: ["Content-Type": mime,
                                                 "Content-Length": String(data.count),
                                                 "Access-Control-Allow-Origin": "*"])!
        task.didReceive(rsp)
        task.didReceive(data)
        task.didFinish()
    }
}

// MARK: - 支持文件拖放的 WKWebView

final class DropWebView: WKWebView {
    var onFileDropped: ((URL) -> Void)?

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        registerForDraggedTypes([.fileURL])
    }
    required init?(coder: NSCoder) { fatalError() }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        return draggedFileURL(sender) != nil ? .copy : []
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if let url = draggedFileURL(sender) {
            onFileDropped?(url)
            return true
        }
        return false
    }
    private func draggedFileURL(_ sender: NSDraggingInfo) -> URL? {
        guard let items = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self],
                options: [.urlReadingFileURLsOnly: true]) as? [URL],
              let url = items.first else { return nil }
        return url
    }
}

// MARK: - 品牌头

final class BrandHeader: NSView {
    private let version: String
    init(version: String) {
        self.version = version
        super.init(frame: NSRect(x: 0, y: 0, width: 1060, height: 44))
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let wnd = window, subviews.isEmpty else { return }
        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.frame = NSRect(x: 14, y: 5, width: 34, height: 34)
        icon.wantsLayer = true
        icon.layer?.cornerRadius = 8
        icon.layer?.masksToBounds = true

        let name = NSTextField(labelWithString: "HoloStage")
        name.font = .systemFont(ofSize: 15, weight: .bold)
        name.textColor = .labelColor
        name.frame = NSRect(x: 56, y: 13, width: 120, height: 20)

        let ver = NSTextField(labelWithString: "v" + version + " · 3D 全息线框加载台")
        ver.font = .systemFont(ofSize: 11)
        ver.textColor = .secondaryLabelColor
        ver.frame = NSRect(x: 172, y: 15, width: 260, height: 16)

        let about = NSButton(title: "关于", target: self, action: #selector(showAbout))
        about.bezelStyle = .recessed
        about.frame = NSRect(x: frame.width - 66, y: 10, width: 52, height: 24)
        about.autoresizingMask = .minXMargin

        addSubview(icon); addSubview(name); addSubview(ver); addSubview(about)
    }

    @objc private func showAbout() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "HoloStage",
            .applicationVersion: version,
            .version: version,
            .credits: NSAttributedString(string: "把 STL / OBJ / glTF / GLB / PLY / FBX / PMX / USDZ / ZIP\n变成复古未来风线框全息加载动画。\nPMX/PMD 可拖入 .vmd 动作，并由 ammo.js 驱动头发/裙摆物理。\n镜头：WASD 平移 · Q/E 推拉 · ⌘ / ⌥ + 拖拽 = 360° 自由视角。\n背景为可自定义的程序化科技底图；导出支持「整个窗口（含界面）」与 GIF 体积上限。\n渲染引擎 three.js r170 + tinyusdz + ammo.js（本地内置，离线可用）")
        ])
    }
}

// MARK: - AppDelegate

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: DropWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1060, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "HoloStage"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(calibratedRed: 0, green: 0, blue: 0, alpha: 1)
        window.minSize = NSSize(width: 720, height: 500)
        window.center()

        // 品牌头 + WebView 垂直布局
        let header = BrandHeader(version: version)
        header.translatesAutoresizingMaskIntoConstraints = false

        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "holo")
        cfg.setURLSchemeHandler(HoloSchemeHandler(), forURLScheme: "holo")
        webView = DropWebView(frame: .zero, configuration: cfg)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.setValue(false, forKey: "drawsBackground")
        webView.onFileDropped = { [weak self] url in
            self?.loadModel(at: url)
        }
        webView.navigationDelegate = self

        let content = NSView(frame: NSRect(x: 0, y: 0, width: 1060, height: 720))
        content.addSubview(header)
        content.addSubview(webView)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: content.topAnchor),
            header.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 44),
            webView.topAnchor.constraint(equalTo: header.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])
        window.contentView = content

        // 加载内置页面（读访问授权整个磁盘，让 JS 能 fetch 用户选择的模型文件）
        if let resURL = Bundle.main.resourceURL {
            let page = resURL.appendingPathComponent("web/index.html")
            webView.loadFileURL(page, allowingReadAccessTo: URL(fileURLWithPath: "/"))
        }

        buildMainMenu() // 1.3.2: 必须先建菜单栏，否则 ⌘Q / ⌘W / ⌘C 等标准快捷键没有绑定目标
        // 1.3.2: MENU_SELFTEST=1 打印菜单栏结构后退出（交付验证能力，与 OPEN_ABOUT 同性质、零副作用）
        if ProcessInfo.processInfo.environment["MENU_SELFTEST"] == "1" {
            print("[MENU-SELFTEST]\n" + menuDescription())
            // 1.3.2: MENU_SEND_CMD_Q=1 时合成一次 ⌘Q 键事件交给菜单系统路由 ——
            // 这与 AppKit 自身的按键分发路径完全一致（NSApplication.sendEvent 先问 mainMenu）。
            // 若绑定真的生效，NSApp 会立刻 terminate，下面那行标记就不会出现；
            // 因此用「标记是否打印」判定 ⌘Q 是否活绑，无需辅助功能授权。
            if ProcessInfo.processInfo.environment["MENU_SEND_CMD_Q"] == "1" {
                print("[CMD-Q] 即将派发合成 ⌘Q —— 若绑定生效，本进程应立即退出、下面这行不会出现")
                fflush(stdout)
                if let ev = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command,
                                             timestamp: ProcessInfo.processInfo.systemUptime,
                                             windowNumber: 0, context: nil,
                                             characters: "q", charactersIgnoringModifiers: "q",
                                             isARepeat: false, keyCode: 12) {
                    let handled = NSApp.mainMenu?.performKeyEquivalent(with: ev) ?? false
                    print("[CMD-Q] 存活未退出，handled=\(handled) —— ⌘Q 绑定未生效")
                } else {
                    print("[CMD-Q] 合成键事件失败")
                }
            }
            exit(0)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // 1.2.4(b8): OPEN_ABOUT=1 直启弹「关于」（安装/交付验证标准能力，存量补齐）
        if ProcessInfo.processInfo.environment["OPEN_ABOUT"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                self?.showAboutPanel()
            }
        }
    }

    /* 1.3.2: 标准菜单栏。
     * 此前从未构建 mainMenu，AppKit 就找不到 ⌘Q 的绑定目标 —— 按键被静默丢弃，
     * 于是应用无法用 ⌘Q 退出（不是按键被拦截，而是压根没有这条绑定）。
     * 菜单项 target 一律留 nil，沿响应链交给 NSApp / 当前窗口处理。 */
    private func buildMainMenu() {
        let name = "HoloStage"
        let mainMenu = NSMenu()

        // 应用菜单
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 \(name)",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
                        keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 \(name)",
                        action: #selector(NSApplication.hide(_:)),
                        keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "隐藏其他",
                                         action: #selector(NSApplication.hideOtherApplications(_:)),
                                         keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "显示全部",
                        action: #selector(NSApplication.unhideAllApplications(_:)),
                        keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 \(name)",
                        action: #selector(NSApplication.terminate(_:)),
                        keyEquivalent: "q")
        appItem.submenu = appMenu

        // 编辑菜单（网页内的文本输入、导出文件名输入框都依赖它）
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: Selector(("cut:")), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: Selector(("copy:")), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: Selector(("paste:")), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: Selector(("selectAll:")), keyEquivalent: "a")
        editItem.submenu = editMenu

        // 窗口菜单
        let winItem = NSMenuItem()
        mainMenu.addItem(winItem)
        let winMenu = NSMenu(title: "窗口")
        winMenu.addItem(withTitle: "最小化",
                        action: #selector(NSWindow.performMiniaturize(_:)),
                        keyEquivalent: "m")
        winMenu.addItem(withTitle: "缩放",
                        action: #selector(NSWindow.performZoom(_:)),
                        keyEquivalent: "")
        winMenu.addItem(.separator())
        winMenu.addItem(withTitle: "关闭窗口",
                        action: #selector(NSWindow.performClose(_:)),
                        keyEquivalent: "w")
        winItem.submenu = winMenu
        NSApp.windowsMenu = winMenu

        NSApp.mainMenu = mainMenu
    }

    /* 1.3.2: 把 mainMenu 结构落成可读文本，供 MENU_SELFTEST 自检（命令行可验证 ⌘Q 是否已绑定） */
    private func menuDescription() -> String {
        guard let main = NSApp.mainMenu else { return "(no mainMenu)" }
        return main.items.map { item -> String in
            let title = item.submenu?.title ?? "(item)"
            let subs = (item.submenu?.items ?? []).map { sub -> String in
                let ke = sub.keyEquivalent
                if ke.isEmpty { return sub.title }
                let m = sub.keyEquivalentModifierMask
                var mods = ""
                if m.contains(.control) { mods += "^" }
                if m.contains(.option) { mods += "⌥" }
                if m.contains(.shift) { mods += "⇧" }
                if m.contains(.command) { mods += "⌘" }
                return sub.title + "[" + mods + ke.uppercased() + "]"
            }.joined(separator: ", ")
            return title + " => " + subs
        }.joined(separator: "\n")
    }

    private func showAboutPanel() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "HoloStage",
            .applicationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0",
            .version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0",
            .credits: NSAttributedString(string: "把 STL / OBJ / glTF / GLB / PLY / FBX / PMX / USDZ / ZIP\n变成复古未来风线框全息加载动画。\nPMX/PMD 可拖入 .vmd 动作，并由 ammo.js 驱动头发/裙摆物理。\n镜头：WASD 平移 · Q/E 推拉 · ⌘ / ⌥ + 拖拽 = 360° 自由视角。\n背景为可自定义的程序化科技底图；导出支持「整个窗口（含界面）」与 GIF 体积上限。\n渲染引擎 three.js r170 + tinyusdz + ammo.js（本地内置，离线可用）")
        ])
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: JS ↔ Swift

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "holo",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "openFile":
            pickAndLoad()
        case "droppedFile":
            pickAndLoad()
        case "saveGif":
            if let data = base64Data(body["data"]), let name = body["name"] as? String {
                saveData(data, name: name, ext: "gif")
            }
        case "savePng":
            if let data = base64Data(body["data"]), let name = body["name"] as? String {
                saveData(data, name: name, ext: "png")
            }
        case "savePngSeq":
            if let frames = body["frames"] as? [String], let name = body["name"] as? String {
                saveSequence(frames: frames, baseName: name)
            }
        case "saveHtml":
            if let data = base64Data(body["data"]), let name = body["name"] as? String {
                saveData(data, name: name, ext: "html")
            }
        // 1.3.3「整个窗口（含界面）」导出：JS 侧无法栅格化 DOM，只能由原生拍照
        case "saveSnapshot":
            let scale = (body["scale"] as? NSNumber)?.doubleValue ?? 2.0
            let nm = (body["name"] as? String) ?? "holo_ui.png"
            makeSnapshot(scale: scale) { [weak self] url in
                guard let self, let url, let data = FileManager.default.contents(atPath: url.path) else {
                    self?.notifyJS("整窗快照失败", isError: true); return
                }
                self.saveData(data, name: nm, ext: "png")
            }
        case "snapshotToTemp":
            let scale = (body["scale"] as? NSNumber)?.doubleValue ?? 2.0
            let seq = (body["seq"] as? NSNumber)?.intValue ?? -1
            makeSnapshot(scale: scale) { [weak self] url in
                guard let self else { return }
                guard let url else { self.evalJS("window.holoSnapReady && window.holoSnapReady(\(seq), \"\");"); return }
                let enc = url.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? url.path
                self.evalJS("window.holoSnapReady && window.holoSnapReady(\(seq), \"holo://f/\(enc)\");")
            }
        case "cleanupSnaps":
            cleanupSnaps()
        case "pickBackground":
            pickBackgroundImage()
        default: break
        }
    }

    /// 1.3.3: 选自定义背景图。走 NSOpenPanel 而不是页面里的 <input type=file> ——
    /// macOS 的 WKWebView 需要实现 WKUIDelegate.runOpenPanel 才会响应文件输入框，
    /// 这里直接复用已有的 holo:// 通道把字节交给 JS。
    private func pickBackgroundImage() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.allowedFileTypes = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic"]
        panel.message = "选择背景图片（App 内缩放后用作 3D 背景；导出网页会内嵌该副本）"
        panel.begin { [weak self] resp in
            guard resp == .OK, let url = panel.url else { return }
            let enc = url.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? url.path
            self?.evalJS("window.holoBgImage && window.holoBgImage(\"holo://f/\(enc)\");")
        }
    }

    // MARK: 整窗快照（1.3.3）

    private func evalJS(_ js: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private var snapCounter = 0
    private var snapFiles: [URL] = []

    /// 拍一张「屏幕上看到的样子」（DOM 叠加层 + WebGL 画面一起），PNG 落临时目录。
    /// 不把字节塞进 evaluateJavaScript —— 2× 倍率下一张可能好几 MB，
    /// 交给 JS 用 holo://f/ 取更稳。
    private func makeSnapshot(scale: Double, completion: @escaping (URL?) -> Void) {
        let b = webView.bounds
        guard b.width > 1, b.height > 1 else { completion(nil); return }
        let back = Double(webView.window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 1)
        // 目标像素严格 = 窗口点数 × 请求倍率。
        // 1.3.3 修复：WKSnapshotConfiguration.snapshotWidth 的单位是「点」，Retina 屏上
        // 返回图还会再乘一次设备倍率 → 界面选 2× 实际出 4×，与「导出像素 = 窗口尺寸 ×N」
        // 的提示差一倍（整窗 GIF 会因此重 4 倍）。这里先按设备倍率折回，再显式光栅化锁死尺寸。
        let pxW = max(64, Int(round(b.width * scale)))
        let pxH = max(64, Int(round(b.height * scale)))
        let cfg = WKSnapshotConfiguration()
        cfg.rect = b
        cfg.snapshotWidth = NSNumber(value: Double(pxW) / back)
        cfg.afterScreenUpdates = true
        webView.takeSnapshot(with: cfg) { [weak self] image, error in
            guard let self else { completion(nil); return }
            guard error == nil, let image else { completion(nil); return }
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pxW, pixelsHigh: pxH,
                                             bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
                completion(nil); return
            }
            NSGraphicsContext.saveGraphicsState()
            if let gc = NSGraphicsContext(bitmapImageRep: rep) {
                NSGraphicsContext.current = gc
                image.draw(in: NSRect(x: 0, y: 0, width: CGFloat(pxW), height: CGFloat(pxH)),
                           from: .zero, operation: .copy, fraction: 1.0)
                gc.flushGraphics()
            }
            NSGraphicsContext.restoreGraphicsState()
            guard let png = rep.representation(using: .png, properties: [:]) else { completion(nil); return }
            self.snapCounter += 1
            let out = FileManager.default.temporaryDirectory
                .appendingPathComponent("HoloSnap-\(self.snapCounter).png")
            do {
                try png.write(to: out)
                self.snapFiles.append(out)
                completion(out)
            } catch { completion(nil) }
        }
    }

    private func cleanupSnaps() {
        for u in snapFiles { try? FileManager.default.removeItem(at: u) }
        snapFiles.removeAll()
    }

    private func base64Data(_ any: Any?) -> Data? {
        guard let s = any as? String else { return nil }
        return Data(base64Encoded: s)
    }

    private func pickAndLoad() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.allowedFileTypes = ["stl", "obj", "gltf", "glb", "ply", "fbx", "pmx", "pmd", "usdz", "usd", "vmd", "zip"]
        panel.message = "选择 3D 模型文件（STL / OBJ / glTF / GLB / PLY / FBX / PMX / USDZ / ZIP 包；PMX 可搭配 .vmd 动作）"
        panel.begin { [weak self] resp in
            guard resp == .OK, let url = panel.url else { return }
            self?.loadModel(at: url)
        }
    }

    // MARK: ZIP 包支持（含嵌套 ZIP，如「外层 zip 套内层 zip 套 OBJ+MTL+贴图」）

    /// 支持的模型扩展名（用于在解压目录中挑主模型）
    private static let modelExts: [String: Int] = [
        "glb": 0, "gltf": 1, "fbx": 2, "obj": 3, "pmx": 4, "pmd": 5, "usdz": 6, "usd": 6, "ply": 7, "stl": 8
    ]

    /// 上一次解压的临时目录（新解压前清理）
    private var zipWorkDir: URL?

    private func jsString(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
         .replacingOccurrences(of: "\n", with: "\\n")
    }

    private func notifyJS(_ msg: String, isError: Bool = false) {
        let js = "window.holoNativeStatus && window.holoNativeStatus(\"\(jsString(msg))\", \(isError ? "true" : "false"));"
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func loadModel(at url: URL) {
        let ext = url.pathExtension.lowercased()
        if ext == "zip" {
            loadFromZip(at: url)
            return
        }
        // 转成 holo:// scheme URL，让 JS 侧 three.js loader 能 fetch 到字节
        let enc = url.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? url.path
        let safeName = url.lastPathComponent.replacingOccurrences(of: "\"", with: "")
        // 1.3.0: VMD 动作文件 —— 挂到当前 PMX/PMD 模型上（尚无模型时由 JS 侧排队）
        if ext == "vmd" {
            webView.evaluateJavaScript(
                "window.holoLoadVMD && window.holoLoadVMD(\"holo://f/\(enc)\", \"\(safeName)\");",
                completionHandler: nil)
            return
        }
        let js = "window.holoLoadFile && window.holoLoadFile(\"holo://f/\(enc)\", \"\(safeName)\");"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func loadFromZip(at url: URL) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            self.notifyJS("EXTRACTING \(url.lastPathComponent.uppercased()) ...")
            do {
                let dir = try self.extractZipTree(at: url)
                guard let model = self.pickMainModel(in: dir) else {
                    self.notifyJS("ZIP 内未找到模型文件（支持 OBJ / FBX / glTF / GLB / PLY / STL / PMX / USDZ）", isError: true)
                    return
                }
                self.notifyJS("LOADED FROM ZIP: \(model.lastPathComponent)")
                DispatchQueue.main.async { self.loadModel(at: model) }
            } catch {
                self.notifyJS("ZIP 解压失败: \(error.localizedDescription)", isError: true)
            }
        }
    }

    /// 解压 ZIP；若解压结果中没有模型文件，继续解压里面嵌套的 ZIP（最多 3 层）
    private func extractZipTree(at url: URL) throws -> URL {
        let fm = FileManager.default
        if let prev = zipWorkDir { try? fm.removeItem(at: prev) }
        let root = fm.temporaryDirectory.appendingPathComponent("HoloStageZip-\(UUID().uuidString)")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        zipWorkDir = root

        var extracted = Set<String>()
        var queue: [URL] = [url]
        var depth = 0
        while !queue.isEmpty && depth < 3 {
            var nextQueue: [URL] = []
            for z in queue {
                guard extracted.insert(z.path).inserted else { continue }
                let dest = root.appendingPathComponent("L\(depth)_\(z.deletingPathExtension().lastPathComponent)")
                try fm.createDirectory(at: dest, withIntermediateDirectories: true)
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                p.arguments = ["-x", "-k", z.path, dest.path]
                p.standardError = FileHandle.nullDevice
                try p.run()
                p.waitUntilExit()
                if p.terminationStatus != 0 { continue }
                // 本层解出的嵌套 ZIP
                if depth + 1 < 3 {
                    nextQueue.append(contentsOf: findFiles(in: dest, exts: ["zip"], skipDirs: true))
                }
            }
            queue = nextQueue
            depth += 1
        }
        return root
    }

    private func findFiles(in dir: URL, exts: [String], skipDirs: Bool) -> [URL] {
        let fm = FileManager.default
        guard let en = fm.enumerator(at: dir, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]) else { return [] }
        var out: [URL] = []
        for case let f as URL in en {
            let name = f.lastPathComponent
            if name.hasPrefix(".") || name == "__MACOSX" { en.skipDescendants(); continue }
            if exts.contains(f.pathExtension.lowercased()) {
                if let vals = try? f.resourceValues(forKeys: [.isRegularFileKey]), vals.isRegularFile == true {
                    out.append(f)
                }
            } else if skipDirs && exts != ["zip"] { /* noop */ }
        }
        return out
    }

    /// 在解压目录中挑主模型：扩展名优先级 → 文件体积大者优先
    private func pickMainModel(in root: URL) -> URL? {
        let candidates = findFiles(in: root, exts: Array(Self.modelExts.keys), skipDirs: true)
        guard !candidates.isEmpty else { return nil }
        let fm = FileManager.default
        let ranked = candidates.map { url -> (URL, Int, Int) in
            let pri = Self.modelExts[url.pathExtension.lowercased()] ?? 99
            let size = (try? fm.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
            return (url, pri, size)
        }.sorted { a, b in
            if a.1 != b.1 { return a.1 < b.1 }
            if a.2 != b.2 { return a.2 > b.2 }
            return a.0.path < b.0.path
        }
        return ranked.first?.0
    }

    private func saveData(_ data: Data, name: String, ext: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.allowedFileTypes = [ext]
        panel.begin { resp in
            guard resp == .OK, let url = panel.url else { return }
            try? data.write(to: url)
        }
    }

    private func saveSequence(frames: [String], baseName: String) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.message = "选择 PNG 帧序列的保存文件夹"
        panel.begin { [weak self] resp in
            guard resp == .OK, let dir = panel.url else { return }
            DispatchQueue.global().async {
                for (i, b64) in frames.enumerated() {
                    guard let data = Data(base64Encoded: b64) else { continue }
                    let file = dir.appendingPathComponent(String(format: "%@_f%02d.png", baseName, i))
                    try? data.write(to: file)
                }
                DispatchQueue.main.async {
                    self?.webView.evaluateJavaScript(
                        "document.getElementById('status').textContent = 'PNG 序列已保存: \(dir.path.replacingOccurrences(of: "\\", with: "/"))';",
                        completionHandler: nil)
                }
            }
        }
    }
}

// 页面加载完成钩子（冒烟测试：HOLO_MODEL=/path/to/model 自动载入）
extension AppDelegate: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let p = ProcessInfo.processInfo.environment["HOLO_MODEL"] {
            loadModel(at: URL(fileURLWithPath: p))
        }
        // 1.3.3 整窗快照自检：拍一张落到 /tmp/holo_snap_selftest.png，打印尺寸后退出。
        // 用「非黑像素分区占比」判定 DOM 面板与 WebGL 画面是否真的被拍进去。
        if let sc = ProcessInfo.processInfo.environment["SNAP_SELFTEST"] {
            let scale = Double(sc) ?? 2.0
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                guard let self else { return }
                self.makeSnapshot(scale: scale) { url in
                    guard let url, let data = FileManager.default.contents(atPath: url.path) else {
                        print("[SNAP-SELFTEST] FAIL 无输出"); exit(2)
                    }
                    let out = URL(fileURLWithPath: "/tmp/holo_snap_selftest.png")
                    try? FileManager.default.removeItem(at: out)
                    do { try data.write(to: out) } catch { print("[SNAP-SELFTEST] FAIL 写入失败"); exit(3) }
                    if let rep = NSBitmapImageRep(data: data) {
                        print("[SNAP-SELFTEST] OK \(rep.pixelsWide)x\(rep.pixelsHigh) bytes=\(data.count) -> \(out.path)")
                    } else {
                        print("[SNAP-SELFTEST] OK bytes=\(data.count) -> \(out.path)（解码失败）")
                    }
                    exit(0)
                }
            }
        }
        // 1.3.5 骨骼自检：HOLO_SKEL_SELFTEST=1 → 载入模型后读页面侧诊断并打印，随后退出。
        // 判定「骨骼能力在真实 WKWebView 里是否真的活了」：骨骼数/蒙皮数/骨骼树条目 +
        // 面板文案（有无骨骼）+ 骨架可见性。纯只读，不参与业务逻辑。
        if ProcessInfo.processInfo.environment["HOLO_SKEL_SELFTEST"] != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { [weak self] in
                guard let self else { return }
                let js = """
                JSON.stringify({
                  diag: window.holoSkelDiag ? window.holoSkelDiag() : null,
                  skelInfo: (document.getElementById('skelInfo') || {}).textContent || '',
                  skelTree: document.querySelectorAll('#boneList .boneItem').length,
                  skelNoneShown: (function(){var e=document.getElementById('skelNone');
                    return !!(e && e.offsetParent !== null && getComputedStyle(e).display !== 'none');})(),
                  rowCount: document.querySelectorAll('#boneList > *').length,
                  checked: (function(){var e=document.getElementById('inpSkel');return !!(e && e.checked);})()
                })
                """
                self.webView.evaluateJavaScript(js) { res, err in
                    if let err {
                        print("[SKEL-SELFTEST] FAIL JS 错误: \(err)")
                        exit(4)
                    }
                    print("[SKEL-SELFTEST] \(res as? String ?? "nil")")
                    exit(0)
                }
            }
        }
        if ProcessInfo.processInfo.environment["HOLO_DEBUG"] != nil {
            let dbg = """
            (function(){
              var s = document.getElementById('status');
              fetch('file:///tmp/holo_test_torus.obj').then(function(r){
                s.textContent = 'FETCH status=' + r.status + ' type=' + r.type;
              }).catch(function(e){ s.textContent = 'FETCH ERR ' + e; });
            })();
            """
            webView.evaluateJavaScript(dbg, completionHandler: nil)
        }
    }
}

// MARK: - main

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
