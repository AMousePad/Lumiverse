import SwiftUI
import WidgetKit

struct CharacterWidgetEntry: TimelineEntry {
    let date: Date
    let enrollment: CharacterWidgetEnrollment?
    let snapshot: CharacterWidgetSnapshot?
    var preview = false
}
struct CharacterWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> CharacterWidgetEntry { CharacterWidgetEntry(date: .now, enrollment: nil, snapshot: nil, preview: true) }
    func getSnapshot(in context: Context, completion: @escaping (CharacterWidgetEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        completion(entry())
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<CharacterWidgetEntry>) -> Void) {
        Task {
            if let active = CharacterWidgetStore.current() { await CharacterWidgetRefresh().refresh(active) }
            completion(Timeline(entries: [entry()], policy: .after(Date().addingTimeInterval(30 * 60))))
        }
    }
    private func entry() -> CharacterWidgetEntry {
        let active = CharacterWidgetStore.current()
        return CharacterWidgetEntry(date: .now, enrollment: active, snapshot: active.flatMap { CharacterWidgetStore.snapshot(for: $0) })
    }
}

private struct CharacterWidgetView: View {
    let entry: CharacterWidgetEntry
    let favorites: Bool
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.redactionReasons) private var redaction
    private var title: String { favorites ? "Favorites" : "Recent" }
    private var palette: CharacterWidgetPalette { entry.enrollment?.palette ?? CharacterWidgetPalette() }
    private var items: [CharacterWidgetItem] {
        guard !redaction.contains(.privacy) else { return [] }
        if entry.preview {
            return (1...16).map { CharacterWidgetItem(characterId: "preview-\($0)", name: ["Lumi", "Nova", "Aria", "Sol"][($0 - 1) % 4], chatId: nil, updatedAt: 0) }
        }
        return (favorites ? entry.snapshot?.favorites : entry.snapshot?.recent) ?? []
    }
    private var accessory: Bool {
        if #available(iOS 16.0, *) { return [.accessoryCircular, .accessoryInline, .accessoryRectangular].contains(family) }
        return false
    }
    private var fallbackURL: URL? {
        guard let active = entry.enrollment, let first = items.first, !entry.preview else { return nil }
        return CharacterWidgetLink.url(enrollment: active, item: first, collection: favorites ? "favorites" : "recent")
    }
    var body: some View {
        content
            .widgetURL(fallbackURL)
            .privacySensitive()
            .widgetSurface(Color(widgetHex: palette.background), accessory: accessory)
    }
    @ViewBuilder private var content: some View {
        if #available(iOS 16.0, *), accessory {
            accessoryContent
        } else {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 5) {
                    Image(systemName: favorites ? "heart.fill" : "bubble.left.and.bubble.right.fill").foregroundColor(Color(widgetHex: palette.accent)).widgetAccentable()
                    Text(title).fontWeight(.semibold)
                    Spacer(minLength: 0)
                }.font(.system(size: 11)).foregroundColor(Color(widgetHex: palette.foreground))
                if items.isEmpty { empty }
                else { grid }
            }
        }
    }
    private var grid: some View {
        let columns = family == .systemSmall ? 2 : 4
        let rows = family == .systemLarge ? 4 : 2
        return GeometryReader { geometry in
            let width = max(1, (geometry.size.width - CGFloat(columns - 1) * 5) / CGFloat(columns))
            let height = max(1, (geometry.size.height - CGFloat(rows - 1) * 5) / CGFloat(rows))
            VStack(spacing: 5) {
                ForEach(0..<rows, id: \.self) { row in
                    HStack(spacing: 5) {
                        ForEach(0..<columns, id: \.self) { column in
                            let index = row * columns + column
                            if index < items.count {
                                linked(items[index]) { card(items[index], width: width, height: height) }
                            } else { Color.clear.frame(width: width, height: height) }
                        }
                    }
                }
            }
        }
    }
    private var empty: some View {
        VStack(spacing: 7) {
            Image(systemName: favorites ? "heart" : "bubble.left").font(.title2)
            Text(redaction.contains(.privacy) ? "Lumiverse" : entry.enrollment == nil ? "Open Lumiverse to sign in" : entry.snapshot == nil ? "Open Lumiverse to refresh" : favorites ? "Save a favorite to see them here" : "Your recent characters appear here")
                .font(.caption).multilineTextAlignment(.center)
        }.foregroundColor(Color(widgetHex: palette.foreground).opacity(0.75)).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    @ViewBuilder private func linked<Content: View>(_ item: CharacterWidgetItem, @ViewBuilder content: () -> Content) -> some View {
        if let active = entry.enrollment, !entry.preview {
            Link(destination: CharacterWidgetLink.url(enrollment: active, item: item, collection: favorites ? "favorites" : "recent"), label: content)
                .accessibilityLabel("Open chat with \(item.name)")
        } else { content() }
    }
    private func card(_ item: CharacterWidgetItem, width: CGFloat, height: CGFloat) -> some View {
        ZStack(alignment: .bottomLeading) {
            portrait(item).frame(width: width, height: height).clipped()
            if renderingMode == .fullColor {
                LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom)
            }
            Text(item.name).font(.system(size: 10, weight: .semibold)).lineLimit(1)
                .foregroundColor(renderingMode == .fullColor ? .white : .primary)
                .padding(.horizontal, 5).padding(.vertical, 4)
        }.frame(width: width, height: height)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color(widgetHex: palette.accent).opacity(0.22), lineWidth: 0.5))
    }
    @ViewBuilder private func portrait(_ item: CharacterWidgetItem) -> some View {
        if let image = CharacterWidgetStore.image(item.imageKey) {
            if #available(iOS 18.0, *) {
                Image(uiImage: image).resizable().widgetAccentedRenderingMode(.desaturated).scaledToFill()
            } else { Image(uiImage: image).resizable().scaledToFill() }
        } else {
            ZStack {
                Color(widgetHex: palette.accent).opacity(0.18)
                Image(systemName: "person.fill").font(.title2).foregroundColor(Color(widgetHex: palette.accent)).widgetAccentable()
            }
        }
    }
    @available(iOS 16.0, *) @ViewBuilder private var accessoryContent: some View {
        switch family {
        case .accessoryInline:
            Label(items.first?.name ?? title, systemImage: favorites ? "heart" : "bubble.left")
        case .accessoryCircular:
            if let first = items.first { portrait(first).clipShape(Circle()).accessibilityLabel(first.name) }
            else { Image(systemName: favorites ? "heart" : "bubble.left").font(.title2) }
        default:
            if items.isEmpty { Label(title, systemImage: favorites ? "heart" : "bubble.left") }
            else {
                HStack(spacing: 6) {
                    ForEach(Array(items.prefix(3))) { item in
                        linked(item) {
                            VStack(spacing: 2) {
                                portrait(item).frame(width: 32, height: 32).clipShape(RoundedRectangle(cornerRadius: 8))
                                Text(item.name).font(.system(size: 9)).lineLimit(1)
                            }.frame(maxWidth: .infinity)
                        }
                    }
                }
            }
        }
    }
}
private extension View {
    @ViewBuilder func widgetSurface(_ color: Color, accessory: Bool) -> some View {
        if #available(iOS 17.0, *) { containerBackground(color, for: .widget) }
        else if accessory { self }
        else { padding(12).background(color) }
    }
}
private extension Color {
    init(widgetHex: String) {
        let value = UInt32(widgetHex.dropFirst(), radix: 16) ?? 0xbca6ff
        self.init(.sRGB, red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255, opacity: 1)
    }
}
private var characterFamilies: [WidgetFamily] {
    if #available(iOS 16.0, *) { return [.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline] }
    return [.systemSmall, .systemMedium, .systemLarge]
}
struct RecentCharactersWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RecentCharactersWidget", provider: CharacterWidgetProvider()) { CharacterWidgetView(entry: $0, favorites: false) }
            .configurationDisplayName("Recent Characters").description("Return to your recently chatted characters.")
            .supportedFamilies(characterFamilies)
    }
}
struct FavoriteCharactersWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FavoriteCharactersWidget", provider: CharacterWidgetProvider()) { CharacterWidgetView(entry: $0, favorites: true) }
            .configurationDisplayName("Favorite Characters").description("Keep your favorite characters close.")
            .supportedFamilies(characterFamilies)
    }
}
@main struct LumiverseCharacterWidgets: WidgetBundle {
    var body: some Widget { RecentCharactersWidget(); FavoriteCharactersWidget() }
}

struct CharacterWidgetPreviews: PreviewProvider {
    static var previews: some View {
        let sample = CharacterWidgetEntry(date: .now, enrollment: nil, snapshot: nil, preview: true)
        Group {
            CharacterWidgetView(entry: sample, favorites: false).previewContext(WidgetPreviewContext(family: .systemSmall)).previewDisplayName("Recent · Small")
            CharacterWidgetView(entry: sample, favorites: true).previewContext(WidgetPreviewContext(family: .systemMedium)).previewDisplayName("Favorites · Medium")
            CharacterWidgetView(entry: sample, favorites: false).previewContext(WidgetPreviewContext(family: .systemLarge)).previewDisplayName("Recent · Large")
            CharacterWidgetView(entry: sample, favorites: true).previewContext(WidgetPreviewContext(family: .accessoryRectangular)).previewDisplayName("Favorites · Lock Screen")
        }
    }
}
