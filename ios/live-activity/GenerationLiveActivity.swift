import ActivityKit
import SwiftUI
import WidgetKit

@main
struct LumiverseActivities: WidgetBundle {
    var body: some Widget { GenerationLiveActivity() }
}

private struct ActivityPresentation {
    let state: GenerationActivityAttributes.ContentState
    let stale: Bool
    let accent: Color
    var waiting: Bool { stale && !state.terminal }
    var tint: Color {
        switch state.phase {
        case "error", "interrupted", "inputNeeded": return Color(red: 1, green: 0.77, blue: 0.53)
        case "stopped": return .white.opacity(0.7)
        default: return accent
        }
    }
    var label: String { waiting ? "Waiting for update" : state.label }
    var symbol: String {
        if waiting { return "clock" }
        switch state.phase {
        case "assembling": return "square.stack.3d.up.fill"
        case "reasoning": return "brain.head.profile"
        case "streaming": return "pencil.and.outline"
        case "completed": return "checkmark.seal.fill"
        default: return state.symbol
        }
    }
    var stage: Int {
        switch state.phase {
        case "reasoning": return 1
        case "streaming": return 2
        case "completed": return 3
        default: return 0
        }
    }
}

private struct CharacterAvatar: View {
    let attributes: GenerationActivityAttributes
    let size: CGFloat
    private var accent: Color { Color(uiColor: GenerationActivityAvatar.accent(attributes.avatarKey)) }
    var body: some View {
        ZStack {
            Circle().fill(accent.opacity(0.18))
            if let image = GenerationActivityAvatar.image(attributes.avatarKey, size: size) {
                Image(uiImage: image).renderingMode(.original).resizable().scaledToFill()
            } else {
                Text(attributes.characterName.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased())
                    .font(.system(size: size * 0.33, weight: .semibold, design: .rounded))
                    .foregroundColor(accent)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(accent.opacity(0.45), lineWidth: 1))
        .accessibilityLabel(attributes.characterName)
    }
}

/// ActivityKit allows brief animations at updates, not a continuously running
/// canvas. Finite symbol effects give each phase a distinct visual gesture.
private struct StageSymbol: View {
    let presentation: ActivityPresentation
    var size: CGFloat = 18
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var dimmed
    private var motion: Bool { !reduceMotion && !dimmed && !presentation.waiting }
    private var image: some View {
        Image(systemName: presentation.symbol)
            .font(.system(size: size, weight: .semibold))
            .symbolRenderingMode(.hierarchical)
    }
    @ViewBuilder private var animated: some View {
        if #available(iOS 18.0, *), motion {
            image
                .symbolEffect(.variableColor.iterative, options: .repeat(2).speed(1.5), isActive: presentation.stage == 0 && !presentation.state.terminal)
                .symbolEffect(.pulse.byLayer, options: .repeat(2).speed(1.5), isActive: presentation.stage == 1)
                .symbolEffect(.wiggle, options: .nonRepeating.speed(1.5), isActive: presentation.stage == 2)
                .symbolEffect(.bounce.byLayer, options: .nonRepeating, value: presentation.state.phase == "completed")
        } else if #available(iOS 17.0, *), motion {
            image
                .symbolEffect(.variableColor.iterative, options: .repeat(2).speed(1.5), isActive: presentation.stage != 1 && !presentation.state.terminal)
                .symbolEffect(.pulse.byLayer, options: .repeat(2).speed(1.5), isActive: presentation.stage == 1)
                .symbolEffect(.bounce.byLayer, options: .nonRepeating, value: presentation.state.phase == "completed")
        } else { image }
    }
    var body: some View {
        Group {
            if #available(iOS 17.0, *), motion {
                animated.contentTransition(.symbolEffect(.replace))
            } else { image }
        }
        .foregroundColor(presentation.tint)
        .frame(width: size + 5, height: size + 5)
        .accessibilityHidden(true)
    }
}

/// Phase markers, not an estimated percentage or completion time.
private struct GenerationStages: View {
    let presentation: ActivityPresentation
    var showLabels = true
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(["Prepare", "Think", "Write"].enumerated()), id: \.offset) { index, name in
                let selected = !presentation.waiting && presentation.stage == index
                VStack(alignment: .leading, spacing: 5) {
                    Capsule().fill(selected || presentation.stage > index ? presentation.tint.opacity(selected ? 1 : 0.4) : .white.opacity(0.13)).frame(height: 3)
                    if showLabels {
                        Text(name).font(.system(size: 10, weight: selected ? .semibold : .medium))
                            .foregroundColor(selected ? presentation.tint : .white.opacity(0.5))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(presentation.label)
    }
}

private struct ElapsedTime: View {
    let attributes: GenerationActivityAttributes
    let presentation: ActivityPresentation
    var showLabel = true
    var body: some View {
        if !presentation.state.terminal {
            VStack(alignment: .trailing, spacing: 3) {
                if showLabel { Text("Elapsed").font(.system(size: 9, weight: .medium)).foregroundColor(.white.opacity(0.4)) }
                Text(Date(timeIntervalSince1970: attributes.startedAt), style: .timer)
                    .font(.system(size: 14, weight: .medium, design: .rounded)).monospacedDigit()
                    .foregroundColor(presentation.tint).multilineTextAlignment(.trailing)
            }
            .frame(width: 52, alignment: .trailing)
            .accessibilityLabel("Time since generation started")
        }
    }
}

private struct ActivityControls: View {
    let attributes: GenerationActivityAttributes
    let presentation: ActivityPresentation
    var body: some View {
        HStack(spacing: 4) {
            if #available(iOS 17.0, *), !presentation.state.terminal {
                Button(intent: StopGenerationIntent(generationId: attributes.generationId)) {
                    Image(systemName: "stop.fill").font(.system(size: 12, weight: .semibold))
                        .frame(width: 36, height: 36).foregroundColor(.white)
                        .background(presentation.tint.opacity(0.18), in: Circle())
                        .frame(width: 44, height: 44).contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stop response")
                .accessibilityHint("Stop generating this response without opening Lumiverse")
                Button(intent: HideGenerationActivityIntent(generationId: attributes.generationId)) {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
                        .frame(width: 44, height: 44).foregroundColor(.white.opacity(0.55))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Hide activity")
                .accessibilityHint("Dismiss this activity. Generation continues.")
            }
        }
    }
}

private struct OpenChat: View {
    let attributes: GenerationActivityAttributes
    let presentation: ActivityPresentation
    var body: some View {
        if let url = attributes.tapURL {
            Link(destination: url) {
                HStack(spacing: 6) {
                    Text(presentation.state.phase == "completed" ? "Read response" : "Open chat")
                    Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold))
                }
                .font(.system(size: 12, weight: .semibold)).foregroundColor(presentation.tint)
                .padding(.horizontal, 13).frame(height: 32)
                .background(presentation.tint.opacity(0.12), in: Capsule())
            }
        }
    }
}

