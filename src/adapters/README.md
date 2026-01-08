# Platform Adapters

Claudine uses an adapter pattern to support multiple messaging platforms. Currently Telegram is implemented, with Slack planned for the future.

## Architecture

```
src/adapters/
├── types.ts              # Abstract interfaces
├── README.md             # This file
└── telegram/
    ├── index.ts          # TelegramAdapter class
    ├── formatter.ts      # HTML text formatting
    └── keyboards.ts      # Inline keyboard builders
```

## Core Interfaces

### `PlatformAdapter`
Main interface combining messaging, UI, and formatting:
- `send()`, `edit()`, `delete()` - Message operations
- `onMessage()`, `onCallback()` - Event handlers
- `ui: UIBuilder` - Button/keyboard factory
- `formatter: TextFormatter` - Text formatting

### `UIBuilder`
Creates platform-specific interactive elements:
- `buildStopButton()` - Cancel operation button
- `buildApprovalButtons()` - Yes/No/Always for tool approval
- `buildQuestionButtons()` - Multiple choice answers
- `buildSessionList()` - Session selection buttons

### `TextFormatter`
Handles text formatting for each platform:
- `bold()`, `italic()`, `code()`, `codeBlock()`, `quote()`
- `escape()` - Escape special characters
- `formatResponse()` - Convert Claude's markdown to platform format

## Adding a New Platform

1. Create `src/adapters/<platform>/` directory
2. Implement `PlatformAdapter` interface
3. Create platform-specific `UIBuilder` and `TextFormatter`
4. Update `src/index.ts` to instantiate the new adapter

### Example: Slack Adapter

```typescript
// src/adapters/slack/index.ts
export class SlackAdapter implements PlatformAdapter {
  public ui = new SlackUIBuilder();
  public formatter = new SlackFormatter();
  public platformName = "slack";

  // Implement MessageAdapter methods...
}
```

Slack differences from Telegram:
- Uses Block Kit instead of InlineKeyboardMarkup
- Uses mrkdwn (`*bold*`) instead of HTML (`<b>bold</b>`)
- 40k char limit vs Telegram's 4k
- Action blocks instead of callback_data

## Platform Comparison

| Feature | Telegram | Slack |
|---------|----------|-------|
| Formatting | HTML | mrkdwn + Block Kit |
| Buttons | InlineKeyboardMarkup | Action blocks |
| Message limit | 4,096 chars | 40,000 chars |
| Typing indicator | Yes | No |
