import ActivityKit
import SwiftUI
import WidgetKit

@main
struct LumiverseActivities: WidgetBundle {
    var body: some Widget { GenerationLiveActivity() }
}

private let activityAccent = Color(red: 0.72, green: 0.62, blue: 1)

private struct CharacterAvatar: View {
    let attributes: GenerationActivityAttributes
    let size: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(activityAccent.opacity(0.18))
            if let image = GenerationActivityAvatar.image(attributes.avatarKey, size: size) {
                Image(uiImage: image).renderingMode(.original).resizable().scaledToFill()
            } else {
                Text(attributes.characterName.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased())
                    .font(.system(size: size * 0.33, weight: .semibold, design: .rounded))
                    .foregroundColor(activityAccent)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(.white.opacity(0.14), lineWidth: 0.75))
        .accessibilityLabel(attributes.characterName)
    }
}

struct GenerationLiveActivity: Widget {
    private func isStale(_ context: ActivityViewContext<GenerationActivityAttributes>) -> Bool {
        if #available(iOS 16.2, *) { return context.isStale }
        return false
    }
    private func color(_ context: ActivityViewContext<GenerationActivityAttributes>) -> Color {
        switch context.state.phase {
        case "completed": return Color(red: 0.48, green: 0.86, blue: 0.72)
        case "error", "interrupted", "inputNeeded": return Color(red: 1, green: 0.74, blue: 0.48)
        default: return activityAccent
        }
    }
    private func symbol(_ context: ActivityViewContext<GenerationActivityAttributes>) -> String {
        isStale(context) && !context.state.terminal ? "clock" : context.state.symbol
    }
    private func status(_ context: ActivityViewContext<GenerationActivityAttributes>) -> some View {
        Label(isStale(context) && !context.state.terminal ? "Waiting for update" : context.state.label,
              systemImage: symbol(context))
            .font(.system(size: 13, weight: .medium))
            .foregroundColor(color(context))
            .lineLimit(1)
    }
    @ViewBuilder
    private func elapsed(_ context: ActivityViewContext<GenerationActivityAttributes>) -> some View {
        if !context.state.terminal && !isStale(context) {
            Text(Date(timeIntervalSince1970: context.attributes.startedAt), style: .timer)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.white.opacity(0.5))
                .multilineTextAlignment(.trailing)
                .frame(width: 60, alignment: .trailing)
                .accessibilityLabel("Elapsed time")
        }
    }
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GenerationActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("LUMIVERSE").font(.system(size: 10, weight: .semibold)).tracking(1.4)
                        .foregroundColor(.white.opacity(0.5))
                    Spacer(minLength: 8)
                    elapsed(context)
                }
                HStack(alignment: .center, spacing: 12) {
                    CharacterAvatar(attributes: context.attributes, size: 48)
                    VStack(alignment: .leading, spacing: 7) {
                        Text(context.attributes.characterName)
                            .font(.system(size: 16, weight: .semibold))
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        status(context)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            .foregroundColor(.white)
            .activityBackgroundTint(Color(red: 0.065, green: 0.055, blue: 0.10))
            .activitySystemActionForegroundColor(activityAccent)
            .widgetURL(context.attributes.tapURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        CharacterAvatar(attributes: context.attributes, size: 28)
                        Text("Lumiverse").font(.system(size: 12, weight: .medium)).foregroundColor(.white.opacity(0.55))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) { elapsed(context).padding(.top, 7) }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text(context.attributes.characterName)
                            .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        status(context)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4).padding(.bottom, 3)
                }
            } compactLeading: {
                CharacterAvatar(attributes: context.attributes, size: 22)
            } compactTrailing: {
                Image(systemName: symbol(context)).font(.system(size: 13, weight: .semibold))
                    .foregroundColor(color(context)).frame(width: 22, height: 22)
            } minimal: {
                CharacterAvatar(attributes: context.attributes, size: 22)
                    .overlay(alignment: .bottomTrailing) {
                        Circle().fill(color(context)).frame(width: 6, height: 6)
                            .overlay(Circle().stroke(.black, lineWidth: 1))
                    }
            }
            .widgetURL(context.attributes.tapURL)
            .keylineTint(color(context))
        }
    }
}