private struct ActivityDetails: View {
    let attributes: GenerationActivityAttributes
    let presentation: ActivityPresentation
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(attributes.characterName)
                .font(.system(size: 12, weight: .medium)).foregroundColor(.white.opacity(0.65))
                .lineLimit(compact ? 1 : 2).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 7) {
                StageSymbol(presentation: presentation)
                Text(presentation.label)
                    .font(.system(size: 21, weight: .semibold, design: .rounded))
                    .foregroundColor(presentation.tint).lineLimit(1).minimumScaleFactor(0.75)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct GenerationActivityCard: View {
    let attributes: GenerationActivityAttributes
    let presentation: ActivityPresentation
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                CharacterAvatar(attributes: attributes, size: 54)
                ActivityDetails(attributes: attributes, presentation: presentation)
                ElapsedTime(attributes: attributes, presentation: presentation)
            }
            HStack(spacing: 16) {
                if presentation.state.terminal || presentation.state.phase == "inputNeeded" || presentation.waiting {
                    OpenChat(attributes: attributes, presentation: presentation)
                    Spacer(minLength: 0)
                } else {
                    GenerationStages(presentation: presentation).frame(maxWidth: 200)
                    Spacer(minLength: 0)
                }
                ActivityControls(attributes: attributes, presentation: presentation)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 16)
        .background {
            LinearGradient(colors: [presentation.accent.opacity(0.18), presentation.accent.opacity(0.025)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .animation(.easeInOut(duration: 0.25), value: presentation.state.phase)
    }
}

private struct CompactPhase: View {
    let presentation: ActivityPresentation
    var body: some View {
        StageSymbol(presentation: presentation, size: 15).frame(width: 23, height: 23)
        .accessibilityHidden(false)
        .accessibilityLabel(presentation.label)
    }
}

struct GenerationLiveActivity: Widget {
    private func presentation(_ context: ActivityViewContext<GenerationActivityAttributes>) -> ActivityPresentation {
        let accent = Color(uiColor: GenerationActivityAvatar.accent(context.attributes.avatarKey))
        if #available(iOS 16.2, *) { return ActivityPresentation(state: context.state, stale: context.isStale, accent: accent) }
        return ActivityPresentation(state: context.state, stale: false, accent: accent)
    }
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GenerationActivityAttributes.self) { context in
            GenerationActivityCard(attributes: context.attributes, presentation: presentation(context))
                .activityBackgroundTint(Color(white: 0.035))
                .activitySystemActionForegroundColor(presentation(context).accent)
                .widgetURL(context.attributes.tapURL)
        } dynamicIsland: { context in
            let model = presentation(context)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 7) {
                        CharacterAvatar(attributes: context.attributes, size: 30)
                        Text("Lumiverse").font(.system(size: 10, weight: .medium)).foregroundColor(.white.opacity(0.45))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ElapsedTime(attributes: context.attributes, presentation: model, showLabel: false)
                        .padding(.top, 7).padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 13) {
                        HStack(alignment: .center, spacing: 12) {
                            ActivityDetails(attributes: context.attributes, presentation: model, compact: true)
                            ActivityControls(attributes: context.attributes, presentation: model)
                        }
                        if model.state.terminal || model.state.phase == "inputNeeded" || model.waiting {
                            OpenChat(attributes: context.attributes, presentation: model)
                        } else {
                            GenerationStages(presentation: model, showLabels: false)
                        }
                    }
                    .padding(.top, 4).padding(.bottom, 12).padding(.horizontal, 6)
                }
            } compactLeading: {
                CharacterAvatar(attributes: context.attributes, size: 23)
            } compactTrailing: {
                CompactPhase(presentation: model)
            } minimal: {
                CharacterAvatar(attributes: context.attributes, size: 23)
                    .overlay(alignment: .bottomTrailing) {
                        Circle().fill(model.tint).frame(width: 7, height: 7)
                            .overlay(Circle().stroke(.black, lineWidth: 1.5))
                    }
            }
            .widgetURL(context.attributes.tapURL).keylineTint(model.tint)
        }
    }
}
